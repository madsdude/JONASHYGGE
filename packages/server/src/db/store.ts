import type {
  AvatarConfig,
  DailyRewardStatus,
  DirectMessage,
  FriendInfo,
  FriendRequestInfo,
  HotelEventInfo,
  InventoryItem,
  LeaderboardEntry,
  MinigameType,
  PlacedFurniture,
  ReportPayload,
  RoomSettingsPatch,
  RoomState,
  RoomSummary,
  RoomTemplateId,
  RoomTheme,
  Rotation4,
  TransactionRecord,
  TransactionType,
  UserProfile,
  UserRole,
} from '@handihotel/shared';

export interface StoredUser extends UserProfile {
  email: string;
  passwordHash: string;
  banned: boolean;
  lastDailyClaim: string | null;
  dailyStreak: number;
}

export interface CreateUserInput {
  username: string;
  email: string;
  passwordHash: string;
  avatar?: AvatarConfig;
  motto?: string;
  role?: UserRole;
  credits?: number;
  stars?: number;
}

export interface CreateRoomInput {
  ownerId: string;
  ownerUsername: string;
  name: string;
  description?: string;
  templateId: RoomTemplateId;
  theme?: RoomTheme;
  isPublic?: boolean;
  tags?: string[];
}

export interface AddFurnitureInput {
  id?: string;
  catalogItemId: string;
  ownerId: string;
  x: number;
  y: number;
  z?: number;
  rotation?: Rotation4;
  state?: Record<string, unknown>;
}

export interface UpdateFurniturePatch {
  x?: number;
  y?: number;
  z?: number;
  rotation?: Rotation4;
  state?: Record<string, unknown>;
}

export interface PurchaseResult {
  items: InventoryItem[];
  credits: number;
  stars: number;
  ownedCosmetics: string[];
  transaction: TransactionRecord;
}

export interface ExecuteTradeInput {
  userAId: string;
  userBId: string;
  userAItemIds: string[];
  userBItemIds: string[];
  userACredits: number;
  userBCredits: number;
}

export interface ExecuteTradeResult {
  tradeId: string;
  userACredits: number;
  userBCredits: number;
}

export interface RecordMinigameScoreInput {
  userId: string;
  gameType: MinigameType;
  score: number;
  won?: boolean;
  timeMs?: number;
  metadata?: Record<string, unknown>;
}

export interface UpsertHotelEventInput {
  id?: string;
  title: string;
  description: string;
  roomId: string;
  roomName?: string;
  hostUsername?: string;
  startsAt: string;
  endsAt: string;
  active?: boolean;
  rewardCredits: number;
  rewardStars?: number;
  minigameType?: MinigameType;
}

export function toPublicUserProfile(user: StoredUser): UserProfile {
  return {
    id: user.id,
    username: user.username,
    motto: user.motto,
    avatar: user.avatar,
    credits: user.credits,
    stars: user.stars,
    role: user.role,
    level: user.level,
    xp: user.xp,
    createdAt: user.createdAt,
    lastOnlineAt: user.lastOnlineAt,
    onlineStatus: user.onlineStatus,
    currentRoomId: user.currentRoomId,
    currentRoomName: user.currentRoomName,
    badges: user.badges,
    favoriteRoomIds: user.favoriteRoomIds,
    ownedCosmetics: user.ownedCosmetics,
  };
}

export interface IDataStore {
  readonly backend: 'postgres' | 'local';

  init(): Promise<void>;
  close(): Promise<void>;

  // Users
  createUser(input: CreateUserInput): Promise<StoredUser>;
  findUserById(userId: string): Promise<StoredUser | null>;
  findUserByUsername(username: string): Promise<StoredUser | null>;
  findUserByEmail(email: string): Promise<StoredUser | null>;
  updateAvatar(userId: string, avatar: AvatarConfig): Promise<StoredUser | null>;
  updateMotto(userId: string, motto: string): Promise<StoredUser | null>;
  updateBalance(
    userId: string,
    creditsDelta: number,
    starsDelta: number,
    type: TransactionType,
    description: string,
    itemId?: string
  ): Promise<{ credits: number; stars: number; transaction: TransactionRecord }>;
  getDailyRewardStatus(userId: string): Promise<DailyRewardStatus>;
  claimDailyReward(userId: string): Promise<{
    claimed: boolean;
    creditsAwarded: number;
    starsAwarded: number;
    streak: number;
    credits: number;
    stars: number;
    status: DailyRewardStatus;
  }>;
  searchUsers(query: string, limit?: number): Promise<UserProfile[]>;
  toggleFavoriteRoom(userId: string, roomId: string): Promise<string[]>;

  // Rooms
  listPublicRooms(): Promise<RoomSummary[]>;
  listRoomsByOwner(ownerId: string): Promise<RoomSummary[]>;
  searchRooms(query: string, limit?: number): Promise<RoomSummary[]>;
  getRoomState(roomId: string): Promise<RoomState | null>;
  createRoom(input: CreateRoomInput): Promise<RoomState>;
  updateRoomSettings(roomId: string, patch: RoomSettingsPatch): Promise<RoomState | null>;
  likeRoom(roomId: string, userId: string): Promise<number>;
  addFurniture(roomId: string, item: AddFurnitureInput): Promise<PlacedFurniture>;
  updateFurniture(
    roomId: string,
    furniId: string,
    patch: UpdateFurniturePatch
  ): Promise<PlacedFurniture | null>;
  removeFurniture(roomId: string, furniId: string): Promise<PlacedFurniture | null>;

  // Inventory & Economy
  getInventory(userId: string): Promise<InventoryItem[]>;
  getInventoryItem(userId: string, inventoryItemId: string): Promise<InventoryItem | null>;
  addInventoryItem(userId: string, catalogItemId: string): Promise<InventoryItem>;
  removeInventoryItem(userId: string, inventoryItemId: string): Promise<boolean>;
  purchaseCatalogItem(
    userId: string,
    catalogItemId: string,
    quantity?: number
  ): Promise<PurchaseResult>;
  executeTrade(input: ExecuteTradeInput): Promise<ExecuteTradeResult>;
  getTransactions(userId: string, limit?: number): Promise<TransactionRecord[]>;

  // Social
  getFriends(userId: string): Promise<FriendInfo[]>;
  getFriendRequests(
    userId: string
  ): Promise<{ incoming: FriendRequestInfo[]; outgoing: FriendRequestInfo[] }>;
  sendFriendRequest(fromUserId: string, toUserId: string): Promise<FriendRequestInfo>;
  respondFriendRequest(
    requestId: string,
    userId: string,
    accept: boolean
  ): Promise<{ accepted: boolean; request: FriendRequestInfo | null }>;
  removeFriend(userId: string, friendUserId: string): Promise<boolean>;
  blockUser(userId: string, targetUserId: string): Promise<void>;
  unblockUser(userId: string, targetUserId: string): Promise<void>;
  getBlockedIds(userId: string): Promise<string[]>;
  saveDirectMessage(
    fromUserId: string,
    toUserId: string,
    text: string
  ): Promise<DirectMessage>;
  getDirectMessages(
    userId: string,
    peerUserId: string,
    limit?: number
  ): Promise<DirectMessage[]>;
  createReport(
    reporterId: string,
    payload: ReportPayload
  ): Promise<{ id: string; createdAt: string }>;

  // Minigames & Events
  recordMinigameScore(input: RecordMinigameScoreInput): Promise<{ id: string; score: number }>;
  getLeaderboard(gameType: MinigameType, limit?: number): Promise<LeaderboardEntry[]>;
  getActiveEvents(): Promise<HotelEventInfo[]>;
  upsertHotelEvent(event: UpsertHotelEventInput): Promise<HotelEventInfo>;
}
