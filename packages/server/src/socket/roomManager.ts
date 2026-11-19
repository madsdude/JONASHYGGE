import { v4 as uuidv4 } from 'uuid';
import {
  buildWalkabilityGrid,
  computeDirection,
  EMOTE_TYPES,
  findPath,
  getCatalogItem,
  getFurnitureFootprint,
  MOBILITY_AIDS,
  tileKey,
  type AvatarConfig,
  type ChatMessage,
  type ChatMode,
  type Direction8,
  type EmoteType,
  type PlacedFurniture,
  type PlayerInRoom,
  type RoomSettingsPatch,
  type RoomState,
  type Rotation4,
  type TileCoord,
} from '@handihotel/shared';
import type { IDataStore } from '../db/store.js';
import type { IPresenceService } from '../redis/presence.js';
import { getSocketUser, type GameIO, type GameSocket, type SocialManager } from './socialManager.js';

interface RoomPlayerRuntime extends PlayerInRoom {
  path: TileCoord[];
  targetSitFurniId: string | null;
  emoteTimer: NodeJS.Timeout | null;
  boostTimer: NodeJS.Timeout | null;
  baseSpeedMultiplier: number;
  isNpc: boolean;
}

interface RoomSession {
  room: RoomState;
  players: Map<string, RoomPlayerRuntime>;
  chatHistory: ChatMessage[];
  lastNpcChatterAt: number;
}

const VALID_EMOTES = new Set<string>(EMOTE_TYPES.map((e) => e.id));
const MOVEMENT_TICK_MS = 150;
const CHAT_HISTORY_LIMIT = 60;
const CHAT_RATE_LIMIT_MAX = 5;
const CHAT_RATE_LIMIT_WINDOW_MS = 4000;

const BELLHOP_BENNY: Omit<RoomPlayerRuntime, 'path' | 'targetSitFurniId' | 'emoteTimer' | 'boostTimer'> = {
  userId: 'npc-bellhop-benny',
  username: 'Bellhop Benny',
  motto: 'Rolling luggage at turbo speed since 2004!',
  avatar: {
    bodyType: 'standard',
    skinTone: '#F2C29B',
    hairStyle: 'pompadour',
    hairColor: '#7C4A2D',
    shirtStyle: 'suit',
    shirtColor: '#B91C1C',
    pantsColor: '#1E293B',
    shoeColor: '#0F172A',
    accessory: 'top_hat',
    accessoryColor: '#FACC15',
    expression: 'happy',
    mobilityAid: 'power_wheelchair',
    mobilityAidColor: '#FACC15',
  },
  x: 10,
  y: 3,
  z: 0,
  direction: 4,
  sitting: false,
  sittingFurniId: null,
  currentEmote: null,
  isAdmin: false,
  speedMultiplier: 1.1,
  baseSpeedMultiplier: 1.1,
  isNpc: true,
};

const CONCIERGE_CLARA: Omit<RoomPlayerRuntime, 'path' | 'targetSitFurniId' | 'emoteTimer' | 'boostTimer'> = {
  userId: 'npc-concierge-clara',
  username: 'Concierge Clara',
  motto: 'Welcome to HandiHotel! Ring the bell for VIP tips!',
  avatar: {
    bodyType: 'slim',
    skinTone: '#E0A47A',
    hairStyle: 'bun',
    hairColor: '#1C1917',
    shirtStyle: 'suit',
    shirtColor: '#1E3A8A',
    pantsColor: '#0F172A',
    shoeColor: '#1C1917',
    accessory: 'scarf',
    accessoryColor: '#FACC15',
    expression: 'wink',
    mobilityAid: 'manual_wheelchair',
    mobilityAidColor: '#0EA5E9',
  },
  x: 6,
  y: 4,
  z: 0,
  direction: 4,
  sitting: false,
  sittingFurniId: null,
  currentEmote: null,
  isAdmin: false,
  speedMultiplier: 1.0,
  baseSpeedMultiplier: 1.0,
  isNpc: true,
};

const BENNY_GREETINGS = [
  (name: string) => `Welcome to HandiHotel, ${name}! Hop in the elevator or check out the Turbo Race Arena!`,
  (name: string) => `Ahoy ${name}! Need a luggage cart? Just don't ask what's in suitcase #4.`,
  (name: string) => `Hey ${name}! Grab a HandiFizz from the vending machine and make yourself at home!`,
];

const CLARA_GREETINGS = [
  (name: string) => `Welcome to Grand Reception, ${name}! Don't forget to claim your Daily Credits in the top bar!`,
  (name: string) => `Good to see you, ${name}! Looking to build your own suite? Open the Navigator to create a room!`,
  (name: string) => `Hello ${name}! Check out the Shop for rare thrones, disco lights, and golden wheelchairs!`,
];

function roomChannel(roomId: string): string {
  return `room:${roomId}`;
}

function getMobilitySpeed(avatar: AvatarConfig): number {
  const aid = MOBILITY_AIDS.find((m) => m.id === avatar.mobilityAid);
  return aid?.speedBonus ?? 1.0;
}

function toPublicPlayer(p: RoomPlayerRuntime): PlayerInRoom {
  return {
    userId: p.userId,
    username: p.username,
    motto: p.motto,
    avatar: p.avatar,
    x: p.x,
    y: p.y,
    z: p.z,
    direction: p.direction,
    sitting: p.sitting,
    sittingFurniId: p.sittingFurniId,
    currentEmote: p.currentEmote,
    isAdmin: p.isAdmin,
    speedMultiplier: p.speedMultiplier,
  };
}

export class RoomManager {
  private readonly sessions = new Map<string, RoomSession>();
  private readonly chatTimestamps = new Map<string, number[]>();
  private tickInterval: NodeJS.Timeout | null = null;
  private npcInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly io: GameIO,
    private readonly store: IDataStore,
    private readonly presence: IPresenceService,
    private readonly social: SocialManager
  ) {
    this.startLoops();
  }

  private startLoops(): void {
    this.tickInterval = setInterval(() => {
      this.tickMovement();
    }, MOVEMENT_TICK_MS);

    this.npcInterval = setInterval(() => {
      this.tickAmbientNpcs();
    }, 35_000);
  }

  dispose(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
    if (this.npcInterval) clearInterval(this.npcInterval);
    for (const session of this.sessions.values()) {
      for (const player of session.players.values()) {
        if (player.emoteTimer) clearTimeout(player.emoteTimer);
        if (player.boostTimer) clearTimeout(player.boostTimer);
      }
    }
    this.sessions.clear();
  }

  getRoomSession(roomId: string): RoomSession | undefined {
    return this.sessions.get(roomId);
  }

  getPlayerInRoom(roomId: string, userId: string): PlayerInRoom | null {
    const p = this.sessions.get(roomId)?.players.get(userId);
    return p ? toPublicPlayer(p) : null;
  }

  private async ensureSession(roomId: string): Promise<RoomSession | null> {
    const existing = this.sessions.get(roomId);
    if (existing) return existing;

    const room = await this.store.getRoomState(roomId);
    if (!room) return null;

    const session: RoomSession = {
      room,
      players: new Map(),
      chatHistory: [],
      lastNpcChatterAt: 0,
    };

    this.spawnAmbientNpcs(session);
    this.sessions.set(roomId, session);
    return session;
  }

  private spawnAmbientNpcs(session: RoomSession): void {
    if (session.room.id === 'public-lobby') {
      session.players.set(BELLHOP_BENNY.userId, {
        ...BELLHOP_BENNY,
        path: [],
        targetSitFurniId: null,
        emoteTimer: null,
        boostTimer: null,
      });
    } else if (session.room.id === 'public-reception') {
      session.players.set(CONCIERGE_CLARA.userId, {
        ...CONCIERGE_CLARA,
        path: [],
        targetSitFurniId: null,
        emoteTimer: null,
        boostTimer: null,
      });
    }
  }

  private tickAmbientNpcs(): void {
    const now = Date.now();
    for (const session of this.sessions.values()) {
      const humanCount = Array.from(session.players.values()).filter((p) => !p.isNpc).length;
      if (humanCount === 0) continue;
      if (now - session.lastNpcChatterAt < 45_000) continue;

      const npc = Array.from(session.players.values()).find((p) => p.isNpc);
      if (!npc) continue;

      session.lastNpcChatterAt = now;
      const lines =
        npc.userId === BELLHOP_BENNY.userId
          ? [
              'Pro tip: Press the Minigames icon below to try Turbo Wheelchair Racing or Dance Battle!',
              'Did you know? Click any floor lamp, fireplace, or dice to interact with it!',
            ]
          : [
              'Friendly reminder: You can customize your mobility aid and outfit anytime in the Avatar Editor!',
              'Need more credits? Claim your Daily Reward or win a round of Furniture Chaos!',
            ];

      const text = lines[Math.floor(Math.random() * lines.length)];
      this.emitNpcMessage(session, npc, text, 'wave');
    }
  }

  private emitNpcMessage(
    session: RoomSession,
    npc: RoomPlayerRuntime,
    text: string,
    emote?: EmoteType
  ): void {
    const message: ChatMessage = {
      id: uuidv4(),
      roomId: session.room.id,
      userId: npc.userId,
      username: npc.username,
      text,
      mode: 'normal',
      timestamp: Date.now(),
    };
    this.appendChatHistory(session, message);
    this.io.to(roomChannel(session.room.id)).emit('chat:message', message);

    if (emote) {
      npc.currentEmote = emote;
      this.io.to(roomChannel(session.room.id)).emit('avatar:emoted', {
        userId: npc.userId,
        emote,
      });
      if (npc.emoteTimer) clearTimeout(npc.emoteTimer);
      npc.emoteTimer = setTimeout(() => {
        npc.currentEmote = null;
        this.io.to(roomChannel(session.room.id)).emit('avatar:emoted', {
          userId: npc.userId,
          emote: null,
        });
      }, 3000);
    }
  }

  broadcastSystemChat(roomId: string, text: string): void {
    const session = this.sessions.get(roomId);
    if (!session) return;

    const message: ChatMessage = {
      id: uuidv4(),
      roomId,
      userId: 'system',
      username: 'HandiHotel',
      text,
      mode: 'system',
      timestamp: Date.now(),
    };
    this.appendChatHistory(session, message);
    this.io.to(roomChannel(roomId)).emit('chat:message', message);
  }

  setPlayerEmote(roomId: string, userId: string, emote: EmoteType): void {
    const session = this.sessions.get(roomId);
    const player = session?.players.get(userId);
    if (!session || !player) return;

    player.currentEmote = emote;
    this.io.to(roomChannel(roomId)).emit('avatar:emoted', { userId, emote });

    if (player.emoteTimer) clearTimeout(player.emoteTimer);
    if (emote !== 'sit') {
      player.emoteTimer = setTimeout(() => {
        player.currentEmote = null;
        this.io.to(roomChannel(roomId)).emit('avatar:emoted', { userId, emote: null });
      }, 3500);
    }
  }

  setPlayerSpeedBoost(roomId: string, userId: string, multiplier: number, durationMs: number): void {
    const session = this.sessions.get(roomId);
    const player = session?.players.get(userId);
    if (!session || !player) return;

    player.speedMultiplier = Math.max(player.baseSpeedMultiplier, multiplier);
    if (player.boostTimer) clearTimeout(player.boostTimer);
    player.boostTimer = setTimeout(() => {
      player.speedMultiplier = player.baseSpeedMultiplier;
    }, durationMs);
  }

  private appendChatHistory(session: RoomSession, message: ChatMessage): void {
    session.chatHistory.push(message);
    if (session.chatHistory.length > CHAT_HISTORY_LIMIT) {
      session.chatHistory.splice(0, session.chatHistory.length - CHAT_HISTORY_LIMIT);
    }
  }

  private tickMovement(): void {
    for (const session of this.sessions.values()) {
      let grid: ReturnType<typeof buildWalkabilityGrid> | null = null;

      for (const player of session.players.values()) {
        if (player.path.length === 0) continue;

        const stepsToTake = player.speedMultiplier >= 1.5 && player.path.length > 1 ? 2 : 1;
        let lastStep: TileCoord | null = null;

        for (let s = 0; s < stepsToTake && player.path.length > 0; s++) {
          const next = player.path.shift()!;
          player.direction = computeDirection({ x: player.x, y: player.y }, next);
          player.x = next.x;
          player.y = next.y;
          player.z = next.z ?? 0;
          player.sitting = false;
          player.sittingFurniId = null;
          lastStep = next;
        }

        if (!lastStep) continue;

        // Check if player reached destination and it's sittable
        if (player.path.length === 0) {
          if (!grid) {
            grid = buildWalkabilityGrid({
              width: session.room.width,
              height: session.room.height,
              furniture: session.room.furniture,
              heightMap: session.room.heightMap,
            });
          }
          const cell = grid[player.y]?.[player.x];
          if (cell?.sittable && cell.furniId) {
            player.sitting = true;
            player.sittingFurniId = cell.furniId;
            player.z = cell.elevation;
            const furni = session.room.furniture.find((f) => f.id === cell.furniId);
            if (furni) {
              player.direction = (((furni.rotation * 2) + 4) % 8) as Direction8;
            }
          } else if (player.targetSitFurniId) {
            const targetFurni = session.room.furniture.find((f) => f.id === player.targetSitFurniId);
            if (targetFurni) {
              player.sitting = true;
              player.sittingFurniId = targetFurni.id;
            }
          }
          player.targetSitFurniId = null;
        }

        this.io.to(roomChannel(session.room.id)).emit('avatar:moved', {
          userId: player.userId,
          x: player.x,
          y: player.y,
          z: player.z,
          direction: player.direction,
          sitting: player.sitting,
          sittingFurniId: player.sittingFurniId,
        });
      }
    }
  }

  private canBuildInRoom(room: RoomState, userId: string, role: string): boolean {
    if (role === 'admin' || role === 'moderator') return true;
    if (room.ownerId === userId) return true;
    if (room.permissions.moderatorUserIds.includes(userId)) return true;
    return false;
  }

  private findSpawnTile(room: RoomState): TileCoord {
    const grid = buildWalkabilityGrid({
      width: room.width,
      height: room.height,
      furniture: room.furniture,
      heightMap: room.heightMap,
    });

    const sx = Math.max(0, Math.min(room.width - 1, room.spawnX));
    const sy = Math.max(0, Math.min(room.height - 1, room.spawnY));
    if (grid[sy]?.[sx]?.walkable) {
      return { x: sx, y: sy, z: grid[sy][sx].elevation };
    }

    // Spiral search for nearest walkable tile
    for (let radius = 1; radius < Math.max(room.width, room.height); radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = sx + dx;
          const ny = sy + dy;
          if (nx >= 0 && nx < room.width && ny >= 0 && ny < room.height) {
            if (grid[ny][nx].walkable) {
              return { x: nx, y: ny, z: grid[ny][nx].elevation };
            }
          }
        }
      }
    }

    return { x: sx, y: sy, z: 0 };
  }

  async joinRoom(
    socket: GameSocket,
    payload: { roomId: string; password?: string },
    callback?: (res: { ok: boolean; error?: string; room?: RoomState; players?: PlayerInRoom[] }) => void
  ): Promise<void> {
    const user = getSocketUser(socket);
    if (!user) {
      callback?.({ ok: false, error: 'Not authenticated' });
      return;
    }

    const roomId = payload?.roomId?.trim();
    if (!roomId) {
      callback?.({ ok: false, error: 'Room ID is required' });
      return;
    }

    try {
      const session = await this.ensureSession(roomId);
      if (!session) {
        callback?.({ ok: false, error: 'Room not found' });
        return;
      }

      const { room } = session;
      const isPrivileged =
        room.ownerId === user.userId || user.role === 'admin' || user.role === 'moderator';

      if (!isPrivileged) {
        if (room.permissions.bannedUserIds.includes(user.userId)) {
          callback?.({ ok: false, error: 'You are banned from this room' });
          return;
        }
        if (room.permissions.accessMode === 'locked') {
          callback?.({ ok: false, error: 'This room is currently locked' });
          return;
        }
        if (room.permissions.accessMode === 'friends_only') {
          const ownerFriends = await this.store.getFriends(room.ownerId);
          if (!ownerFriends.some((f) => f.userId === user.userId)) {
            callback?.({ ok: false, error: 'This room is restricted to friends only' });
            return;
          }
        }
        const humanCount = Array.from(session.players.values()).filter(
          (p) => !p.isNpc && p.userId !== user.userId
        ).length;
        if (humanCount >= room.permissions.maxUsers) {
          callback?.({ ok: false, error: 'This room is full' });
          return;
        }
      }

      // Leave previous room if different
      if (user.currentRoomId && user.currentRoomId !== roomId) {
        await this.leaveRoom(socket, { roomId: user.currentRoomId });
      }

      const storedUser = await this.store.findUserById(user.userId);
      if (!storedUser) {
        callback?.({ ok: false, error: 'User account not found' });
        return;
      }

      const existingPlayer = session.players.get(user.userId);
      const spawn = existingPlayer
        ? { x: existingPlayer.x, y: existingPlayer.y, z: existingPlayer.z }
        : this.findSpawnTile(room);
      const baseSpeed = getMobilitySpeed(storedUser.avatar);

      const runtimePlayer: RoomPlayerRuntime = {
        userId: storedUser.id,
        username: storedUser.username,
        motto: storedUser.motto,
        avatar: storedUser.avatar,
        x: spawn.x,
        y: spawn.y,
        z: spawn.z ?? 0,
        direction: existingPlayer?.direction ?? 4,
        sitting: existingPlayer?.sitting ?? false,
        sittingFurniId: existingPlayer?.sittingFurniId ?? null,
        currentEmote: null,
        isAdmin: storedUser.role === 'admin' || storedUser.role === 'moderator',
        speedMultiplier: baseSpeed,
        baseSpeedMultiplier: baseSpeed,
        path: [],
        targetSitFurniId: null,
        emoteTimer: null,
        boostTimer: null,
        isNpc: false,
      };

      session.players.set(storedUser.id, runtimePlayer);
      (socket.data as { currentRoomId: string | null }).currentRoomId = room.id;
      await socket.join(roomChannel(room.id));
      await this.presence.setUserRoom(storedUser.id, room.id, room.name);

      const publicPlayers = Array.from(session.players.values()).map(toPublicPlayer);

      socket.emit('room:state', {
        room: session.room,
        players: publicPlayers,
        chatHistory: session.chatHistory,
      });

      if (!existingPlayer) {
        socket.to(roomChannel(room.id)).emit('room:userJoined', {
          player: toPublicPlayer(runtimePlayer),
        });
      }

      callback?.({
        ok: true,
        room: session.room,
        players: publicPlayers,
      });

      // Notify friends of room change
      void this.social.notifyFriendsStatus(storedUser.id, 'online', room.id, room.name);

      // Ambient NPC greeting for newcomers
      if (!existingPlayer && (room.id === 'public-lobby' || room.id === 'public-reception')) {
        const npcId = room.id === 'public-lobby' ? BELLHOP_BENNY.userId : CONCIERGE_CLARA.userId;
        const npc = session.players.get(npcId);
        if (npc) {
          const templates = room.id === 'public-lobby' ? BENNY_GREETINGS : CLARA_GREETINGS;
          const greeting = templates[Math.floor(Math.random() * templates.length)](storedUser.username);
          setTimeout(() => {
            if (session.players.has(storedUser.id)) {
              this.emitNpcMessage(session, npc, greeting, 'wave');
            }
          }, 1200);
        }
      }
    } catch (err) {
      console.error('[RoomManager] joinRoom error:', err);
      callback?.({ ok: false, error: 'Failed to join room' });
    }
  }

  async leaveRoom(socket: GameSocket, payload?: { roomId?: string }): Promise<void> {
    const user = getSocketUser(socket);
    if (!user) return;

    const roomId = payload?.roomId ?? user.currentRoomId;
    if (!roomId) return;

    const session = this.sessions.get(roomId);
    if (session) {
      const player = session.players.get(user.userId);
      if (player) {
        if (player.emoteTimer) clearTimeout(player.emoteTimer);
        if (player.boostTimer) clearTimeout(player.boostTimer);
        session.players.delete(user.userId);
      }

      await socket.leave(roomChannel(roomId));
      this.io.to(roomChannel(roomId)).emit('room:userLeft', { userId: user.userId });

      // Clean up empty non-public room sessions to save memory
      const humanRemaining = Array.from(session.players.values()).filter((p) => !p.isNpc).length;
      if (humanRemaining === 0 && !session.room.isPublic) {
        this.sessions.delete(roomId);
      }
    }

    if (user.currentRoomId === roomId) {
      (socket.data as { currentRoomId: string | null }).currentRoomId = null;
      await this.presence.setUserRoom(user.userId, null, null);
      void this.social.notifyFriendsStatus(user.userId, 'online', null, null);
    }
  }

  async handleDisconnect(socket: GameSocket): Promise<void> {
    const user = getSocketUser(socket);
    if (!user || !user.currentRoomId) return;

    // Check if user has another socket still connected
    const remainingSockets = (await this.presence.getUserSocketIds(user.userId)).filter(
      (id) => id !== socket.id
    );
    if (remainingSockets.length > 0) return;

    await this.leaveRoom(socket, { roomId: user.currentRoomId });
  }

  handleMove(socket: GameSocket, payload: { x: number; y: number }): void {
    const user = getSocketUser(socket);
    if (!user?.currentRoomId) return;

    const session = this.sessions.get(user.currentRoomId);
    const player = session?.players.get(user.userId);
    if (!session || !player) return;

    const targetX = Math.round(Number(payload?.x));
    const targetY = Math.round(Number(payload?.y));
    if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) return;

    let blockedTiles: Set<string> | undefined;
    if (!session.room.permissions.allowWalkThrough) {
      blockedTiles = new Set<string>();
      for (const other of session.players.values()) {
        if (other.userId !== player.userId) {
          blockedTiles.add(tileKey(other.x, other.y));
        }
      }
    }

    const path = findPath(
      { x: player.x, y: player.y },
      { x: targetX, y: targetY },
      {
        width: session.room.width,
        height: session.room.height,
        furniture: session.room.furniture,
        heightMap: session.room.heightMap,
        blockedTiles,
      }
    );

    if (path.length === 0) return;

    player.path = path;
    player.targetSitFurniId = null;
    player.sitting = false;
    player.sittingFurniId = null;

    const direction = computeDirection({ x: player.x, y: player.y }, path[0]);
    player.direction = direction;

    this.io.to(roomChannel(session.room.id)).emit('avatar:path', {
      userId: player.userId,
      path,
      direction,
    });
  }

  handleSit(socket: GameSocket, payload: { furniId?: string; x?: number; y?: number }): void {
    const user = getSocketUser(socket);
    if (!user?.currentRoomId) return;

    const session = this.sessions.get(user.currentRoomId);
    const player = session?.players.get(user.userId);
    if (!session || !player) return;

    if (payload?.furniId) {
      const furni = session.room.furniture.find((f) => f.id === payload.furniId);
      if (!furni) return;
      const item = getCatalogItem(furni.catalogItemId);
      if (!item?.sittable) return;

      if (player.x === furni.x && player.y === furni.y) {
        player.sitting = true;
        player.sittingFurniId = furni.id;
        player.direction = (((furni.rotation * 2) + 4) % 8) as Direction8;
        this.io.to(roomChannel(session.room.id)).emit('avatar:moved', {
          userId: player.userId,
          x: player.x,
          y: player.y,
          z: player.z,
          direction: player.direction,
          sitting: true,
          sittingFurniId: furni.id,
        });
        return;
      }

      const path = findPath(
        { x: player.x, y: player.y },
        { x: furni.x, y: furni.y },
        {
          width: session.room.width,
          height: session.room.height,
          furniture: session.room.furniture,
          heightMap: session.room.heightMap,
        }
      );

      if (path.length > 0) {
        player.path = path;
        player.targetSitFurniId = furni.id;
        this.io.to(roomChannel(session.room.id)).emit('avatar:path', {
          userId: player.userId,
          path,
          direction: computeDirection({ x: player.x, y: player.y }, path[0]),
        });
      }
      return;
    }

    if (typeof payload?.x === 'number' && typeof payload?.y === 'number') {
      this.handleMove(socket, { x: payload.x, y: payload.y });
      return;
    }

    // Sit in place
    player.path = [];
    player.sitting = true;
    this.io.to(roomChannel(session.room.id)).emit('avatar:moved', {
      userId: player.userId,
      x: player.x,
      y: player.y,
      z: player.z,
      direction: player.direction,
      sitting: true,
      sittingFurniId: player.sittingFurniId,
    });
  }

  handleStand(socket: GameSocket): void {
    const user = getSocketUser(socket);
    if (!user?.currentRoomId) return;

    const session = this.sessions.get(user.currentRoomId);
    const player = session?.players.get(user.userId);
    if (!session || !player) return;

    player.sitting = false;
    player.sittingFurniId = null;
    this.io.to(roomChannel(session.room.id)).emit('avatar:moved', {
      userId: player.userId,
      x: player.x,
      y: player.y,
      z: player.z,
      direction: player.direction,
      sitting: false,
      sittingFurniId: null,
    });
  }

  handleEmote(socket: GameSocket, payload: { emote: EmoteType }): void {
    const user = getSocketUser(socket);
    if (!user?.currentRoomId) return;

    const emote = payload?.emote;
    if (!emote || !VALID_EMOTES.has(emote)) return;

    if (emote === 'sit') {
      const session = this.sessions.get(user.currentRoomId);
      const player = session?.players.get(user.userId);
      if (player?.sitting) {
        this.handleStand(socket);
      } else {
        this.handleSit(socket, {});
      }
      return;
    }

    this.setPlayerEmote(user.currentRoomId, user.userId, emote);
  }

  async handleAvatarUpdate(
    socket: GameSocket,
    payload: { avatar: AvatarConfig; motto?: string }
  ): Promise<void> {
    const user = getSocketUser(socket);
    if (!user) return;

    try {
      const updated = await this.store.updateAvatar(user.userId, payload.avatar);
      let finalMotto = updated?.motto ?? '';
      if (typeof payload.motto === 'string') {
        const cleanMotto = payload.motto.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 120);
        const mottoUpdated = await this.store.updateMotto(user.userId, cleanMotto);
        finalMotto = mottoUpdated?.motto ?? cleanMotto;
      }

      if (!user.currentRoomId) return;
      const session = this.sessions.get(user.currentRoomId);
      const player = session?.players.get(user.userId);
      if (!session || !player) return;

      player.avatar = payload.avatar;
      player.motto = finalMotto;
      player.baseSpeedMultiplier = getMobilitySpeed(payload.avatar);
      player.speedMultiplier = Math.max(player.speedMultiplier, player.baseSpeedMultiplier);

      this.io.to(roomChannel(session.room.id)).emit('avatar:updated', {
        userId: user.userId,
        avatar: player.avatar,
        motto: player.motto,
      });
    } catch (err) {
      console.error('[RoomManager] handleAvatarUpdate error:', err);
    }
  }

  async handleChat(
    socket: GameSocket,
    payload: { text: string; mode?: ChatMode; targetUsername?: string }
  ): Promise<void> {
    const user = getSocketUser(socket);
    if (!user?.currentRoomId) return;

    const session = this.sessions.get(user.currentRoomId);
    if (!session) return;

    const rawText = typeof payload?.text === 'string' ? payload.text : '';
    const sanitized = rawText.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 240);
    if (!sanitized) return;

    // Rate limiting: max 5 messages per 4 seconds
    const now = Date.now();
    const recent = (this.chatTimestamps.get(user.userId) ?? []).filter(
      (ts) => now - ts < CHAT_RATE_LIMIT_WINDOW_MS
    );
    if (recent.length >= CHAT_RATE_LIMIT_MAX) {
      socket.emit('notification', {
        id: uuidv4(),
        type: 'warning',
        title: 'Slow Down!',
        message: 'You are chatting too fast. Please wait a moment.',
      });
      return;
    }
    recent.push(now);
    this.chatTimestamps.set(user.userId, recent);

    const mode: ChatMode =
      payload.mode === 'shout' || payload.mode === 'whisper' ? payload.mode : 'normal';

    if (mode === 'whisper') {
      const targetName = payload.targetUsername?.trim().toLowerCase();
      if (!targetName) {
        socket.emit('error', { code: 'WHISPER_TARGET', message: 'Specify a player to whisper to' });
        return;
      }

      const targetPlayer = Array.from(session.players.values()).find(
        (p) => p.username.toLowerCase() === targetName
      );
      if (!targetPlayer) {
        socket.emit('notification', {
          id: uuidv4(),
          type: 'warning',
          title: 'Whisper Failed',
          message: `Player "${payload.targetUsername}" is not in this room.`,
        });
        return;
      }

      const message: ChatMessage = {
        id: uuidv4(),
        roomId: session.room.id,
        userId: user.userId,
        username: user.username,
        text: sanitized,
        mode: 'whisper',
        targetUsername: targetPlayer.username,
        timestamp: now,
      };

      socket.emit('chat:message', message);
      if (!targetPlayer.isNpc && targetPlayer.userId !== user.userId) {
        await this.social.emitToUser(targetPlayer.userId, 'chat:message', message);
      }
      return;
    }

    const message: ChatMessage = {
      id: uuidv4(),
      roomId: session.room.id,
      userId: user.userId,
      username: user.username,
      text: sanitized,
      mode,
      timestamp: now,
    };

    this.appendChatHistory(session, message);
    this.io.to(roomChannel(session.room.id)).emit('chat:message', message);
  }

  private validateFurniturePlacement(
    room: RoomState,
    catalogItemId: string,
    x: number,
    y: number,
    rotation: Rotation4,
    ignoreFurniId?: string
  ): { ok: boolean; z: number; error?: string } {
    const item = getCatalogItem(catalogItemId);
    if (!item) return { ok: false, z: 0, error: 'Unknown catalog item' };

    const footprint = getFurnitureFootprint(x, y, item.width, item.depth, rotation);
    for (const tile of footprint) {
      if (tile.x < 0 || tile.x >= room.width || tile.y < 0 || tile.y >= room.height) {
        return { ok: false, z: 0, error: 'Out of room bounds' };
      }
      if (room.heightMap?.[tile.y]?.[tile.x] !== undefined && room.heightMap[tile.y][tile.x] < 0) {
        return { ok: false, z: 0, error: 'Cannot place furniture on void tile' };
      }
    }

    let placementZ = room.heightMap?.[y]?.[x] ?? 0;
    const occupiedKeys = new Set(footprint.map((t) => tileKey(t.x, t.y)));

    for (const other of room.furniture) {
      if (other.id === ignoreFurniId) continue;
      const otherCatalog = getCatalogItem(other.catalogItemId);
      if (!otherCatalog) continue;

      const otherFootprint = getFurnitureFootprint(
        other.x,
        other.y,
        otherCatalog.width,
        otherCatalog.depth,
        other.rotation
      );
      const overlaps = otherFootprint.some((t) => occupiedKeys.has(tileKey(t.x, t.y)));
      if (!overlaps) continue;

      // Allow placing on walkable rugs/floors or stackable tables/surfaces
      if (otherCatalog.walkable && !item.walkable) {
        placementZ = Math.max(placementZ, other.z + otherCatalog.height * 0.5);
        continue;
      }
      if (otherCatalog.stackable) {
        placementZ = Math.max(placementZ, other.z + otherCatalog.height);
        continue;
      }
      return { ok: false, z: 0, error: 'Space is occupied by another item' };
    }

    return { ok: true, z: Number(placementZ.toFixed(2)) };
  }

  async handleFurniPlace(
    socket: GameSocket,
    payload: { inventoryItemId: string; x: number; y: number; rotation?: Rotation4 },
    callback?: (res: { ok: boolean; error?: string; furniture?: PlacedFurniture }) => void
  ): Promise<void> {
    const user = getSocketUser(socket);
    if (!user?.currentRoomId) {
      callback?.({ ok: false, error: 'Not in a room' });
      return;
    }

    const session = this.sessions.get(user.currentRoomId);
    if (!session) {
      callback?.({ ok: false, error: 'Room session not found' });
      return;
    }

    if (!this.canBuildInRoom(session.room, user.userId, user.role)) {
      callback?.({ ok: false, error: 'You do not have permission to build in this room' });
      return;
    }

    try {
      const invItem = await this.store.getInventoryItem(user.userId, payload.inventoryItemId);
      if (!invItem) {
        callback?.({ ok: false, error: 'Item not found in your inventory' });
        return;
      }

      const catalogItem = getCatalogItem(invItem.catalogItemId);
      if (!catalogItem || catalogItem.category === 'cosmetic') {
        callback?.({ ok: false, error: 'This item cannot be placed as furniture' });
        return;
      }

      const x = Math.round(Number(payload.x));
      const y = Math.round(Number(payload.y));
      const rotation = ((payload.rotation ?? 0) % 4) as Rotation4;

      const check = this.validateFurniturePlacement(session.room, invItem.catalogItemId, x, y, rotation);
      if (!check.ok) {
        callback?.({ ok: false, error: check.error });
        return;
      }

      const removed = await this.store.removeInventoryItem(user.userId, invItem.id);
      if (!removed) {
        callback?.({ ok: false, error: 'Could not consume inventory item' });
        return;
      }

      const placed = await this.store.addFurniture(session.room.id, {
        catalogItemId: invItem.catalogItemId,
        ownerId: user.userId,
        x,
        y,
        z: check.z,
        rotation,
        state: {},
      });

      session.room.furniture.push(placed);
      this.io.to(roomChannel(session.room.id)).emit('furni:placed', { furniture: placed });
      callback?.({ ok: true, furniture: placed });
    } catch (err) {
      console.error('[RoomManager] handleFurniPlace error:', err);
      callback?.({ ok: false, error: 'Failed to place furniture' });
    }
  }

  async handleFurniMove(
    socket: GameSocket,
    payload: { furniId: string; x: number; y: number; rotation?: Rotation4 },
    callback?: (res: { ok: boolean; error?: string }) => void
  ): Promise<void> {
    const user = getSocketUser(socket);
    if (!user?.currentRoomId) {
      callback?.({ ok: false, error: 'Not in a room' });
      return;
    }

    const session = this.sessions.get(user.currentRoomId);
    if (!session) {
      callback?.({ ok: false, error: 'Room not found' });
      return;
    }

    if (!this.canBuildInRoom(session.room, user.userId, user.role)) {
      callback?.({ ok: false, error: 'No build permission' });
      return;
    }

    const furni = session.room.furniture.find((f) => f.id === payload.furniId);
    if (!furni) {
      callback?.({ ok: false, error: 'Furniture not found' });
      return;
    }

    const x = Math.round(Number(payload.x));
    const y = Math.round(Number(payload.y));
    const rotation = ((payload.rotation ?? furni.rotation) % 4) as Rotation4;

    const check = this.validateFurniturePlacement(
      session.room,
      furni.catalogItemId,
      x,
      y,
      rotation,
      furni.id
    );
    if (!check.ok) {
      callback?.({ ok: false, error: check.error });
      return;
    }

    try {
      const updated = await this.store.updateFurniture(session.room.id, furni.id, {
        x,
        y,
        z: check.z,
        rotation,
      });
      if (!updated) {
        callback?.({ ok: false, error: 'Failed to update furniture' });
        return;
      }

      furni.x = updated.x;
      furni.y = updated.y;
      furni.z = updated.z;
      furni.rotation = updated.rotation;

      this.io.to(roomChannel(session.room.id)).emit('furni:moved', { furniture: furni });
      callback?.({ ok: true });
    } catch (err) {
      console.error('[RoomManager] handleFurniMove error:', err);
      callback?.({ ok: false, error: 'Failed to move furniture' });
    }
  }

  async handleFurniRotate(
    socket: GameSocket,
    payload: { furniId: string; rotation?: Rotation4 },
    callback?: (res: { ok: boolean; error?: string }) => void
  ): Promise<void> {
    const user = getSocketUser(socket);
    if (!user?.currentRoomId) {
      callback?.({ ok: false, error: 'Not in a room' });
      return;
    }

    const session = this.sessions.get(user.currentRoomId);
    const furni = session?.room.furniture.find((f) => f.id === payload.furniId);
    if (!session || !furni) {
      callback?.({ ok: false, error: 'Furniture not found' });
      return;
    }

    const nextRotation = (
      payload.rotation !== undefined ? payload.rotation % 4 : (furni.rotation + 1) % 4
    ) as Rotation4;

    await this.handleFurniMove(
      socket,
      { furniId: furni.id, x: furni.x, y: furni.y, rotation: nextRotation },
      callback
    );
  }

  async handleFurniPickup(
    socket: GameSocket,
    payload: { furniId: string },
    callback?: (res: { ok: boolean; error?: string }) => void
  ): Promise<void> {
    const user = getSocketUser(socket);
    if (!user?.currentRoomId) {
      callback?.({ ok: false, error: 'Not in a room' });
      return;
    }

    const session = this.sessions.get(user.currentRoomId);
    if (!session) {
      callback?.({ ok: false, error: 'Room not found' });
      return;
    }

    if (!this.canBuildInRoom(session.room, user.userId, user.role)) {
      callback?.({ ok: false, error: 'No build permission' });
      return;
    }

    const idx = session.room.furniture.findIndex((f) => f.id === payload.furniId);
    if (idx === -1) {
      callback?.({ ok: false, error: 'Furniture not found' });
      return;
    }

    const furni = session.room.furniture[idx];

    try {
      const removed = await this.store.removeFurniture(session.room.id, furni.id);
      if (!removed) {
        callback?.({ ok: false, error: 'Failed to remove furniture' });
        return;
      }

      session.room.furniture.splice(idx, 1);

      // Return item to owner's inventory
      const returnToUserId = furni.ownerId === 'system' ? user.userId : furni.ownerId;
      await this.store.addInventoryItem(returnToUserId, furni.catalogItemId);

      // Stand up any player sitting on this furniture
      for (const player of session.players.values()) {
        if (player.sittingFurniId === furni.id) {
          player.sitting = false;
          player.sittingFurniId = null;
          this.io.to(roomChannel(session.room.id)).emit('avatar:moved', {
            userId: player.userId,
            x: player.x,
            y: player.y,
            z: player.z,
            direction: player.direction,
            sitting: false,
            sittingFurniId: null,
          });
        }
      }

      this.io.to(roomChannel(session.room.id)).emit('furni:removed', { furniId: furni.id });
      callback?.({ ok: true });
    } catch (err) {
      console.error('[RoomManager] handleFurniPickup error:', err);
      callback?.({ ok: false, error: 'Failed to pick up furniture' });
    }
  }

  async handleFurniInteract(socket: GameSocket, payload: { furniId: string }): Promise<void> {
    const user = getSocketUser(socket);
    if (!user?.currentRoomId) return;

    const session = this.sessions.get(user.currentRoomId);
    const furni = session?.room.furniture.find((f) => f.id === payload?.furniId);
    if (!session || !furni) return;

    const item = getCatalogItem(furni.catalogItemId);
    if (!item || !item.interactable) return;

    if (item.interactionType === 'sit') {
      this.handleSit(socket, { furniId: furni.id });
      return;
    }

    let effect: string | undefined;
    const nextState: Record<string, unknown> = { ...furni.state };

    switch (item.interactionType) {
      case 'toggle':
      case 'disco':
      case 'jacuzzi':
      case 'music': {
        const isOn = !Boolean(nextState.on);
        nextState.on = isOn;
        effect = isOn ? `${item.interactionType}_on` : `${item.interactionType}_off`;
        break;
      }
      case 'dice': {
        const roll = Math.floor(Math.random() * 6) + 1;
        nextState.value = roll;
        effect = `dice_${roll}`;
        this.broadcastSystemChat(session.room.id, `🎲 ${user.username} rolled a ${roll}!`);
        break;
      }
      case 'jukebox': {
        const tracks = ['Lobby Jazz', 'Neon Chiptune', 'Poolside Synth', 'Turbo Eurobeat'];
        const nextTrack = ((Number(nextState.track) || 0) + 1) % tracks.length;
        nextState.track = nextTrack;
        nextState.on = true;
        effect = `track_${nextTrack}`;
        this.broadcastSystemChat(
          session.room.id,
          `🎵 ${user.username} switched the jukebox to "${tracks[nextTrack]}"!`
        );
        break;
      }
      case 'vending': {
        const drinks = ['HandiFizz Cola', 'Pixel Berry Soda', 'Turbo Lemon-Lime', 'Velvet Espresso'];
        const drink = drinks[Math.floor(Math.random() * drinks.length)];
        nextState.lastDispensed = Date.now();
        effect = 'dispense';
        this.broadcastSystemChat(session.room.id, `🥤 ${user.username} grabbed a cold ${drink}!`);
        break;
      }
      case 'claw_machine': {
        const prizes = ['Mini Rubber Duck', 'Golden Wheelie Keychain', 'Plushie Bellhop', 'Empty Air (almost!)'];
        const prize = prizes[Math.floor(Math.random() * prizes.length)];
        nextState.lastPlay = Date.now();
        effect = 'claw_grab';
        this.broadcastSystemChat(session.room.id, `🕹️ ${user.username} tried the Claw Machine and got: ${prize}!`);
        break;
      }
      case 'arcade': {
        const score = (Math.floor(Math.random() * 90) + 10) * 100;
        nextState.highScore = Math.max(Number(nextState.highScore) || 0, score);
        effect = 'arcade_play';
        this.broadcastSystemChat(
          session.room.id,
          `👾 ${user.username} scored ${score} pts on Wheelie Blaster 9000!`
        );
        break;
      }
      case 'boost_pad': {
        this.setPlayerSpeedBoost(session.room.id, user.userId, 1.75, 3500);
        effect = 'boost';
        break;
      }
      case 'elevator': {
        effect = 'elevator';
        break;
      }
      default:
        break;
    }

    furni.state = nextState;
    try {
      await this.store.updateFurniture(session.room.id, furni.id, { state: nextState });
    } catch {
      // Non-fatal for transient interaction state
    }

    this.io.to(roomChannel(session.room.id)).emit('furni:updated', { furniture: furni, effect });
  }

  async handleUpdateSettings(
    socket: GameSocket,
    payload: { roomId: string; patch: RoomSettingsPatch },
    callback?: (res: { ok: boolean; error?: string }) => void
  ): Promise<void> {
    const user = getSocketUser(socket);
    if (!user) {
      callback?.({ ok: false, error: 'Not authenticated' });
      return;
    }

    const roomId = payload?.roomId ?? user.currentRoomId;
    if (!roomId) {
      callback?.({ ok: false, error: 'Room ID required' });
      return;
    }

    const session = await this.ensureSession(roomId);
    if (!session) {
      callback?.({ ok: false, error: 'Room not found' });
      return;
    }

    if (!this.canBuildInRoom(session.room, user.userId, user.role)) {
      callback?.({ ok: false, error: 'Only the room owner can update settings' });
      return;
    }

    try {
      const updated = await this.store.updateRoomSettings(roomId, payload.patch);
      if (!updated) {
        callback?.({ ok: false, error: 'Failed to update room settings' });
        return;
      }

      // Preserve live furniture list and update metadata/styles/permissions
      session.room = { ...updated, furniture: session.room.furniture };
      this.io.to(roomChannel(roomId)).emit('room:settingsUpdated', { room: session.room });
      callback?.({ ok: true });
    } catch (err) {
      console.error('[RoomManager] handleUpdateSettings error:', err);
      callback?.({ ok: false, error: 'Failed to update room settings' });
    }
  }

  async handleLikeRoom(socket: GameSocket, payload: { roomId: string }): Promise<void> {
    const user = getSocketUser(socket);
    if (!user) return;

    const roomId = payload?.roomId ?? user.currentRoomId;
    if (!roomId) return;

    try {
      const likes = await this.store.likeRoom(roomId, user.userId);
      const session = this.sessions.get(roomId);
      if (session) {
        session.room.likes = likes;
      }
      this.io.to(roomChannel(roomId)).emit('room:liked', { roomId, likes });
    } catch (err) {
      console.error('[RoomManager] handleLikeRoom error:', err);
    }
  }

  async handleKick(
    socket: GameSocket,
    payload: { roomId: string; targetUserId: string }
  ): Promise<void> {
    const user = getSocketUser(socket);
    if (!user) return;

    const roomId = payload?.roomId ?? user.currentRoomId;
    if (!roomId || !payload?.targetUserId) return;

    const session = this.sessions.get(roomId);
    if (!session) return;

    if (!this.canBuildInRoom(session.room, user.userId, user.role)) {
      socket.emit('error', { code: 'FORBIDDEN', message: 'You cannot kick users from this room' });
      return;
    }

    if (payload.targetUserId === session.room.ownerId) return;

    const targetSocketIds = await this.presence.getUserSocketIds(payload.targetUserId);
    session.players.delete(payload.targetUserId);

    for (const sid of targetSocketIds) {
      const targetSocket = this.io.sockets.sockets.get(sid);
      if (targetSocket) {
        await targetSocket.leave(roomChannel(roomId));
        if ((targetSocket.data as { currentRoomId?: string | null }).currentRoomId === roomId) {
          (targetSocket.data as { currentRoomId: string | null }).currentRoomId = null;
        }
        targetSocket.emit('room:kicked', {
          roomId,
          reason: `You were kicked from ${session.room.name} by ${user.username}.`,
        });
      }
    }

    this.io.to(roomChannel(roomId)).emit('room:userLeft', { userId: payload.targetUserId });
    await this.presence.setUserRoom(payload.targetUserId, null, null);
  }
}
