import { PrismaClient, Prisma } from '@prisma/client';
import {
  DEFAULT_AVATAR_CONFIG,
  PUBLIC_ROOMS,
  ROOM_TEMPLATES,
  getCatalogItem,
  type AvatarConfig,
  type DailyRewardStatus,
  type DirectMessage,
  type FloorStyle,
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
  type RoomTemplateId,
  type RoomTheme,
  type Rotation4,
  type TransactionRecord,
  type TransactionType,
  type UserProfile,
  type UserRole,
  type WallStyle,
} from '@handihotel/shared';
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

const DAILY_COOLDOWN_MS = 20 * 60 * 60 * 1000;
const STREAK_RESET_MS = 48 * 60 * 60 * 1000;

function computeDailyReward(streak: number): { credits: number; stars: number } {
  const capped = Math.min(Math.max(streak, 1), 7);
  return {
    credits: 100 + (capped - 1) * 50,
    stars: 5 + (capped - 1) * 3,
  };
}

function mapDbRoleToShared(role: string): UserRole {
  const lower = role.toLowerCase();
  if (lower === 'admin' || lower === 'moderator' || lower === 'vip') {
    return lower;
  }
  return 'player';
}

function mapSharedRoleToDb(role?: UserRole): string {
  switch (role) {
    case 'admin':
      return 'ADMIN';
    case 'moderator':
      return 'MODERATOR';
    case 'vip':
      return 'VIP';
    default:
      return 'USER';
  }
}

function parseAvatarConfig(json: unknown): AvatarConfig {
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    return {
      ...DEFAULT_AVATAR_CONFIG,
      ...(json as Partial<AvatarConfig>),
    };
  }
  return { ...DEFAULT_AVATAR_CONFIG };
}

function parseFurnitureState(raw: string): Record<string, unknown> {
  if (!raw || raw === 'default') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function extractBaseInventoryId(id: string): string {
  const sep = id.indexOf('::');
  return sep >= 0 ? id.slice(0, sep) : id;
}

export class PrismaPostgresStore implements IDataStore {
  readonly backend = 'postgres' as const;
  private prisma: PrismaClient;
  private roomLikesMemory = new Map<string, Set<string>>();
  private favoriteRoomsMemory = new Map<string, Set<string>>();

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient ?? new PrismaClient();
  }

  async init(): Promise<void> {
    await this.prisma.$connect();
    await this.prisma.$queryRaw`SELECT 1`;
    await this.ensurePublicRoomsSeeded();
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }

  private async ensurePublicRoomsSeeded(): Promise<void> {
    for (const room of PUBLIC_ROOMS) {
      const exists = await this.prisma.room.findUnique({ where: { id: room.id } });
      if (!exists) {
        await this.prisma.room.create({
          data: {
            id: room.id,
            name: room.name,
            description: room.description,
            isPublic: true,
            isOfficial: true,
            theme: room.theme,
            templateId: room.templateId,
            width: room.width,
            height: room.height,
            floorStyle: room.floorStyle,
            wallStyle: room.wallStyle,
            maxUsers: room.permissions.maxUsers,
            allowVisitorBuild: false,
            furniture: {
              create: room.furniture.map((f) => ({
                id: f.id,
                catalogItemId: f.catalogItemId,
                x: f.x,
                y: f.y,
                z: f.z,
                rotation: f.rotation,
                state: JSON.stringify(f.state ?? {}),
              })),
            },
          },
        });
      }
    }
  }

  private mapUser(row: {
    id: string;
    username: string;
    email: string;
    passwordHash: string;
    motto: string;
    credits: number;
    stars: number;
    role: string;
    banned: boolean;
    avatarConfig: Prisma.JsonValue;
    lastDailyClaim: Date | null;
    dailyStreak: number;
    createdAt: Date;
    updatedAt: Date;
  }): StoredUser {
    const favorites = Array.from(this.favoriteRoomsMemory.get(row.id) ?? ['public-lobby']);
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      passwordHash: row.passwordHash,
      motto: row.motto,
      avatar: parseAvatarConfig(row.avatarConfig),
      credits: row.credits,
      stars: row.stars,
      role: mapDbRoleToShared(row.role),
      level: 1,
      xp: 0,
      banned: row.banned,
      lastDailyClaim: row.lastDailyClaim ? row.lastDailyClaim.toISOString() : null,
      dailyStreak: row.dailyStreak,
      createdAt: row.createdAt.toISOString(),
      lastOnlineAt: row.updatedAt.toISOString(),
      onlineStatus: 'offline',
      currentRoomId: null,
      currentRoomName: null,
      badges: ['hotel_guest'],
      favoriteRoomIds: favorites,
      ownedCosmetics: [],
    };
  }

  private mapRoomState(row: {
    id: string;
    name: string;
    description: string;
    ownerId: string | null;
    isPublic: boolean;
    theme: string;
    templateId: string;
    width: number;
    height: number;
    floorStyle: string;
    wallStyle: string;
    maxUsers: number;
    owner?: { username: string } | null;
    furniture: Array<{
      id: string;
      roomId: string;
      catalogItemId: string;
      ownerId: string | null;
      x: number;
      y: number;
      z: number;
      rotation: number;
      state: string;
    }>;
  }): RoomState {
    const publicDef = PUBLIC_ROOMS.find((r) => r.id === row.id);
    const tpl =
      ROOM_TEMPLATES[(row.templateId as RoomTemplateId) ?? 'studio'] ??
      ROOM_TEMPLATES.studio;

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      ownerId: row.ownerId ?? 'system',
      ownerUsername: row.owner?.username ?? publicDef?.ownerUsername ?? 'HandiHotel',
      isPublic: row.isPublic,
      templateId: (row.templateId as RoomTemplateId) ?? 'studio',
      theme: (row.theme as RoomTheme) ?? 'private',
      width: row.width,
      height: row.height,
      spawnX: publicDef?.spawnX ?? tpl.spawnX,
      spawnY: publicDef?.spawnY ?? tpl.spawnY,
      floorStyle: (row.floorStyle as FloorStyle) ?? tpl.defaultFloorStyle,
      wallStyle: (row.wallStyle as WallStyle) ?? tpl.defaultWallStyle,
      floorColor: publicDef?.floorColor ?? tpl.defaultFloorColor,
      wallColor: publicDef?.wallColor ?? tpl.defaultWallColor,
      permissions: {
        accessMode: 'open',
        allowTrading: true,
        allowWalkThrough: true,
        maxUsers: row.maxUsers,
        bannedUserIds: [],
        moderatorUserIds: [],
      },
      likes: (publicDef?.likes ?? 0) + (this.roomLikesMemory.get(row.id)?.size ?? 0),
      tags: publicDef?.tags ? [...publicDef.tags] : [row.theme],
      furniture: row.furniture.map((f) => ({
        id: f.id,
        roomId: f.roomId,
        catalogItemId: f.catalogItemId,
        ownerId: f.ownerId ?? 'system',
        x: f.x,
        y: f.y,
        z: f.z,
        rotation: (f.rotation % 4) as Rotation4,
        state: parseFurnitureState(f.state),
      })),
    };
  }

  private mapRoomSummary(row: {
    id: string;
    name: string;
    description: string;
    ownerId: string | null;
    isPublic: boolean;
    theme: string;
    templateId: string;
    maxUsers: number;
    owner?: { username: string } | null;
  }): RoomSummary {
    const publicDef = PUBLIC_ROOMS.find((r) => r.id === row.id);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      ownerId: row.ownerId ?? 'system',
      ownerUsername: row.owner?.username ?? publicDef?.ownerUsername ?? 'HandiHotel',
      isPublic: row.isPublic,
      templateId: (row.templateId as RoomTemplateId) ?? 'studio',
      theme: (row.theme as RoomTheme) ?? 'private',
      userCount: 0,
      maxUsers: row.maxUsers,
      likes: (publicDef?.likes ?? 0) + (this.roomLikesMemory.get(row.id)?.size ?? 0),
      accessMode: 'open',
      tags: publicDef?.tags ? [...publicDef.tags] : [row.theme],
    };
  }

  // ==================== USERS ====================

  async createUser(input: CreateUserInput): Promise<StoredUser> {
    const created = await this.prisma.user.create({
      data: {
        username: input.username.trim(),
        email: input.email.trim().toLowerCase(),
        passwordHash: input.passwordHash,
        motto: input.motto ?? 'Welcome to HandiHotel!',
        credits: input.credits ?? 1500,
        stars: input.stars ?? 100,
        role: mapSharedRoleToDb(input.role),
        avatarConfig: (input.avatar ?? DEFAULT_AVATAR_CONFIG) as unknown as Prisma.InputJsonValue,
        inventory: {
          create: [
            { catalogItemId: 'velvet_sofa', quantity: 1 },
            { catalogItemId: 'bistro_chair', quantity: 1 },
            { catalogItemId: 'potted_palm', quantity: 1 },
          ],
        },
      },
    });
    return this.mapUser(created);
  }

  async findUserById(userId: string): Promise<StoredUser | null> {
    const row = await this.prisma.user.findUnique({ where: { id: userId } });
    return row ? this.mapUser(row) : null;
  }

  async findUserByUsername(username: string): Promise<StoredUser | null> {
    const row = await this.prisma.user.findFirst({
      where: { username: { equals: username.trim(), mode: 'insensitive' } },
    });
    return row ? this.mapUser(row) : null;
  }

  async findUserByEmail(email: string): Promise<StoredUser | null> {
    const row = await this.prisma.user.findFirst({
      where: { email: { equals: email.trim().toLowerCase(), mode: 'insensitive' } },
    });
    return row ? this.mapUser(row) : null;
  }

  async updateAvatar(userId: string, avatar: AvatarConfig): Promise<StoredUser | null> {
    const row = await this.prisma.user
      .update({
        where: { id: userId },
        data: { avatarConfig: avatar as unknown as Prisma.InputJsonValue },
      })
      .catch(() => null);
    return row ? this.mapUser(row) : null;
  }

  async updateMotto(userId: string, motto: string): Promise<StoredUser | null> {
    const row = await this.prisma.user
      .update({
        where: { id: userId },
        data: { motto },
      })
      .catch(() => null);
    return row ? this.mapUser(row) : null;
  }

  async updateBalance(
    userId: string,
    creditsDelta: number,
    starsDelta: number,
    type: TransactionType,
    description: string,
    itemId?: string
  ): Promise<{ credits: number; stars: number; transaction: TransactionRecord }> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new Error('User not found');

      const nextCredits = user.credits + creditsDelta;
      const nextStars = user.stars + starsDelta;
      if (nextCredits < 0 || nextStars < 0) {
        throw new Error('Insufficient funds');
      }

      const updated = await tx.user.update({
        where: { id: userId },
        data: { credits: nextCredits, stars: nextStars },
      });

      const txRow = await tx.transaction.create({
        data: {
          userId,
          type,
          amountCredits: creditsDelta,
          amountStars: starsDelta,
          itemId: itemId ?? null,
          description,
        },
      });

      return {
        credits: updated.credits,
        stars: updated.stars,
        transaction: {
          id: txRow.id,
          userId: txRow.userId,
          type: txRow.type as TransactionType,
          creditsDelta: txRow.amountCredits,
          starsDelta: txRow.amountStars,
          description: txRow.description,
          createdAt: txRow.createdAt.toISOString(),
        },
      };
    });
  }

  async getDailyRewardStatus(userId: string): Promise<DailyRewardStatus> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found');

    const now = Date.now();
    const lastMs = user.lastDailyClaim ? user.lastDailyClaim.getTime() : null;
    const canClaim = lastMs === null || now - lastMs >= DAILY_COOLDOWN_MS;
    const streakBroken = lastMs !== null && now - lastMs > STREAK_RESET_MS;
    const nextStreak = streakBroken ? 1 : user.dailyStreak + 1;
    const reward = computeDailyReward(nextStreak);

    return {
      canClaim,
      currentStreak: streakBroken ? 0 : user.dailyStreak,
      nextRewardCredits: reward.credits,
      nextRewardStars: reward.stars,
      lastClaimedAt: user.lastDailyClaim ? user.lastDailyClaim.toISOString() : null,
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
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new Error('User not found');

      const now = Date.now();
      const lastMs = user.lastDailyClaim ? user.lastDailyClaim.getTime() : null;
      const canClaim = lastMs === null || now - lastMs >= DAILY_COOLDOWN_MS;
      const streakBroken = lastMs !== null && now - lastMs > STREAK_RESET_MS;

      if (!canClaim) {
        return {
          claimed: false,
          creditsAwarded: 0,
          starsAwarded: 0,
          streak: user.dailyStreak,
          credits: user.credits,
          stars: user.stars,
        };
      }

      const nextStreak = streakBroken ? 1 : user.dailyStreak + 1;
      const reward = computeDailyReward(nextStreak);
      const nowDate = new Date(now);

      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          credits: { increment: reward.credits },
          stars: { increment: reward.stars },
          dailyStreak: nextStreak,
          lastDailyClaim: nowDate,
        },
      });

      await tx.transaction.create({
        data: {
          userId,
          type: 'daily_reward',
          amountCredits: reward.credits,
          amountStars: reward.stars,
          description: `Daily check-in reward (Day ${nextStreak})`,
        },
      });

      return {
        claimed: true,
        creditsAwarded: reward.credits,
        starsAwarded: reward.stars,
        streak: nextStreak,
        credits: updated.credits,
        stars: updated.stars,
      };
    });

    const status = await this.getDailyRewardStatus(userId);
    return { ...result, status };
  }

  async searchUsers(query: string, limit = 20): Promise<UserProfile[]> {
    const q = query.trim();
    const rows = await this.prisma.user.findMany({
      where: {
        banned: false,
        ...(q ? { username: { contains: q, mode: 'insensitive' } } : {}),
      },
      take: limit,
      orderBy: { username: 'asc' },
    });
    return rows.map((r) => toPublicUserProfile(this.mapUser(r)));
  }

  async toggleFavoriteRoom(userId: string, roomId: string): Promise<string[]> {
    let set = this.favoriteRoomsMemory.get(userId);
    if (!set) {
      set = new Set(['public-lobby']);
      this.favoriteRoomsMemory.set(userId, set);
    }
    if (set.has(roomId)) {
      set.delete(roomId);
    } else {
      set.add(roomId);
    }
    return Array.from(set);
  }

  // ==================== ROOMS ====================

  async listPublicRooms(): Promise<RoomSummary[]> {
    const rows = await this.prisma.room.findMany({
      where: { isPublic: true },
      include: { owner: { select: { username: true } } },
      orderBy: [{ isOfficial: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.mapRoomSummary(r));
  }

  async listRoomsByOwner(ownerId: string): Promise<RoomSummary[]> {
    const rows = await this.prisma.room.findMany({
      where: { ownerId },
      include: { owner: { select: { username: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.mapRoomSummary(r));
  }

  async searchRooms(query: string, limit = 30): Promise<RoomSummary[]> {
    const q = query.trim();
    const rows = await this.prisma.room.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { description: { contains: q, mode: 'insensitive' } },
              { theme: { contains: q, mode: 'insensitive' } },
            ],
          }
        : undefined,
      include: { owner: { select: { username: true } } },
      take: limit,
      orderBy: [{ isOfficial: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((r) => this.mapRoomSummary(r));
  }

  async getRoomState(roomId: string): Promise<RoomState | null> {
    const row = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: {
        owner: { select: { username: true } },
        furniture: true,
      },
    });
    return row ? this.mapRoomState(row) : null;
  }

  async createRoom(input: CreateRoomInput): Promise<RoomState> {
    const template = ROOM_TEMPLATES[input.templateId] ?? ROOM_TEMPLATES.studio;
    const row = await this.prisma.room.create({
      data: {
        name: input.name.trim(),
        description: input.description?.trim() ?? '',
        ownerId: input.ownerId,
        isPublic: input.isPublic ?? true,
        isOfficial: false,
        theme: input.theme ?? 'private',
        templateId: template.id,
        width: template.width,
        height: template.height,
        floorStyle: template.defaultFloorStyle,
        wallStyle: template.defaultWallStyle,
        maxUsers: template.maxUsers,
      },
      include: {
        owner: { select: { username: true } },
        furniture: true,
      },
    });
    return this.mapRoomState(row);
  }

  async updateRoomSettings(
    roomId: string,
    patch: RoomSettingsPatch
  ): Promise<RoomState | null> {
    const data: Prisma.RoomUpdateInput = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.floorStyle !== undefined) data.floorStyle = patch.floorStyle;
    if (patch.wallStyle !== undefined) data.wallStyle = patch.wallStyle;
    if (patch.permissions?.maxUsers !== undefined) {
      data.maxUsers = patch.permissions.maxUsers;
    }

    const row = await this.prisma.room
      .update({
        where: { id: roomId },
        data,
        include: {
          owner: { select: { username: true } },
          furniture: true,
        },
      })
      .catch(() => null);

    return row ? this.mapRoomState(row) : null;
  }

  async likeRoom(roomId: string, userId: string): Promise<number> {
    let set = this.roomLikesMemory.get(roomId);
    if (!set) {
      set = new Set<string>();
      this.roomLikesMemory.set(roomId, set);
    }
    set.add(userId);
    const publicDef = PUBLIC_ROOMS.find((r) => r.id === roomId);
    return (publicDef?.likes ?? 0) + set.size;
  }

  async addFurniture(roomId: string, item: AddFurnitureInput): Promise<PlacedFurniture> {
    const row = await this.prisma.placedFurniture.create({
      data: {
        ...(item.id ? { id: item.id } : {}),
        roomId,
        catalogItemId: item.catalogItemId,
        ownerId: item.ownerId === 'system' ? null : item.ownerId,
        x: item.x,
        y: item.y,
        z: item.z ?? 0,
        rotation: item.rotation ?? 0,
        state: JSON.stringify(item.state ?? {}),
      },
    });

    return {
      id: row.id,
      roomId: row.roomId,
      catalogItemId: row.catalogItemId,
      ownerId: row.ownerId ?? 'system',
      x: row.x,
      y: row.y,
      z: row.z,
      rotation: (row.rotation % 4) as Rotation4,
      state: parseFurnitureState(row.state),
    };
  }

  async updateFurniture(
    roomId: string,
    furniId: string,
    patch: UpdateFurniturePatch
  ): Promise<PlacedFurniture | null> {
    const existing = await this.prisma.placedFurniture.findFirst({
      where: { id: furniId, roomId },
    });
    if (!existing) return null;

    const mergedState =
      patch.state !== undefined
        ? { ...parseFurnitureState(existing.state), ...patch.state }
        : undefined;

    const row = await this.prisma.placedFurniture.update({
      where: { id: furniId },
      data: {
        ...(patch.x !== undefined ? { x: patch.x } : {}),
        ...(patch.y !== undefined ? { y: patch.y } : {}),
        ...(patch.z !== undefined ? { z: patch.z } : {}),
        ...(patch.rotation !== undefined ? { rotation: patch.rotation } : {}),
        ...(mergedState !== undefined ? { state: JSON.stringify(mergedState) } : {}),
      },
    });

    return {
      id: row.id,
      roomId: row.roomId,
      catalogItemId: row.catalogItemId,
      ownerId: row.ownerId ?? 'system',
      x: row.x,
      y: row.y,
      z: row.z,
      rotation: (row.rotation % 4) as Rotation4,
      state: parseFurnitureState(row.state),
    };
  }

  async removeFurniture(roomId: string, furniId: string): Promise<PlacedFurniture | null> {
    const existing = await this.prisma.placedFurniture.findFirst({
      where: { id: furniId, roomId },
    });
    if (!existing) return null;

    await this.prisma.placedFurniture.delete({ where: { id: furniId } });
    return {
      id: existing.id,
      roomId: existing.roomId,
      catalogItemId: existing.catalogItemId,
      ownerId: existing.ownerId ?? 'system',
      x: existing.x,
      y: existing.y,
      z: existing.z,
      rotation: (existing.rotation % 4) as Rotation4,
      state: parseFurnitureState(existing.state),
    };
  }

  // ==================== INVENTORY & ECONOMY ====================

  async getInventory(userId: string): Promise<InventoryItem[]> {
    const rows = await this.prisma.inventoryItem.findMany({
      where: { userId, quantity: { gt: 0 } },
      orderBy: { acquiredAt: 'desc' },
    });

    const expanded: InventoryItem[] = [];
    for (const row of rows) {
      for (let i = 0; i < row.quantity; i++) {
        expanded.push({
          id: i === 0 ? row.id : `${row.id}::${i}`,
          userId: row.userId,
          catalogItemId: row.catalogItemId,
          acquiredAt: row.acquiredAt.toISOString(),
          placedInRoomId: null,
        });
      }
    }
    return expanded;
  }

  async getInventoryItem(
    userId: string,
    inventoryItemId: string
  ): Promise<InventoryItem | null> {
    const baseId = extractBaseInventoryId(inventoryItemId);
    const row = await this.prisma.inventoryItem.findFirst({
      where: { id: baseId, userId, quantity: { gt: 0 } },
    });
    if (!row) return null;
    return {
      id: inventoryItemId,
      userId: row.userId,
      catalogItemId: row.catalogItemId,
      acquiredAt: row.acquiredAt.toISOString(),
      placedInRoomId: null,
    };
  }

  async addInventoryItem(userId: string, catalogItemId: string): Promise<InventoryItem> {
    const row = await this.prisma.inventoryItem.upsert({
      where: { userId_catalogItemId: { userId, catalogItemId } },
      update: { quantity: { increment: 1 } },
      create: { userId, catalogItemId, quantity: 1 },
    });

    return {
      id: row.quantity > 1 ? `${row.id}::${row.quantity - 1}` : row.id,
      userId: row.userId,
      catalogItemId: row.catalogItemId,
      acquiredAt: row.acquiredAt.toISOString(),
      placedInRoomId: null,
    };
  }

  async removeInventoryItem(userId: string, inventoryItemId: string): Promise<boolean> {
    const baseId = extractBaseInventoryId(inventoryItemId);
    const row = await this.prisma.inventoryItem.findFirst({
      where: { id: baseId, userId },
    });
    if (!row || row.quantity <= 0) return false;

    if (row.quantity > 1) {
      await this.prisma.inventoryItem.update({
        where: { id: row.id },
        data: { quantity: { decrement: 1 } },
      });
    } else {
      await this.prisma.inventoryItem.delete({ where: { id: row.id } });
    }
    return true;
  }

  async purchaseCatalogItem(
    userId: string,
    catalogItemId: string,
    quantity = 1
  ): Promise<PurchaseResult> {
    const qty = Math.max(1, Math.min(20, Math.floor(quantity)));
    const catalogItem = getCatalogItem(catalogItemId);
    if (!catalogItem) throw new Error('Catalog item not found');

    const totalCredits = catalogItem.priceCredits * qty;
    const totalStars = catalogItem.priceStars * qty;

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new Error('User not found');
      if (user.credits < totalCredits) throw new Error('Insufficient credits');
      if (user.stars < totalStars) throw new Error('Insufficient stars');

      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          credits: { decrement: totalCredits },
          stars: { decrement: totalStars },
        },
      });

      const invRow = await tx.inventoryItem.upsert({
        where: { userId_catalogItemId: { userId, catalogItemId } },
        update: { quantity: { increment: qty } },
        create: { userId, catalogItemId, quantity: qty },
      });

      const txRow = await tx.transaction.create({
        data: {
          userId,
          type: 'purchase',
          amountCredits: -totalCredits,
          amountStars: -totalStars,
          itemId: catalogItemId,
          description: `Purchased ${qty}x ${catalogItem.name}`,
        },
      });

      const items: InventoryItem[] = [];
      const startIndex = Math.max(0, invRow.quantity - qty);
      for (let i = 0; i < qty; i++) {
        const idx = startIndex + i;
        items.push({
          id: idx === 0 ? invRow.id : `${invRow.id}::${idx}`,
          userId,
          catalogItemId,
          acquiredAt: invRow.acquiredAt.toISOString(),
          placedInRoomId: null,
        });
      }

      return {
        items,
        credits: updatedUser.credits,
        stars: updatedUser.stars,
        ownedCosmetics:
          catalogItem.category === 'cosmetic' && catalogItem.cosmeticValue
            ? [catalogItem.cosmeticValue]
            : [],
        transaction: {
          id: txRow.id,
          userId: txRow.userId,
          type: 'purchase',
          creditsDelta: txRow.amountCredits,
          starsDelta: txRow.amountStars,
          description: txRow.description,
          createdAt: txRow.createdAt.toISOString(),
        },
      };
    });
  }

  async executeTrade(input: ExecuteTradeInput): Promise<ExecuteTradeResult> {
    if (input.userACredits < 0 || input.userBCredits < 0) {
      throw new Error('Invalid trade credits');
    }

    return this.prisma.$transaction(async (tx) => {
      const [userA, userB] = await Promise.all([
        tx.user.findUnique({ where: { id: input.userAId } }),
        tx.user.findUnique({ where: { id: input.userBId } }),
      ]);
      if (!userA || !userB) throw new Error('Trade participant not found');
      if (userA.credits < input.userACredits) {
        throw new Error(`${userA.username} has insufficient credits`);
      }
      if (userB.credits < input.userBCredits) {
        throw new Error(`${userB.username} has insufficient credits`);
      }

      const transferItems = async (
        fromUserId: string,
        toUserId: string,
        itemIds: string[]
      ) => {
        const countsByBase = new Map<string, number>();
        for (const id of itemIds) {
          const base = extractBaseInventoryId(id);
          countsByBase.set(base, (countsByBase.get(base) ?? 0) + 1);
        }

        for (const [baseId, count] of countsByBase.entries()) {
          const row = await tx.inventoryItem.findFirst({
            where: { id: baseId, userId: fromUserId },
          });
          if (!row || row.quantity < count) {
            throw new Error('Insufficient item quantity for trade');
          }

          if (row.quantity === count) {
            await tx.inventoryItem.delete({ where: { id: row.id } });
          } else {
            await tx.inventoryItem.update({
              where: { id: row.id },
              data: { quantity: { decrement: count } },
            });
          }

          await tx.inventoryItem.upsert({
            where: {
              userId_catalogItemId: {
                userId: toUserId,
                catalogItemId: row.catalogItemId,
              },
            },
            update: { quantity: { increment: count } },
            create: {
              userId: toUserId,
              catalogItemId: row.catalogItemId,
              quantity: count,
            },
          });
        }
      };

      await transferItems(userA.id, userB.id, input.userAItemIds);
      await transferItems(userB.id, userA.id, input.userBItemIds);

      const netA = input.userBCredits - input.userACredits;
      const netB = input.userACredits - input.userBCredits;

      const updatedA = await tx.user.update({
        where: { id: userA.id },
        data: { credits: { increment: netA } },
      });
      const updatedB = await tx.user.update({
        where: { id: userB.id },
        data: { credits: { increment: netB } },
      });

      const tradeLog = await tx.tradeLog.create({
        data: {
          userAId: userA.id,
          userBId: userB.id,
          offerA: {
            itemIds: input.userAItemIds,
            credits: input.userACredits,
          } as Prisma.InputJsonValue,
          offerB: {
            itemIds: input.userBItemIds,
            credits: input.userBCredits,
          } as Prisma.InputJsonValue,
          status: 'COMPLETED',
        },
      });

      await tx.transaction.createMany({
        data: [
          {
            userId: userA.id,
            type: 'trade',
            amountCredits: netA,
            amountStars: 0,
            description: `Traded with ${userB.username}`,
          },
          {
            userId: userB.id,
            type: 'trade',
            amountCredits: netB,
            amountStars: 0,
            description: `Traded with ${userA.username}`,
          },
        ],
      });

      return {
        tradeId: tradeLog.id,
        userACredits: updatedA.credits,
        userBCredits: updatedB.credits,
      };
    });
  }

  async getTransactions(userId: string, limit = 50): Promise<TransactionRecord[]> {
    const rows = await this.prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      type: r.type as TransactionType,
      creditsDelta: r.amountCredits,
      starsDelta: r.amountStars,
      description: r.description,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // ==================== SOCIAL ====================

  async getFriends(userId: string): Promise<FriendInfo[]> {
    const rows = await this.prisma.friendship.findMany({
      where: {
        status: 'ACCEPTED',
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      include: { requester: true, addressee: true },
    });

    return rows.map((f) => {
      const friend = f.requesterId === userId ? f.addressee : f.requester;
      return {
        userId: friend.id,
        username: friend.username,
        motto: friend.motto,
        avatar: parseAvatarConfig(friend.avatarConfig),
        onlineStatus: 'offline',
        currentRoomId: null,
        currentRoomName: null,
        since: f.updatedAt.toISOString(),
      };
    });
  }

  async getFriendRequests(
    userId: string
  ): Promise<{ incoming: FriendRequestInfo[]; outgoing: FriendRequestInfo[] }> {
    const rows = await this.prisma.friendship.findMany({
      where: {
        status: 'PENDING',
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      include: { requester: true, addressee: true },
      orderBy: { createdAt: 'desc' },
    });

    const incoming: FriendRequestInfo[] = [];
    const outgoing: FriendRequestInfo[] = [];

    for (const f of rows) {
      const info: FriendRequestInfo = {
        id: f.id,
        fromUserId: f.requester.id,
        fromUsername: f.requester.username,
        fromAvatar: parseAvatarConfig(f.requester.avatarConfig),
        toUserId: f.addressee.id,
        toUsername: f.addressee.username,
        status: 'pending',
        createdAt: f.createdAt.toISOString(),
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

    const existing = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: fromUserId, addresseeId: toUserId },
          { requesterId: toUserId, addresseeId: fromUserId },
        ],
      },
      include: { requester: true, addressee: true },
    });

    if (existing) {
      if (existing.status === 'BLOCKED') {
        throw new Error('Cannot send friend request to this user');
      }
      if (existing.status === 'ACCEPTED') {
        throw new Error('Already friends');
      }
      return {
        id: existing.id,
        fromUserId: existing.requester.id,
        fromUsername: existing.requester.username,
        fromAvatar: parseAvatarConfig(existing.requester.avatarConfig),
        toUserId: existing.addressee.id,
        toUsername: existing.addressee.username,
        status: 'pending',
        createdAt: existing.createdAt.toISOString(),
      };
    }

    const created = await this.prisma.friendship.create({
      data: { requesterId: fromUserId, addresseeId: toUserId, status: 'PENDING' },
      include: { requester: true, addressee: true },
    });

    return {
      id: created.id,
      fromUserId: created.requester.id,
      fromUsername: created.requester.username,
      fromAvatar: parseAvatarConfig(created.requester.avatarConfig),
      toUserId: created.addressee.id,
      toUsername: created.addressee.username,
      status: 'pending',
      createdAt: created.createdAt.toISOString(),
    };
  }

  async respondFriendRequest(
    requestId: string,
    userId: string,
    accept: boolean
  ): Promise<{ accepted: boolean; request: FriendRequestInfo | null }> {
    const existing = await this.prisma.friendship.findFirst({
      where: { id: requestId, addresseeId: userId, status: 'PENDING' },
      include: { requester: true, addressee: true },
    });
    if (!existing) return { accepted: false, request: null };

    if (accept) {
      await this.prisma.friendship.update({
        where: { id: requestId },
        data: { status: 'ACCEPTED' },
      });
    } else {
      await this.prisma.friendship.delete({ where: { id: requestId } });
    }

    return {
      accepted: accept,
      request: {
        id: existing.id,
        fromUserId: existing.requester.id,
        fromUsername: existing.requester.username,
        fromAvatar: parseAvatarConfig(existing.requester.avatarConfig),
        toUserId: existing.addressee.id,
        toUsername: existing.addressee.username,
        status: accept ? 'accepted' : 'declined',
        createdAt: existing.createdAt.toISOString(),
      },
    };
  }

  async removeFriend(userId: string, friendUserId: string): Promise<boolean> {
    const res = await this.prisma.friendship.deleteMany({
      where: {
        status: { not: 'BLOCKED' },
        OR: [
          { requesterId: userId, addresseeId: friendUserId },
          { requesterId: friendUserId, addresseeId: userId },
        ],
      },
    });
    return res.count > 0;
  }

  async blockUser(userId: string, targetUserId: string): Promise<void> {
    if (userId === targetUserId) return;
    await this.prisma.friendship.deleteMany({
      where: {
        OR: [
          { requesterId: userId, addresseeId: targetUserId },
          { requesterId: targetUserId, addresseeId: userId },
        ],
      },
    });
    await this.prisma.friendship.create({
      data: { requesterId: userId, addresseeId: targetUserId, status: 'BLOCKED' },
    });
  }

  async unblockUser(userId: string, targetUserId: string): Promise<void> {
    await this.prisma.friendship.deleteMany({
      where: { requesterId: userId, addresseeId: targetUserId, status: 'BLOCKED' },
    });
  }

  async getBlockedIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.friendship.findMany({
      where: { requesterId: userId, status: 'BLOCKED' },
      select: { addresseeId: true },
    });
    return rows.map((r) => r.addresseeId);
  }

  async saveDirectMessage(
    fromUserId: string,
    toUserId: string,
    text: string
  ): Promise<DirectMessage> {
    const row = await this.prisma.directMessage.create({
      data: { senderId: fromUserId, receiverId: toUserId, content: text },
      include: { sender: true, receiver: true },
    });

    return {
      id: row.id,
      fromUserId: row.senderId,
      fromUsername: row.sender.username,
      toUserId: row.receiverId,
      toUsername: row.receiver.username,
      text: row.content,
      read: row.read,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async getDirectMessages(
    userId: string,
    peerUserId: string,
    limit = 50
  ): Promise<DirectMessage[]> {
    const rows = await this.prisma.directMessage.findMany({
      where: {
        OR: [
          { senderId: userId, receiverId: peerUserId },
          { senderId: peerUserId, receiverId: userId },
        ],
      },
      include: { sender: true, receiver: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return rows.reverse().map((row) => ({
      id: row.id,
      fromUserId: row.senderId,
      fromUsername: row.sender.username,
      toUserId: row.receiverId,
      toUsername: row.receiver.username,
      text: row.content,
      read: row.read,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async createReport(
    reporterId: string,
    payload: ReportPayload
  ): Promise<{ id: string; createdAt: string }> {
    let targetUserId = payload.targetUserId;
    if (!targetUserId && payload.targetUsername) {
      const target = await this.findUserByUsername(payload.targetUsername);
      targetUserId = target?.id;
    }
    if (!targetUserId) {
      targetUserId = reporterId;
    }

    const row = await this.prisma.moderationReport.create({
      data: {
        reporterId,
        targetUserId,
        roomId: payload.roomId ?? null,
        reason: payload.reason,
        details: payload.details,
      },
    });
    return { id: row.id, createdAt: row.createdAt.toISOString() };
  }

  // ==================== MINIGAMES & EVENTS ====================

  async recordMinigameScore(
    input: RecordMinigameScoreInput
  ): Promise<{ id: string; score: number }> {
    const row = await this.prisma.minigameScore.create({
      data: {
        userId: input.userId,
        gameType: input.gameType,
        score: Math.max(0, Math.round(input.score)),
        timeMs: input.timeMs ?? null,
        metadata: {
          ...(input.metadata ?? {}),
          won: Boolean(input.won),
        } as Prisma.InputJsonValue,
      },
    });
    return { id: row.id, score: row.score };
  }

  async getLeaderboard(
    gameType: MinigameType,
    limit = 20
  ): Promise<LeaderboardEntry[]> {
    const rows = await this.prisma.minigameScore.findMany({
      where: { gameType },
      include: { user: true },
      orderBy: { score: 'desc' },
      take: 500,
    });

    const byUser = new Map<
      string,
      {
        user: { id: string; username: string; avatarConfig: Prisma.JsonValue };
        bestScore: number;
        wins: number;
        gamesPlayed: number;
      }
    >();

    for (const row of rows) {
      const meta = row.metadata as Record<string, unknown> | null;
      const won = Boolean(meta?.won);
      const prev = byUser.get(row.userId) ?? {
        user: row.user,
        bestScore: 0,
        wins: 0,
        gamesPlayed: 0,
      };
      prev.bestScore = Math.max(prev.bestScore, row.score);
      if (won) prev.wins += 1;
      prev.gamesPlayed += 1;
      byUser.set(row.userId, prev);
    }

    return Array.from(byUser.values())
      .sort((a, b) => b.bestScore - a.bestScore || b.wins - a.wins)
      .slice(0, limit)
      .map((entry, idx) => ({
        rank: idx + 1,
        userId: entry.user.id,
        username: entry.user.username,
        avatar: parseAvatarConfig(entry.user.avatarConfig),
        score: entry.bestScore,
        wins: entry.wins,
        gamesPlayed: entry.gamesPlayed,
        minigameType: gameType,
      }));
  }

  async getActiveEvents(): Promise<HotelEventInfo[]> {
    const now = new Date();
    const rows = await this.prisma.hotelEvent.findMany({
      where: { endsAt: { gt: now } },
      include: { room: { select: { name: true } } },
      orderBy: { startsAt: 'asc' },
    });

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      roomId: row.roomId,
      roomName: row.room.name,
      hostUsername: 'hotelhost',
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      active: row.startsAt <= now && row.endsAt > now,
      rewardCredits: row.rewardCredits,
      rewardStars: Math.max(10, Math.round(row.rewardCredits / 15)),
      minigameType: row.gameType as MinigameType,
    }));
  }

  async upsertHotelEvent(input: UpsertHotelEventInput): Promise<HotelEventInfo> {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    const now = new Date();
    const status = startsAt <= now && endsAt > now ? 'ACTIVE' : 'SCHEDULED';

    const row = input.id
      ? await this.prisma.hotelEvent.upsert({
          where: { id: input.id },
          update: {
            title: input.title,
            description: input.description,
            roomId: input.roomId,
            gameType: input.minigameType ?? 'wheelchair_racing',
            rewardCredits: input.rewardCredits,
            startsAt,
            endsAt,
            status,
          },
          create: {
            id: input.id,
            title: input.title,
            description: input.description,
            roomId: input.roomId,
            gameType: input.minigameType ?? 'wheelchair_racing',
            rewardCredits: input.rewardCredits,
            startsAt,
            endsAt,
            status,
          },
          include: { room: { select: { name: true } } },
        })
      : await this.prisma.hotelEvent.create({
          data: {
            title: input.title,
            description: input.description,
            roomId: input.roomId,
            gameType: input.minigameType ?? 'wheelchair_racing',
            rewardCredits: input.rewardCredits,
            startsAt,
            endsAt,
            status,
          },
          include: { room: { select: { name: true } } },
        });

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      roomId: row.roomId,
      roomName: row.room.name,
      hostUsername: input.hostUsername ?? 'hotelhost',
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      active: row.startsAt <= now && row.endsAt > now,
      rewardCredits: row.rewardCredits,
      rewardStars: input.rewardStars ?? Math.max(10, Math.round(row.rewardCredits / 15)),
      minigameType: row.gameType as MinigameType,
    };
  }
}
