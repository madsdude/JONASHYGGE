import fs from 'node:fs/promises';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import {
  AVATAR_PRESETS,
  DEFAULT_AVATAR_CONFIG,
  PUBLIC_ROOMS,
  ROOM_TEMPLATES,
  getCatalogItem,
  type AvatarConfig,
  type DailyRewardStatus,
  type DirectMessage,
  type FriendInfo,
  type FriendRequestInfo,
  type HotelEventInfo,
  type InventoryItem,
  type LeaderboardEntry,
  type MinigameType,
  type PlacedFurniture,
  type ReportPayload,
  type RoomSettingsPatch,
  type RoomState,
  type RoomSummary,
  type TransactionRecord,
  type TransactionType,
  type UserProfile,
} from '@handihotel/shared';
import { config } from '../config.js';
import { hashPassword } from '../security/auth.js';
import {
  toPublicUserProfile,
  type AddFurnitureInput,
  type CreateRoomInput,
  type CreateUserInput,
  type ExecuteTradeInput,
  type ExecuteTradeResult,
  type IDataStore,
  type PurchaseResult,
  type RecordMinigameScoreInput,
  type StoredUser,
  type UpdateFurniturePatch,
  type UpsertHotelEventInput,
} from './store.js';

interface FriendshipRecord {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: 'PENDING' | 'ACCEPTED' | 'BLOCKED';
  createdAt: string;
  updatedAt: string;
}

interface ReportRecord {
  id: string;
  reporterId: string;
  targetUserId?: string;
  targetUsername?: string;
  roomId?: string;
  reason: string;
  details: string;
  status: string;
  createdAt: string;
}

interface MinigameScoreRecord {
  id: string;
  userId: string;
  gameType: MinigameType;
  score: number;
  won: boolean;
  timeMs?: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

interface TradeLogRecord {
  id: string;
  userAId: string;
  userBId: string;
  offerA: { itemIds: string[]; credits: number };
  offerB: { itemIds: string[]; credits: number };
  status: string;
  createdAt: string;
}

interface LocalDbSnapshot {
  version: number;
  users: StoredUser[];
  rooms: RoomState[];
  roomLikes: Record<string, string[]>;
  inventory: InventoryItem[];
  transactions: TransactionRecord[];
  friendships: FriendshipRecord[];
  directMessages: DirectMessage[];
  reports: ReportRecord[];
  minigameScores: MinigameScoreRecord[];
  events: HotelEventInfo[];
  tradeLogs: TradeLogRecord[];
}

const DAILY_COOLDOWN_MS = 20 * 60 * 60 * 1000; // 20 hours for forgiving daily claims
const STREAK_RESET_MS = 48 * 60 * 60 * 1000;

function computeDailyReward(streak: number): { credits: number; stars: number } {
  const capped = Math.min(Math.max(streak, 1), 7);
  return {
    credits: 100 + (capped - 1) * 50,
    stars: 5 + (capped - 1) * 3,
  };
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class LocalJsonStore implements IDataStore {
  readonly backend = 'local' as const;

  private data: LocalDbSnapshot = {
    version: 1,
    users: [],
    rooms: [],
    roomLikes: {},
    inventory: [],
    transactions: [],
    friendships: [],
    directMessages: [],
    reports: [],
    minigameScores: [],
    events: [],
    tradeLogs: [],
  };

  private saveTimer: NodeJS.Timeout | null = null;
  private isWriting = false;
  private pendingWrite = false;
  private readonly filePath: string;

  constructor(filePath = config.localDataFile) {
    this.filePath = filePath;
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    let loaded = false;
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<LocalDbSnapshot>;
      this.data = {
        version: parsed.version ?? 1,
        users: parsed.users ?? [],
        rooms: parsed.rooms ?? [],
        roomLikes: parsed.roomLikes ?? {},
        inventory: parsed.inventory ?? [],
        transactions: parsed.transactions ?? [],
        friendships: parsed.friendships ?? [],
        directMessages: parsed.directMessages ?? [],
        reports: parsed.reports ?? [],
        minigameScores: parsed.minigameScores ?? [],
        events: parsed.events ?? [],
        tradeLogs: parsed.tradeLogs ?? [],
      };
      loaded = true;
    } catch {
      loaded = false;
    }

    await this.ensureSeedData();

    if (!loaded) {
      await this.flushNow();
    }
  }

  async close(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.flushNow();
  }

  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flushNow();
    }, 250);
  }

  private async flushNow(): Promise<void> {
    if (this.isWriting) {
      this.pendingWrite = true;
      return;
    }
    this.isWriting = true;
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const tmpPath = `${this.filePath}.tmp`;
      const payload = JSON.stringify(this.data, null, 2);
      await fs.writeFile(tmpPath, payload, 'utf-8');
      await fs.rename(tmpPath, this.filePath);
    } catch (err) {
      console.error('[LocalJsonStore] Failed to persist data:', err);
    } finally {
      this.isWriting = false;
      if (this.pendingWrite) {
        this.pendingWrite = false;
        void this.flushNow();
      }
    }
  }

  private async ensureSeedData(): Promise<void> {
    let mutated = false;

    // 1. Seed all 11 official PUBLIC_ROOMS if missing
    const existingRoomIds = new Set(this.data.rooms.map((r) => r.id));
    for (const pubRoom of PUBLIC_ROOMS) {
      if (!existingRoomIds.has(pubRoom.id)) {
        this.data.rooms.push(deepClone(pubRoom));
        mutated = true;
      }
    }

    // 2. Seed 2 demo users ("hotelhost" / "demo1234", "turbo_wheelie" / "demo1234")
    const demoPasswordHash = await hashPassword('demo1234');
    const now = new Date().toISOString();

    if (!this.data.users.some((u) => u.username.toLowerCase() === 'hotelhost')) {
      const hostId = 'user-demo-hotelhost';
      const conciergeAvatar =
        AVATAR_PRESETS.find((p) => p.name === 'Hotel Concierge')?.config ??
        DEFAULT_AVATAR_CONFIG;

      this.data.users.push({
        id: hostId,
        username: 'hotelhost',
        email: 'hotelhost@handihotel.local',
        passwordHash: demoPasswordHash,
        motto: 'Welcome to HandiHotel! Ring the concierge bell anytime.',
        avatar: deepClone(conciergeAvatar),
        credits: 5000,
        stars: 250,
        role: 'admin',
        level: 12,
        xp: 2400,
        banned: false,
        lastDailyClaim: null,
        dailyStreak: 0,
        createdAt: now,
        lastOnlineAt: now,
        onlineStatus: 'offline',
        currentRoomId: null,
        currentRoomName: null,
        badges: ['founder', 'concierge', 'vip_host'],
        favoriteRoomIds: ['public-lobby', 'public-event-hall'],
        ownedCosmetics: ['top_hat', 'crown'],
      });

      for (const catalogItemId of [
        'velvet_sofa',
        'coffee_table_oak',
        'potted_palm',
        'disco_ball',
        'rubber_duck_giant',
      ]) {
        this.data.inventory.push({
          id: uuidv4(),
          userId: hostId,
          catalogItemId,
          acquiredAt: now,
          placedInRoomId: null,
        });
      }
      mutated = true;
    }

    if (!this.data.users.some((u) => u.username.toLowerCase() === 'turbo_wheelie')) {
      const racerId = 'user-demo-turbowheelie';
      const racerAvatar =
        AVATAR_PRESETS.find((p) => p.name === 'Turbo Racer')?.config ??
        DEFAULT_AVATAR_CONFIG;

      this.data.users.push({
        id: racerId,
        username: 'turbo_wheelie',
        email: 'turbo@handihotel.local',
        passwordHash: demoPasswordHash,
        motto: 'Catch me in the Turbo Wheelchair Race Arena!',
        avatar: deepClone(racerAvatar),
        credits: 2500,
        stars: 120,
        role: 'vip',
        level: 8,
        xp: 1450,
        banned: false,
        lastDailyClaim: null,
        dailyStreak: 2,
        createdAt: now,
        lastOnlineAt: now,
        onlineStatus: 'offline',
        currentRoomId: null,
        currentRoomName: null,
        badges: ['speed_demon', 'early_guest'],
        favoriteRoomIds: ['public-race-arena', 'public-arcade'],
        ownedCosmetics: ['sunglasses', 'racing_wheelchair'],
      });

      for (const catalogItemId of [
        'club_sofa_teal',
        'arcade_cabinet',
        'neon_floor_lamp',
        'accessibility_ramp',
      ]) {
        this.data.inventory.push({
          id: uuidv4(),
          userId: racerId,
          catalogItemId,
          acquiredAt: now,
          placedInRoomId: null,
        });
      }
      mutated = true;
    }

    // 3. Seed 3 active/upcoming HotelEvents if empty
    if (this.data.events.length === 0) {
      const nowMs = Date.now();
      const hour = 60 * 60 * 1000;
      this.data.events.push(
        {
          id: 'event-turbo-gp',
          title: 'Turbo Wheelchair Grand Prix',
          description:
            'High-speed 3-lap championship in the Turbo Wheelchair Race Arena! Hit the boost pads and claim the golden trophy.',
          roomId: 'public-race-arena',
          roomName: 'Turbo Wheelchair Race Arena',
          hostUsername: 'turbo_wheelie',
          startsAt: new Date(nowMs - hour).toISOString(),
          endsAt: new Date(nowMs + 12 * hour).toISOString(),
          active: true,
          rewardCredits: 350,
          rewardStars: 25,
          minigameType: 'wheelchair_racing',
        },
        {
          id: 'event-neon-dance',
          title: 'Neon Nightclub Dance Battle',
          description:
            'Show off your rhythm on the glowing dance floor! Hit combos to win credits and VIP stars.',
          roomId: 'public-nightclub',
          roomName: 'Neon Nightclub',
          hostUsername: 'hotelhost',
          startsAt: new Date(nowMs - 30 * 60 * 1000).toISOString(),
          endsAt: new Date(nowMs + 8 * hour).toISOString(),
          active: true,
          rewardCredits: 250,
          rewardStars: 15,
          minigameType: 'dance_battle',
        },
        {
          id: 'event-hotel-olympics',
          title: 'Grand Ballroom Hotel Olympics',
          description:
            'Sprint, slalom, and target toss in the Grand Event Ballroom! Open to all hotel guests.',
          roomId: 'public-event-hall',
          roomName: 'Grand Event Ballroom',
          hostUsername: 'hotelhost',
          startsAt: new Date(nowMs + 2 * hour).toISOString(),
          endsAt: new Date(nowMs + 24 * hour).toISOString(),
          active: false,
          rewardCredits: 500,
          rewardStars: 40,
          minigameType: 'hotel_olympics',
        }
      );
      mutated = true;
    }

    if (mutated) {
      this.scheduleSave();
    }
  }

  private toRoomSummary(room: RoomState): RoomSummary {
    return {
      id: room.id,
      name: room.name,
      description: room.description,
      ownerId: room.ownerId,
      ownerUsername: room.ownerUsername,
      isPublic: room.isPublic,
      templateId: room.templateId,
      theme: room.theme,
      userCount: 0,
      maxUsers: room.permissions.maxUsers,
      likes: room.likes,
      accessMode: room.permissions.accessMode,
      tags: [...room.tags],
    };
  }

  // ==================== USERS ====================

  async createUser(input: CreateUserInput): Promise<StoredUser> {
    const normalizedUsername = input.username.trim().toLowerCase();
    const normalizedEmail = input.email.trim().toLowerCase();

    if (this.data.users.some((u) => u.username.toLowerCase() === normalizedUsername)) {
      throw new Error('Username is already taken');
    }
    if (this.data.users.some((u) => u.email.toLowerCase() === normalizedEmail)) {
      throw new Error('Email is already registered');
    }

    const now = new Date().toISOString();
    const user: StoredUser = {
      id: uuidv4(),
      username: input.username.trim(),
      email: normalizedEmail,
      passwordHash: input.passwordHash,
      motto: input.motto ?? 'Welcome to HandiHotel!',
      avatar: deepClone(input.avatar ?? DEFAULT_AVATAR_CONFIG),
      credits: input.credits ?? 1500,
      stars: input.stars ?? 100,
      role: input.role ?? 'player',
      level: 1,
      xp: 0,
      banned: false,
      lastDailyClaim: null,
      dailyStreak: 0,
      createdAt: now,
      lastOnlineAt: now,
      onlineStatus: 'online',
      currentRoomId: null,
      currentRoomName: null,
      badges: ['new_guest'],
      favoriteRoomIds: ['public-lobby'],
      ownedCosmetics: [],
    };

    this.data.users.push(user);

    // Give starter welcome furniture
    for (const catalogItemId of ['velvet_sofa', 'bistro_chair', 'potted_palm']) {
      this.data.inventory.push({
        id: uuidv4(),
        userId: user.id,
        catalogItemId,
        acquiredAt: now,
        placedInRoomId: null,
      });
    }

    this.scheduleSave();
    return deepClone(user);
  }

  async findUserById(userId: string): Promise<StoredUser | null> {
    const user = this.data.users.find((u) => u.id === userId);
    return user ? deepClone(user) : null;
  }

  async findUserByUsername(username: string): Promise<StoredUser | null> {
    const target = username.trim().toLowerCase();
    const user = this.data.users.find((u) => u.username.toLowerCase() === target);
    return user ? deepClone(user) : null;
  }

  async findUserByEmail(email: string): Promise<StoredUser | null> {
    const target = email.trim().toLowerCase();
    const user = this.data.users.find((u) => u.email.toLowerCase() === target);
    return user ? deepClone(user) : null;
  }

  async updateAvatar(userId: string, avatar: AvatarConfig): Promise<StoredUser | null> {
    const user = this.data.users.find((u) => u.id === userId);
    if (!user) return null;
    user.avatar = deepClone(avatar);
    user.lastOnlineAt = new Date().toISOString();
    this.scheduleSave();
    return deepClone(user);
  }

  async updateMotto(userId: string, motto: string): Promise<StoredUser | null> {
    const user = this.data.users.find((u) => u.id === userId);
    if (!user) return null;
    user.motto = motto;
    user.lastOnlineAt = new Date().toISOString();
    this.scheduleSave();
    return deepClone(user);
  }

  async updateBalance(
    userId: string,
    creditsDelta: number,
    starsDelta: number,
    type: TransactionType,
    description: string
  ): Promise<{ credits: number; stars: number; transaction: TransactionRecord }> {
    const user = this.data.users.find((u) => u.id === userId);
    if (!user) {
      throw new Error('User not found');
    }

    const nextCredits = user.credits + creditsDelta;
    const nextStars = user.stars + starsDelta;
    if (nextCredits < 0 || nextStars < 0) {
      throw new Error('Insufficient funds');
    }

    user.credits = nextCredits;
    user.stars = nextStars;

    const transaction: TransactionRecord = {
      id: uuidv4(),
      userId,
      type,
      creditsDelta,
      starsDelta,
      description,
      createdAt: new Date().toISOString(),
    };
    this.data.transactions.unshift(transaction);
    this.scheduleSave();

    return {
      credits: user.credits,
      stars: user.stars,
      transaction: deepClone(transaction),
    };
  }

  async getDailyRewardStatus(userId: string): Promise<DailyRewardStatus> {
    const user = this.data.users.find((u) => u.id === userId);
    if (!user) {
      throw new Error('User not found');
    }

    const now = Date.now();
    const lastMs = user.lastDailyClaim ? Date.parse(user.lastDailyClaim) : null;
    const canClaim = lastMs === null || now - lastMs >= DAILY_COOLDOWN_MS;
    const streakBroken = lastMs !== null && now - lastMs > STREAK_RESET_MS;
    const nextStreak = streakBroken ? 1 : user.dailyStreak + 1;
    const reward = computeDailyReward(nextStreak);

    return {
      canClaim,
      currentStreak: streakBroken ? 0 : user.dailyStreak,
      nextRewardCredits: reward.credits,
      nextRewardStars: reward.stars,
      lastClaimedAt: user.lastDailyClaim,
      nextClaimAvailableAt:
        canClaim || lastMs === null
          ? null
          : new Date(lastMs + DAILY_COOLDOWN_MS).toISOString(),
    };
  }

  async claimDailyReward(userId: string): Promise<{
    claimed: boolean;
    creditsAwarded: number;
    starsAwarded: number;
    streak: number;
    credits: number;
    stars: number;
    status: DailyRewardStatus;
  }> {
    const user = this.data.users.find((u) => u.id === userId);
    if (!user) {
      throw new Error('User not found');
    }

    const currentStatus = await this.getDailyRewardStatus(userId);
    if (!currentStatus.canClaim) {
      return {
        claimed: false,
        creditsAwarded: 0,
        starsAwarded: 0,
        streak: user.dailyStreak,
        credits: user.credits,
        stars: user.stars,
        status: currentStatus,
      };
    }

    const nextStreak = currentStatus.currentStreak + 1;
    const reward = computeDailyReward(nextStreak);
    const nowIso = new Date().toISOString();

    user.dailyStreak = nextStreak;
    user.lastDailyClaim = nowIso;
    user.credits += reward.credits;
    user.stars += reward.stars;
    user.xp += 50;
    user.level = Math.max(1, Math.floor(user.xp / 200) + 1);

    this.data.transactions.unshift({
      id: uuidv4(),
      userId,
      type: 'daily_reward',
      creditsDelta: reward.credits,
      starsDelta: reward.stars,
      description: `Daily check-in reward (Day ${nextStreak})`,
      createdAt: nowIso,
    });

    this.scheduleSave();
    const updatedStatus = await this.getDailyRewardStatus(userId);

    return {
      claimed: true,
      creditsAwarded: reward.credits,
      starsAwarded: reward.stars,
      streak: nextStreak,
      credits: user.credits,
      stars: user.stars,
      status: updatedStatus,
    };
  }

  async searchUsers(query: string, limit = 20): Promise<UserProfile[]> {
    const q = query.trim().toLowerCase();
    const matches = this.data.users
      .filter((u) => !u.banned && (!q || u.username.toLowerCase().includes(q)))
      .slice(0, limit)
      .map(toPublicUserProfile);
    return deepClone(matches);
  }

  async toggleFavoriteRoom(userId: string, roomId: string): Promise<string[]> {
    const user = this.data.users.find((u) => u.id === userId);
    if (!user) throw new Error('User not found');
    const idx = user.favoriteRoomIds.indexOf(roomId);
    if (idx >= 0) {
      user.favoriteRoomIds.splice(idx, 1);
    } else {
      user.favoriteRoomIds.push(roomId);
    }
    this.scheduleSave();
    return [...user.favoriteRoomIds];
  }

  // ==================== ROOMS ====================

  async listPublicRooms(): Promise<RoomSummary[]> {
    return this.data.rooms
      .filter((r) => r.isPublic)
      .map((r) => this.toRoomSummary(r));
  }

  async listRoomsByOwner(ownerId: string): Promise<RoomSummary[]> {
    return this.data.rooms
      .filter((r) => r.ownerId === ownerId)
      .map((r) => this.toRoomSummary(r));
  }

  async searchRooms(query: string, limit = 30): Promise<RoomSummary[]> {
    const q = query.trim().toLowerCase();
    return this.data.rooms
      .filter((r) => {
        if (!q) return true;
        return (
          r.name.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q) ||
          r.ownerUsername.toLowerCase().includes(q) ||
          r.tags.some((t) => t.toLowerCase().includes(q))
        );
      })
      .slice(0, limit)
      .map((r) => this.toRoomSummary(r));
  }

  async getRoomState(roomId: string): Promise<RoomState | null> {
    const room = this.data.rooms.find((r) => r.id === roomId);
    return room ? deepClone(room) : null;
  }

  async createRoom(input: CreateRoomInput): Promise<RoomState> {
    const template = ROOM_TEMPLATES[input.templateId] ?? ROOM_TEMPLATES.studio;
    const room: RoomState = {
      id: `room-${uuidv4().slice(0, 12)}`,
      name: input.name.trim(),
      description: input.description?.trim() ?? '',
      ownerId: input.ownerId,
      ownerUsername: input.ownerUsername,
      isPublic: input.isPublic ?? true,
      templateId: template.id,
      theme: input.theme ?? 'private',
      width: template.width,
      height: template.height,
      spawnX: template.spawnX,
      spawnY: template.spawnY,
      floorStyle: template.defaultFloorStyle,
      wallStyle: template.defaultWallStyle,
      floorColor: template.defaultFloorColor,
      wallColor: template.defaultWallColor,
      permissions: {
        accessMode: 'open',
        allowTrading: true,
        allowWalkThrough: true,
        maxUsers: template.maxUsers,
        bannedUserIds: [],
        moderatorUserIds: [],
      },
      likes: 0,
      tags: input.tags ?? ['private', template.id],
      furniture: [],
    };

    this.data.rooms.push(room);
    this.scheduleSave();
    return deepClone(room);
  }

  async updateRoomSettings(
    roomId: string,
    patch: RoomSettingsPatch
  ): Promise<RoomState | null> {
    const room = this.data.rooms.find((r) => r.id === roomId);
    if (!room) return null;

    if (patch.name !== undefined) room.name = patch.name;
    if (patch.description !== undefined) room.description = patch.description;
    if (patch.floorStyle !== undefined) room.floorStyle = patch.floorStyle;
    if (patch.wallStyle !== undefined) room.wallStyle = patch.wallStyle;
    if (patch.floorColor !== undefined) room.floorColor = patch.floorColor;
    if (patch.wallColor !== undefined) room.wallColor = patch.wallColor;
    if (patch.tags !== undefined) room.tags = [...patch.tags];
    if (patch.permissions !== undefined) {
      room.permissions = {
        ...room.permissions,
        ...patch.permissions,
      };
    }

    this.scheduleSave();
    return deepClone(room);
  }

  async likeRoom(roomId: string, userId: string): Promise<number> {
    const room = this.data.rooms.find((r) => r.id === roomId);
    if (!room) throw new Error('Room not found');

    const likers = this.data.roomLikes[roomId] ?? [];
    if (!likers.includes(userId)) {
      likers.push(userId);
      this.data.roomLikes[roomId] = likers;
      room.likes += 1;
      this.scheduleSave();
    }
    return room.likes;
  }

  async addFurniture(roomId: string, item: AddFurnitureInput): Promise<PlacedFurniture> {
    const room = this.data.rooms.find((r) => r.id === roomId);
    if (!room) throw new Error('Room not found');

    const placed: PlacedFurniture = {
      id: item.id ?? uuidv4(),
      roomId,
      catalogItemId: item.catalogItemId,
      ownerId: item.ownerId,
      x: item.x,
      y: item.y,
      z: item.z ?? 0,
      rotation: item.rotation ?? 0,
      state: item.state ? deepClone(item.state) : {},
    };

    room.furniture.push(placed);
    this.scheduleSave();
    return deepClone(placed);
  }

  async updateFurniture(
    roomId: string,
    furniId: string,
    patch: UpdateFurniturePatch
  ): Promise<PlacedFurniture | null> {
    const room = this.data.rooms.find((r) => r.id === roomId);
    if (!room) return null;

    const furni = room.furniture.find((f) => f.id === furniId);
    if (!furni) return null;

    if (patch.x !== undefined) furni.x = patch.x;
    if (patch.y !== undefined) furni.y = patch.y;
    if (patch.z !== undefined) furni.z = patch.z;
    if (patch.rotation !== undefined) furni.rotation = patch.rotation;
    if (patch.state !== undefined) {
      furni.state = { ...furni.state, ...patch.state };
    }

    this.scheduleSave();
    return deepClone(furni);
  }

  async removeFurniture(roomId: string, furniId: string): Promise<PlacedFurniture | null> {
    const room = this.data.rooms.find((r) => r.id === roomId);
    if (!room) return null;

    const idx = room.furniture.findIndex((f) => f.id === furniId);
    if (idx < 0) return null;

    const [removed] = room.furniture.splice(idx, 1);
    this.scheduleSave();
    return deepClone(removed);
  }

  // ==================== INVENTORY & ECONOMY ====================

  async getInventory(userId: string): Promise<InventoryItem[]> {
    return deepClone(
      this.data.inventory.filter(
        (item) => item.userId === userId && item.placedInRoomId === null
      )
    );
  }

  async getInventoryItem(
    userId: string,
    inventoryItemId: string
  ): Promise<InventoryItem | null> {
    const item = this.data.inventory.find(
      (i) => i.id === inventoryItemId && i.userId === userId
    );
    return item ? deepClone(item) : null;
  }

  async addInventoryItem(userId: string, catalogItemId: string): Promise<InventoryItem> {
    const item: InventoryItem = {
      id: uuidv4(),
      userId,
      catalogItemId,
      acquiredAt: new Date().toISOString(),
      placedInRoomId: null,
    };
    this.data.inventory.push(item);
    this.scheduleSave();
    return deepClone(item);
  }

  async removeInventoryItem(userId: string, inventoryItemId: string): Promise<boolean> {
    const idx = this.data.inventory.findIndex(
      (i) => i.id === inventoryItemId && i.userId === userId
    );
    if (idx < 0) return false;
    this.data.inventory.splice(idx, 1);
    this.scheduleSave();
    return true;
  }

  async purchaseCatalogItem(
    userId: string,
    catalogItemId: string,
    quantity = 1
  ): Promise<PurchaseResult> {
    const qty = Math.max(1, Math.min(20, Math.floor(quantity)));
    const catalogItem = getCatalogItem(catalogItemId);
    if (!catalogItem) {
      throw new Error('Catalog item not found');
    }

    const user = this.data.users.find((u) => u.id === userId);
    if (!user) {
      throw new Error('User not found');
    }

    const totalCredits = catalogItem.priceCredits * qty;
    const totalStars = catalogItem.priceStars * qty;

    if (user.credits < totalCredits) {
      throw new Error('Insufficient credits');
    }
    if (user.stars < totalStars) {
      throw new Error('Insufficient stars');
    }

    // Atomic in-memory update
    user.credits -= totalCredits;
    user.stars -= totalStars;

    const now = new Date().toISOString();
    const createdItems: InventoryItem[] = [];

    if (catalogItem.category === 'cosmetic' && catalogItem.cosmeticValue) {
      if (!user.ownedCosmetics.includes(catalogItem.cosmeticValue)) {
        user.ownedCosmetics.push(catalogItem.cosmeticValue);
      }
    }

    for (let i = 0; i < qty; i++) {
      const invItem: InventoryItem = {
        id: uuidv4(),
        userId,
        catalogItemId: catalogItem.id,
        acquiredAt: now,
        placedInRoomId: null,
      };
      this.data.inventory.push(invItem);
      createdItems.push(invItem);
    }

    const transaction: TransactionRecord = {
      id: uuidv4(),
      userId,
      type: 'purchase',
      creditsDelta: -totalCredits,
      starsDelta: -totalStars,
      description: `Purchased ${qty}x ${catalogItem.name}`,
      createdAt: now,
    };
    this.data.transactions.unshift(transaction);

    this.scheduleSave();

    return {
      items: deepClone(createdItems),
      credits: user.credits,
      stars: user.stars,
      ownedCosmetics: [...user.ownedCosmetics],
      transaction: deepClone(transaction),
    };
  }

  async executeTrade(input: ExecuteTradeInput): Promise<ExecuteTradeResult> {
    const userA = this.data.users.find((u) => u.id === input.userAId);
    const userB = this.data.users.find((u) => u.id === input.userBId);
    if (!userA || !userB) {
      throw new Error('Trade participant not found');
    }
    if (input.userACredits < 0 || input.userBCredits < 0) {
      throw new Error('Invalid trade credits');
    }
    if (userA.credits < input.userACredits) {
      throw new Error(`${userA.username} has insufficient credits`);
    }
    if (userB.credits < input.userBCredits) {
      throw new Error(`${userB.username} has insufficient credits`);
    }

    // Verify ownership of all offered items before mutating anything
    const itemsA = input.userAItemIds.map((id) => {
      const item = this.data.inventory.find(
        (i) => i.id === id && i.userId === userA.id && i.placedInRoomId === null
      );
      if (!item) {
        throw new Error(`${userA.username} does not own offered item ${id}`);
      }
      return item;
    });

    const itemsB = input.userBItemIds.map((id) => {
      const item = this.data.inventory.find(
        (i) => i.id === id && i.userId === userB.id && i.placedInRoomId === null
      );
      if (!item) {
        throw new Error(`${userB.username} does not own offered item ${id}`);
      }
      return item;
    });

    // Apply atomic swap
    userA.credits = userA.credits - input.userACredits + input.userBCredits;
    userB.credits = userB.credits - input.userBCredits + input.userACredits;

    const now = new Date().toISOString();
    for (const item of itemsA) {
      item.userId = userB.id;
      item.acquiredAt = now;
    }
    for (const item of itemsB) {
      item.userId = userA.id;
      item.acquiredAt = now;
    }

    const tradeId = uuidv4();
    this.data.tradeLogs.unshift({
      id: tradeId,
      userAId: userA.id,
      userBId: userB.id,
      offerA: { itemIds: [...input.userAItemIds], credits: input.userACredits },
      offerB: { itemIds: [...input.userBItemIds], credits: input.userBCredits },
      status: 'COMPLETED',
      createdAt: now,
    });

    const netA = input.userBCredits - input.userACredits;
    const netB = input.userACredits - input.userBCredits;

    this.data.transactions.unshift(
      {
        id: uuidv4(),
        userId: userA.id,
        type: 'trade',
        creditsDelta: netA,
        starsDelta: 0,
        description: `Traded with ${userB.username}`,
        createdAt: now,
      },
      {
        id: uuidv4(),
        userId: userB.id,
        type: 'trade',
        creditsDelta: netB,
        starsDelta: 0,
        description: `Traded with ${userA.username}`,
        createdAt: now,
      }
    );

    this.scheduleSave();

    return {
      tradeId,
      userACredits: userA.credits,
      userBCredits: userB.credits,
    };
  }

  async getTransactions(userId: string, limit = 50): Promise<TransactionRecord[]> {
    return deepClone(
      this.data.transactions.filter((t) => t.userId === userId).slice(0, limit)
    );
  }

  // ==================== SOCIAL ====================

  async getFriends(userId: string): Promise<FriendInfo[]> {
    const accepted = this.data.friendships.filter(
      (f) =>
        f.status === 'ACCEPTED' &&
        (f.requesterId === userId || f.addresseeId === userId)
    );

    const friends: FriendInfo[] = [];
    for (const f of accepted) {
      const friendId = f.requesterId === userId ? f.addresseeId : f.requesterId;
      const friend = this.data.users.find((u) => u.id === friendId);
      if (!friend) continue;
      friends.push({
        userId: friend.id,
        username: friend.username,
        motto: friend.motto,
        avatar: deepClone(friend.avatar),
        onlineStatus: friend.onlineStatus,
        currentRoomId: friend.currentRoomId,
        currentRoomName: friend.currentRoomName,
        since: f.updatedAt,
      });
    }
    return friends;
  }

  async getFriendRequests(
    userId: string
  ): Promise<{ incoming: FriendRequestInfo[]; outgoing: FriendRequestInfo[] }> {
    const pending = this.data.friendships.filter(
      (f) =>
        f.status === 'PENDING' &&
        (f.requesterId === userId || f.addresseeId === userId)
    );

    const incoming: FriendRequestInfo[] = [];
    const outgoing: FriendRequestInfo[] = [];

    for (const f of pending) {
      const fromUser = this.data.users.find((u) => u.id === f.requesterId);
      const toUser = this.data.users.find((u) => u.id === f.addresseeId);
      if (!fromUser || !toUser) continue;

      const info: FriendRequestInfo = {
        id: f.id,
        fromUserId: fromUser.id,
        fromUsername: fromUser.username,
        fromAvatar: deepClone(fromUser.avatar),
        toUserId: toUser.id,
        toUsername: toUser.username,
        status: 'pending',
        createdAt: f.createdAt,
      };

      if (f.addresseeId === userId) {
        incoming.push(info);
      } else {
        outgoing.push(info);
      }
    }

    return { incoming, outgoing };
  }

  async sendFriendRequest(
    fromUserId: string,
    toUserId: string
  ): Promise<FriendRequestInfo> {
    if (fromUserId === toUserId) {
      throw new Error('Cannot send a friend request to yourself');
    }

    const fromUser = this.data.users.find((u) => u.id === fromUserId);
    const toUser = this.data.users.find((u) => u.id === toUserId);
    if (!fromUser || !toUser) {
      throw new Error('User not found');
    }

    const existing = this.data.friendships.find(
      (f) =>
        (f.requesterId === fromUserId && f.addresseeId === toUserId) ||
        (f.requesterId === toUserId && f.addresseeId === fromUserId)
    );

    if (existing) {
      if (existing.status === 'BLOCKED') {
        throw new Error('Cannot send friend request to this user');
      }
      if (existing.status === 'ACCEPTED') {
        throw new Error('Already friends');
      }
      return {
        id: existing.id,
        fromUserId: fromUser.id,
        fromUsername: fromUser.username,
        fromAvatar: deepClone(fromUser.avatar),
        toUserId: toUser.id,
        toUsername: toUser.username,
        status: 'pending',
        createdAt: existing.createdAt,
      };
    }

    const now = new Date().toISOString();
    const record: FriendshipRecord = {
      id: uuidv4(),
      requesterId: fromUserId,
      addresseeId: toUserId,
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
    };
    this.data.friendships.push(record);
    this.scheduleSave();

    return {
      id: record.id,
      fromUserId: fromUser.id,
      fromUsername: fromUser.username,
      fromAvatar: deepClone(fromUser.avatar),
      toUserId: toUser.id,
      toUsername: toUser.username,
      status: 'pending',
      createdAt: record.createdAt,
    };
  }

  async respondFriendRequest(
    requestId: string,
    userId: string,
    accept: boolean
  ): Promise<{ accepted: boolean; request: FriendRequestInfo | null }> {
    const idx = this.data.friendships.findIndex(
      (f) => f.id === requestId && f.addresseeId === userId && f.status === 'PENDING'
    );
    if (idx < 0) {
      return { accepted: false, request: null };
    }

    const record = this.data.friendships[idx];
    const fromUser = this.data.users.find((u) => u.id === record.requesterId);
    const toUser = this.data.users.find((u) => u.id === record.addresseeId);

    if (accept) {
      record.status = 'ACCEPTED';
      record.updatedAt = new Date().toISOString();
    } else {
      this.data.friendships.splice(idx, 1);
    }

    this.scheduleSave();

    const requestInfo: FriendRequestInfo | null =
      fromUser && toUser
        ? {
            id: record.id,
            fromUserId: fromUser.id,
            fromUsername: fromUser.username,
            fromAvatar: deepClone(fromUser.avatar),
            toUserId: toUser.id,
            toUsername: toUser.username,
            status: accept ? 'accepted' : 'declined',
            createdAt: record.createdAt,
          }
        : null;

    return { accepted: accept, request: requestInfo };
  }

  async removeFriend(userId: string, friendUserId: string): Promise<boolean> {
    const idx = this.data.friendships.findIndex(
      (f) =>
        f.status !== 'BLOCKED' &&
        ((f.requesterId === userId && f.addresseeId === friendUserId) ||
          (f.requesterId === friendUserId && f.addresseeId === userId))
    );
    if (idx < 0) return false;
    this.data.friendships.splice(idx, 1);
    this.scheduleSave();
    return true;
  }

  async blockUser(userId: string, targetUserId: string): Promise<void> {
    if (userId === targetUserId) return;
    const now = new Date().toISOString();
    this.data.friendships = this.data.friendships.filter(
      (f) =>
        !(
          (f.requesterId === userId && f.addresseeId === targetUserId) ||
          (f.requesterId === targetUserId && f.addresseeId === userId)
        )
    );
    this.data.friendships.push({
      id: uuidv4(),
      requesterId: userId,
      addresseeId: targetUserId,
      status: 'BLOCKED',
      createdAt: now,
      updatedAt: now,
    });
    this.scheduleSave();
  }

  async unblockUser(userId: string, targetUserId: string): Promise<void> {
    this.data.friendships = this.data.friendships.filter(
      (f) =>
        !(
          f.requesterId === userId &&
          f.addresseeId === targetUserId &&
          f.status === 'BLOCKED'
        )
    );
    this.scheduleSave();
  }

  async getBlockedIds(userId: string): Promise<string[]> {
    return this.data.friendships
      .filter((f) => f.requesterId === userId && f.status === 'BLOCKED')
      .map((f) => f.addresseeId);
  }

  async saveDirectMessage(
    fromUserId: string,
    toUserId: string,
    text: string
  ): Promise<DirectMessage> {
    const fromUser = this.data.users.find((u) => u.id === fromUserId);
    const toUser = this.data.users.find((u) => u.id === toUserId);
    if (!fromUser || !toUser) {
      throw new Error('User not found');
    }

    const dm: DirectMessage = {
      id: uuidv4(),
      fromUserId,
      fromUsername: fromUser.username,
      toUserId,
      toUsername: toUser.username,
      text,
      read: false,
      createdAt: new Date().toISOString(),
    };
    this.data.directMessages.push(dm);
    if (this.data.directMessages.length > 5000) {
      this.data.directMessages.splice(0, this.data.directMessages.length - 5000);
    }
    this.scheduleSave();
    return deepClone(dm);
  }

  async getDirectMessages(
    userId: string,
    peerUserId: string,
    limit = 50
  ): Promise<DirectMessage[]> {
    const thread = this.data.directMessages.filter(
      (m) =>
        (m.fromUserId === userId && m.toUserId === peerUserId) ||
        (m.fromUserId === peerUserId && m.toUserId === userId)
    );
    return deepClone(thread.slice(-limit));
  }

  async createReport(
    reporterId: string,
    payload: ReportPayload
  ): Promise<{ id: string; createdAt: string }> {
    const record: ReportRecord = {
      id: uuidv4(),
      reporterId,
      targetUserId: payload.targetUserId,
      targetUsername: payload.targetUsername,
      roomId: payload.roomId,
      reason: payload.reason,
      details: payload.details,
      status: 'OPEN',
      createdAt: new Date().toISOString(),
    };
    this.data.reports.unshift(record);
    this.scheduleSave();
    return { id: record.id, createdAt: record.createdAt };
  }

  // ==================== MINIGAMES & EVENTS ====================

  async recordMinigameScore(
    input: RecordMinigameScoreInput
  ): Promise<{ id: string; score: number }> {
    const record: MinigameScoreRecord = {
      id: uuidv4(),
      userId: input.userId,
      gameType: input.gameType,
      score: Math.max(0, Math.round(input.score)),
      won: Boolean(input.won),
      timeMs: input.timeMs,
      metadata: input.metadata,
      createdAt: new Date().toISOString(),
    };
    this.data.minigameScores.push(record);
    this.scheduleSave();
    return { id: record.id, score: record.score };
  }

  async getLeaderboard(
    gameType: MinigameType,
    limit = 20
  ): Promise<LeaderboardEntry[]> {
    const byUser = new Map<
      string,
      { bestScore: number; wins: number; gamesPlayed: number }
    >();

    for (const s of this.data.minigameScores) {
      if (s.gameType !== gameType) continue;
      const prev = byUser.get(s.userId) ?? {
        bestScore: 0,
        wins: 0,
        gamesPlayed: 0,
      };
      prev.bestScore = Math.max(prev.bestScore, s.score);
      if (s.won) prev.wins += 1;
      prev.gamesPlayed += 1;
      byUser.set(s.userId, prev);
    }

    const sorted = Array.from(byUser.entries())
      .sort((a, b) => b[1].bestScore - a[1].bestScore || b[1].wins - a[1].wins)
      .slice(0, limit);

    const entries: LeaderboardEntry[] = [];
    sorted.forEach(([userId, stats], idx) => {
      const user = this.data.users.find((u) => u.id === userId);
      if (!user) return;
      entries.push({
        rank: idx + 1,
        userId: user.id,
        username: user.username,
        avatar: deepClone(user.avatar),
        score: stats.bestScore,
        wins: stats.wins,
        gamesPlayed: stats.gamesPlayed,
        minigameType: gameType,
      });
    });

    return entries;
  }

  async getActiveEvents(): Promise<HotelEventInfo[]> {
    const now = Date.now();
    return deepClone(
      this.data.events
        .filter((e) => Date.parse(e.endsAt) > now)
        .map((e) => ({
          ...e,
          active: Date.parse(e.startsAt) <= now && Date.parse(e.endsAt) > now,
        }))
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    );
  }

  async upsertHotelEvent(input: UpsertHotelEventInput): Promise<HotelEventInfo> {
    const room = this.data.rooms.find((r) => r.id === input.roomId);
    const id = input.id ?? uuidv4();
    const now = Date.now();
    const event: HotelEventInfo = {
      id,
      title: input.title,
      description: input.description,
      roomId: input.roomId,
      roomName: input.roomName ?? room?.name ?? 'HandiHotel',
      hostUsername: input.hostUsername ?? 'hotelhost',
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      active:
        input.active ??
        (Date.parse(input.startsAt) <= now && Date.parse(input.endsAt) > now),
      rewardCredits: input.rewardCredits,
      rewardStars: input.rewardStars ?? 15,
      minigameType: input.minigameType,
    };

    const existingIdx = this.data.events.findIndex((e) => e.id === id);
    if (existingIdx >= 0) {
      this.data.events[existingIdx] = event;
    } else {
      this.data.events.push(event);
    }
    this.scheduleSave();
    return deepClone(event);
  }
}
