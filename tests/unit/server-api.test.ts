import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { io as createClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_AVATAR_CONFIG,
  type ChatMessage,
  type ClientToServerEvents,
  type MinigameSessionState,
  type PlacedFurniture,
  type ServerToClientEvents,
  type TradeState,
} from '@handihotel/shared';
import { LocalJsonStore } from '../../packages/server/src/db/localStore.js';
import { MemoryPresenceService } from '../../packages/server/src/redis/presence.js';
import { createAuthRouter } from '../../packages/server/src/routes/auth.js';
import { createEconomyRouter } from '../../packages/server/src/routes/economy.js';
import { createMinigamesRouter } from '../../packages/server/src/routes/minigames.js';
import { createRoomsRouter } from '../../packages/server/src/routes/rooms.js';
import { createSocialRouter } from '../../packages/server/src/routes/social.js';
import { setupSocketServer, type SocketServerHandle } from '../../packages/server/src/socket/index.js';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

function waitForEvent<T>(socket: ClientSocket, event: keyof ServerToClientEvents, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for socket event "${String(event)}"`));
    }, timeoutMs);
    socket.once(event as never, ((data: T) => {
      clearTimeout(timer);
      resolve(data);
    }) as never);
  });
}

function connectSocket(baseUrl: string, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket: ClientSocket = createClient(baseUrl, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
    });
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error('Socket connection timed out'));
    }, 5000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe('HandiHotel Server REST & Socket.IO Integration', () => {
  let tmpDir: string;
  let store: LocalJsonStore;
  let presence: MemoryPresenceService;
  let httpServer: http.Server;
  let io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  let socketHandle: SocketServerHandle;
  let baseUrl: string;

  let aliceToken = '';
  let aliceId = '';
  let bobToken = '';
  let bobId = '';
  let aliceRoomId = '';
  let aliceInventoryItemId = '';

  const openSockets: ClientSocket[] = [];

  async function api(
    method: string,
    urlPath: string,
    body?: unknown,
    token?: string
  ): Promise<{ status: number; data: Record<string, any> }> {
    const res = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json()) as Record<string, any>;
    return { status: res.status, data };
  }

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'handihotel-test-'));
    const dataFile = path.join(tmpDir, 'test-store.json');
    store = new LocalJsonStore(dataFile);
    await store.init();
    presence = new MemoryPresenceService();

    const app = express();
    app.use(express.json());
    app.get('/api/health', (_req, res) => res.json({ ok: true, storage: store.backend }));
    app.use('/api/auth', createAuthRouter(store, presence));
    app.use('/api/rooms', createRoomsRouter(store, presence));
    app.use('/api/economy', createEconomyRouter(store));
    app.use('/api/social', createSocialRouter(store, presence));
    app.use('/api/minigames', createMinigamesRouter(store));

    httpServer = http.createServer(app);
    io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
      cors: { origin: '*' },
    });
    socketHandle = setupSocketServer(io, store, presence);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = httpServer.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Failed to bind ephemeral port');
    }
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    for (const s of openSockets) {
      s.disconnect();
    }
    socketHandle.dispose();
    io.close();
    httpServer.close();
    await presence.close();
    await store.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('registers, logs in, fetches profile, and updates avatar with mobility aid', async () => {
    const health = await api('GET', '/api/health');
    expect(health.status).toBe(200);
    expect(health.data.ok).toBe(true);

    const regAlice = await api('POST', '/api/auth/register', {
      username: 'alice_wheel',
      email: 'alice@handihotel.test',
      password: 'password123',
      motto: 'Rolling fast!',
    });
    expect(regAlice.status).toBe(201);
    expect(regAlice.data.token).toBeTruthy();
    aliceToken = regAlice.data.token;
    aliceId = regAlice.data.user.id;

    const regBob = await api('POST', '/api/auth/register', {
      username: 'bob_cruiser',
      email: 'bob@handihotel.test',
      password: 'password123',
    });
    expect(regBob.status).toBe(201);
    bobToken = regBob.data.token;
    bobId = regBob.data.user.id;

    const loginAlice = await api('POST', '/api/auth/login', {
      identifier: 'alice_wheel',
      password: 'password123',
    });
    expect(loginAlice.status).toBe(200);
    expect(loginAlice.data.user.username).toBe('alice_wheel');

    const updatedAvatar = {
      ...DEFAULT_AVATAR_CONFIG,
      mobilityAid: 'racing_wheelchair' as const,
      mobilityAidColor: '#F59E0B',
      accessory: 'sunglasses' as const,
    };
    const patchRes = await api(
      'PATCH',
      '/api/auth/avatar',
      { avatar: updatedAvatar, motto: 'Turbo Mode' },
      aliceToken
    );
    expect(patchRes.status).toBe(200);
    expect(patchRes.data.user.avatar.mobilityAid).toBe('racing_wheelchair');
    expect(patchRes.data.user.motto).toBe('Turbo Mode');
  });

  it('lists all 11 public rooms and allows creating and updating a private room', async () => {
    const listRes = await api('GET', '/api/rooms', undefined, aliceToken);
    expect(listRes.status).toBe(200);
    expect(listRes.data.publicRooms).toHaveLength(11);

    const createRes = await api(
      'POST',
      '/api/rooms',
      {
        name: 'Alice Penthouse',
        description: 'VIP chill pad',
        templateId: 'suite',
        floorStyle: 'marble_gold',
        wallStyle: 'royal_blue',
      },
      aliceToken
    );
    expect(createRes.status).toBe(201);
    expect(createRes.data.room.name).toBe('Alice Penthouse');
    aliceRoomId = createRes.data.room.id;

    const updateRes = await api(
      'PATCH',
      `/api/rooms/${aliceRoomId}`,
      { name: 'Alice Sky Lounge' },
      aliceToken
    );
    expect(updateRes.status).toBe(200);
    expect(updateRes.data.room.name).toBe('Alice Sky Lounge');
  });

  it('handles economy catalog, item purchase, inventory, and daily reward claim', async () => {
    const catalogRes = await api('GET', '/api/economy/catalog');
    expect(catalogRes.status).toBe(200);
    expect(catalogRes.data.items.length).toBeGreaterThanOrEqual(55);

    const buyRes = await api(
      'POST',
      '/api/economy/purchase',
      { catalogItemId: 'bistro_chair', quantity: 2 },
      aliceToken
    );
    expect(buyRes.status).toBe(201);
    expect(buyRes.data.items).toHaveLength(2);
    aliceInventoryItemId = buyRes.data.items[0].id;

    const invRes = await api('GET', '/api/economy/inventory', undefined, aliceToken);
    expect(invRes.status).toBe(200);
    expect(invRes.data.items.some((i: any) => i.id === aliceInventoryItemId)).toBe(true);

    const dailyRes = await api('POST', '/api/economy/daily-reward/claim', {}, aliceToken);
    expect(dailyRes.status).toBe(200);
    expect(dailyRes.data.rewardCredits).toBeGreaterThan(0);
  });

  it('handles friend requests, acceptance, and direct messages', async () => {
    const reqRes = await api(
      'POST',
      '/api/social/friends/request',
      { targetUsername: 'bob_cruiser' },
      aliceToken
    );
    expect(reqRes.status).toBe(201);
    const requestId = reqRes.data.request.id;

    const respondRes = await api(
      'POST',
      `/api/social/friends/requests/${requestId}`,
      { accept: true },
      bobToken
    );
    expect(respondRes.status).toBe(200);

    const friendsRes = await api('GET', '/api/social/friends', undefined, aliceToken);
    expect(friendsRes.status).toBe(200);
    expect(friendsRes.data.friends.some((f: any) => f.userId === bobId)).toBe(true);

    const dmRes = await api(
      'POST',
      '/api/social/messages',
      { toUserId: bobId, text: 'Meet me in my room!' },
      aliceToken
    );
    expect(dmRes.status).toBe(201);

    const historyRes = await api('GET', `/api/social/messages/${aliceId}`, undefined, bobToken);
    expect(historyRes.status).toBe(200);
    expect(historyRes.data.messages.some((m: any) => m.text === 'Meet me in my room!')).toBe(true);
  });

  it('handles real-time Socket.IO room join, movement, chat, furniture placement, trading, and minigames', async () => {
    const aliceSocket = await connectSocket(baseUrl, aliceToken);
    const bobSocket = await connectSocket(baseUrl, bobToken);
    openSockets.push(aliceSocket, bobSocket);

    // Join Alice's room
    const joinAlice = await new Promise<{ ok: boolean; room?: any }>((resolve) => {
      aliceSocket.emit('room:join', { roomId: aliceRoomId }, (res) => resolve(res));
    });
    expect(joinAlice.ok).toBe(true);

    const userJoinedPromise = waitForEvent<{ player: any }>(aliceSocket, 'room:userJoined');
    const joinBob = await new Promise<{ ok: boolean }>((resolve) => {
      bobSocket.emit('room:join', { roomId: aliceRoomId }, (res) => resolve(res));
    });
    expect(joinBob.ok).toBe(true);
    const joinedEvt = await userJoinedPromise;
    expect(joinedEvt.player.username).toBe('bob_cruiser');

    // Movement
    const pathPromise = waitForEvent<{ userId: string; path: any[] }>(bobSocket, 'avatar:path');
    aliceSocket.emit('avatar:move', { x: 4, y: 4 });
    const pathEvt = await pathPromise;
    expect(pathEvt.userId).toBe(aliceId);
    expect(pathEvt.path.length).toBeGreaterThan(0);

    // Chat
    const chatPromise = waitForEvent<ChatMessage>(bobSocket, 'chat:message');
    aliceSocket.emit('chat:send', { text: 'Hello from HandiHotel!', mode: 'normal' });
    const chatEvt = await chatPromise;
    expect(chatEvt.text).toBe('Hello from HandiHotel!');
    expect(chatEvt.username).toBe('alice_wheel');

    // Furniture placement
    const placedPromise = waitForEvent<{ furniture: PlacedFurniture }>(bobSocket, 'furni:placed');
    const placeRes = await new Promise<{ ok: boolean; furniture?: PlacedFurniture }>((resolve) => {
      aliceSocket.emit(
        'furni:place',
        { inventoryItemId: aliceInventoryItemId, x: 2, y: 2, rotation: 0 },
        (res) => resolve(res)
      );
    });
    expect(placeRes.ok).toBe(true);
    const placedEvt = await placedPromise;
    expect(placedEvt.furniture.catalogItemId).toBe('bistro_chair');

    // Trading flow (Alice offers 25 credits to Bob)
    const tradeReqPromise = waitForEvent<{ trade: TradeState }>(bobSocket, 'trade:requested');
    aliceSocket.emit('trade:request', { targetUserId: bobId });
    const { trade } = await tradeReqPromise;
    expect(trade.id).toBeTruthy();

    const tradeOpenPromise = waitForEvent<{ trade: TradeState }>(aliceSocket, 'trade:updated');
    bobSocket.emit('trade:respond', { tradeId: trade.id, accept: true });
    await tradeOpenPromise;

    const offerUpdatedPromise = waitForEvent<{ trade: TradeState }>(bobSocket, 'trade:updated');
    aliceSocket.emit('trade:updateOffer', { tradeId: trade.id, itemIds: [], credits: 25 });
    await offerUpdatedPromise;

    const bobAcceptPromise = waitForEvent<{ trade: TradeState }>(aliceSocket, 'trade:updated');
    aliceSocket.emit('trade:accept', { tradeId: trade.id, accepted: true });
    await bobAcceptPromise;

    const bothAcceptedPromise = waitForEvent<{ trade: TradeState }>(aliceSocket, 'trade:updated');
    bobSocket.emit('trade:accept', { tradeId: trade.id, accepted: true });
    await bothAcceptedPromise;

    const tradeDonePromise = waitForEvent<{ tradeId: string }>(aliceSocket, 'trade:completed');
    aliceSocket.emit('trade:confirm', { tradeId: trade.id });
    bobSocket.emit('trade:confirm', { tradeId: trade.id });
    const tradeDone = await tradeDonePromise;
    expect(tradeDone.tradeId).toBe(trade.id);

    // Minigame join + start in Race Arena
    await new Promise<void>((resolve) => {
      aliceSocket.emit('room:join', { roomId: 'public-race-arena' }, () => resolve());
    });
    const mgStatePromise = waitForEvent<MinigameSessionState>(aliceSocket, 'minigame:state');
    aliceSocket.emit('minigame:join', {
      roomId: 'public-race-arena',
      type: 'wheelchair_racing',
    });
    const mgSession = await mgStatePromise;
    expect(mgSession.type).toBe('wheelchair_racing');
    expect(mgSession.players.some((p) => p.userId === aliceId)).toBe(true);

    const mgStartedPromise = waitForEvent<MinigameSessionState>(aliceSocket, 'minigame:state');
    aliceSocket.emit('minigame:start', { sessionId: mgSession.id });
    const mgStarted = await mgStartedPromise;
    expect(['countdown', 'playing']).toContain(mgStarted.status);
  });
});
