import http from 'node:http';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { Redis } from 'ioredis';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@handihotel/shared';
import { config } from './config.js';
import { createDataStore } from './db/index.js';
import { createPresenceService } from './redis/presence.js';
import { createAuthRouter } from './routes/auth.js';
import { createEconomyRouter } from './routes/economy.js';
import { createMinigamesRouter } from './routes/minigames.js';
import { createRoomsRouter } from './routes/rooms.js';
import { createSocialRouter } from './routes/social.js';
import { apiRateLimiter } from './security/auth.js';
import { setupSocketServer } from './socket/index.js';

async function tryConnectRedis(
  redisUrl: string | null
): Promise<{ pubClient: Redis; subClient: Redis } | null> {
  if (!redisUrl) return null;

  const pubClient = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    connectTimeout: 2500,
    retryStrategy: () => null,
  });

  pubClient.on('error', () => {
    // Handled during initial connect check
  });

  try {
    await pubClient.connect();
    await pubClient.ping();
    const subClient = pubClient.duplicate({
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      connectTimeout: 2500,
      retryStrategy: () => null,
    });
    subClient.on('error', () => {
      // Handled gracefully
    });
    await subClient.connect();
    console.log('[Redis] Connected for Socket.IO adapter and presence.');
    return { pubClient, subClient };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Redis] Unavailable (${message}). Using in-memory presence & adapter.`);
    pubClient.disconnect();
    return null;
  }
}

async function bootstrap(): Promise<void> {
  const store = await createDataStore();
  const redisPair = await tryConnectRedis(config.redisUrl);
  const presence = createPresenceService(redisPair?.pubClient ?? null);

  const app = express();
  app.set('trust proxy', 1);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  const allowedOrigins = config.clientOrigin
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
          cb(null, true);
          return;
        }
        // Allow localhost dev origins seamlessly
        if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
          cb(null, true);
          return;
        }
        cb(null, false);
      },
      credentials: true,
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use('/api', apiRateLimiter);

  app.get('/api/health', async (_req, res) => {
    const onlineUsers = await presence.getOnlineUserCount();
    res.json({
      ok: true,
      service: 'handihotel-server',
      storage: store.backend,
      presence: presence.backend,
      onlineUsers,
      uptimeSec: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api/auth', createAuthRouter(store, presence));
  app.use('/api/rooms', createRoomsRouter(store, presence));
  app.use('/api/economy', createEconomyRouter(store));
  app.use('/api/social', createSocialRouter(store, presence));
  app.use('/api/minigames', createMinigamesRouter(store));

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      console.error('[HTTP Error]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  );

  const httpServer = http.createServer(app);
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: true,
      credentials: true,
    },
    pingInterval: 20_000,
    pingTimeout: 25_000,
  });

  if (redisPair) {
    io.adapter(createAdapter(redisPair.pubClient, redisPair.subClient));
  }

  const socketHandle = setupSocketServer(io, store, presence);

  httpServer.listen(config.port, () => {
    console.log(
      `[HandiHotel Server] Listening on http://localhost:${config.port} (storage=${store.backend}, presence=${presence.backend})`
    );
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[HandiHotel Server] Received ${signal}, shutting down...`);
    socketHandle.dispose();
    io.close();
    httpServer.close();
    await presence.close();
    if (redisPair) {
      redisPair.pubClient.disconnect();
      redisPair.subClient.disconnect();
    }
    await store.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('[HandiHotel Server] Fatal startup error:', err);
  process.exit(1);
});
