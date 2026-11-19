import jwt from 'jsonwebtoken';
import type { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@handihotel/shared';
import { config } from '../config.js';
import type { IDataStore } from '../db/store.js';
import type { IPresenceService } from '../redis/presence.js';
import { MinigameManager } from './minigameManager.js';
import { RoomManager } from './roomManager.js';
import { SocialManager, type SocketUserContext } from './socialManager.js';
import { TradeManager } from './tradeManager.js';

interface JwtPayloadLike {
  userId?: string;
  id?: string;
  sub?: string;
  username?: string;
  role?: string;
}

export interface SocketServerHandle {
  roomManager: RoomManager;
  tradeManager: TradeManager;
  socialManager: SocialManager;
  minigameManager: MinigameManager;
  dispose: () => void;
}

function extractHandshakeToken(
  auth: Record<string, unknown> | undefined,
  authHeader: string | undefined
): string | null {
  if (typeof auth?.token === 'string' && auth.token.trim()) {
    return auth.token.replace(/^Bearer\s+/i, '').trim();
  }
  if (typeof authHeader === 'string' && authHeader.trim()) {
    return authHeader.replace(/^Bearer\s+/i, '').trim();
  }
  return null;
}

export function setupSocketServer(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  store: IDataStore,
  presence: IPresenceService
): SocketServerHandle {
  const socialManager = new SocialManager(io, store, presence);
  const roomManager = new RoomManager(io, store, presence, socialManager);
  const tradeManager = new TradeManager(io, store, presence, socialManager);
  const minigameManager = new MinigameManager(io, store, roomManager, socialManager);

  // JWT authentication middleware on socket handshake
  io.use(async (socket, next) => {
    try {
      const token = extractHandshakeToken(
        socket.handshake.auth as Record<string, unknown> | undefined,
        socket.handshake.headers.authorization
      );

      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const decoded = jwt.verify(token, config.jwtSecret) as JwtPayloadLike;
      const userId = decoded.userId ?? decoded.id ?? decoded.sub;
      if (!userId) {
        return next(new Error('Invalid authentication token payload'));
      }

      const user = await store.findUserById(userId);
      if (!user) {
        return next(new Error('User account not found'));
      }
      if (user.banned) {
        return next(new Error('Account is suspended'));
      }

      const ctx: SocketUserContext = {
        userId: user.id,
        username: user.username,
        role: user.role,
        currentRoomId: null,
      };
      socket.data = ctx;
      next();
    } catch {
      next(new Error('Invalid or expired authentication token'));
    }
  });

  io.on('connection', async (socket) => {
    const user = socket.data as SocketUserContext | undefined;
    if (!user?.userId) {
      socket.disconnect(true);
      return;
    }

    try {
      // Check previous presence for seamless reconnection
      const previousPresence = await presence.getUserPresence(user.userId);
      await presence.setUserOnline(user.userId, user.username, socket.id);

      const authRoomId =
        typeof (socket.handshake.auth as Record<string, unknown> | undefined)?.roomId === 'string'
          ? ((socket.handshake.auth as Record<string, unknown>).roomId as string)
          : null;
      const reconnectRoomId = authRoomId ?? previousPresence?.currentRoomId ?? null;

      if (reconnectRoomId) {
        await roomManager.joinRoom(socket, { roomId: reconnectRoomId });
      } else {
        void socialManager.notifyFriendsStatus(user.userId, 'online', null, null);
      }

      // Send current active hotel events on connect
      const events = await store.getActiveEvents();
      socket.emit('event:updated', events);
    } catch (err) {
      console.error('[Socket] connection setup error:', err);
    }

    // Room lifecycle
    socket.on('room:join', (payload, callback) => {
      void roomManager.joinRoom(socket, payload, callback);
    });
    socket.on('room:leave', (payload) => {
      void roomManager.leaveRoom(socket, payload);
    });
    socket.on('room:updateSettings', (payload, callback) => {
      void roomManager.handleUpdateSettings(socket, payload, callback);
    });
    socket.on('room:like', (payload) => {
      void roomManager.handleLikeRoom(socket, payload);
    });
    socket.on('room:kick', (payload) => {
      void roomManager.handleKick(socket, payload);
    });

    // Movement & Avatar
    socket.on('avatar:move', (payload) => {
      roomManager.handleMove(socket, payload);
    });
    socket.on('avatar:sit', (payload) => {
      roomManager.handleSit(socket, payload);
    });
    socket.on('avatar:stand', () => {
      roomManager.handleStand(socket);
    });
    socket.on('avatar:emote', (payload) => {
      roomManager.handleEmote(socket, payload);
    });
    socket.on('avatar:update', (payload) => {
      void roomManager.handleAvatarUpdate(socket, payload);
    });

    // Chat
    socket.on('chat:send', (payload) => {
      void roomManager.handleChat(socket, payload);
    });

    // Furniture manipulation
    socket.on('furni:place', (payload, callback) => {
      void roomManager.handleFurniPlace(socket, payload, callback);
    });
    socket.on('furni:move', (payload, callback) => {
      void roomManager.handleFurniMove(socket, payload, callback);
    });
    socket.on('furni:rotate', (payload, callback) => {
      void roomManager.handleFurniRotate(socket, payload, callback);
    });
    socket.on('furni:pickup', (payload, callback) => {
      void roomManager.handleFurniPickup(socket, payload, callback);
    });
    socket.on('furni:interact', (payload) => {
      void roomManager.handleFurniInteract(socket, payload);
    });

    // Trading
    socket.on('trade:request', (payload) => {
      void tradeManager.handleRequest(socket, payload);
    });
    socket.on('trade:respond', (payload) => {
      void tradeManager.handleRespond(socket, payload);
    });
    socket.on('trade:updateOffer', (payload) => {
      void tradeManager.handleUpdateOffer(socket, payload);
    });
    socket.on('trade:accept', (payload) => {
      void tradeManager.handleAccept(socket, payload);
    });
    socket.on('trade:confirm', (payload) => {
      void tradeManager.handleConfirm(socket, payload);
    });
    socket.on('trade:cancel', (payload) => {
      void tradeManager.handleCancel(socket, payload);
    });

    // Social
    socket.on('social:dm', (payload, callback) => {
      void socialManager.handleDirectMessage(socket, payload, callback);
    });
    socket.on('social:invite', (payload) => {
      void socialManager.handleRoomInvite(socket, payload);
    });
    socket.on('social:friendRequest', (payload) => {
      void socialManager.handleFriendRequest(socket, payload);
    });
    socket.on('social:report', (payload, callback) => {
      void socialManager.handleReport(socket, payload, callback);
    });

    // Minigames
    socket.on('minigame:join', (payload) => {
      void minigameManager.handleJoin(socket, payload);
    });
    socket.on('minigame:leave', (payload) => {
      minigameManager.handleLeave(socket, payload);
    });
    socket.on('minigame:ready', (payload) => {
      minigameManager.handleReady(socket, payload);
    });
    socket.on('minigame:start', (payload) => {
      minigameManager.handleStart(socket, payload);
    });
    socket.on('minigame:action', (payload) => {
      minigameManager.handleAction(socket, payload);
    });

    // Disconnect cleanup
    socket.on('disconnect', async () => {
      try {
        await roomManager.handleDisconnect(socket);
        const wentFullyOffline = await presence.setUserOffline(user.userId, socket.id);
        if (wentFullyOffline) {
          await tradeManager.handleDisconnect(user.userId);
          minigameManager.handleDisconnect(user.userId);
          await socialManager.notifyFriendsStatus(user.userId, 'offline', null, null);
        }
      } catch (err) {
        console.error('[Socket] disconnect cleanup error:', err);
      }
    });
  });

  return {
    roomManager,
    tradeManager,
    socialManager,
    minigameManager,
    dispose: () => {
      roomManager.dispose();
      minigameManager.dispose();
    },
  };
}
