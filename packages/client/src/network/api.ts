import type {
  AvatarConfig,
  CatalogItem,
  DailyRewardStatus,
  DirectMessage,
  FloorStyle,
  FriendInfo,
  FriendRequestInfo,
  HotelEventInfo,
  InventoryItem,
  LeaderboardEntry,
  MinigameType,
  ReportPayload,
  RoomAccessMode,
  RoomSettingsPatch,
  RoomState,
  RoomSummary,
  RoomTemplateId,
  TransactionRecord,
  UserProfile,
  WallStyle,
} from '@handihotel/shared';
import { TOKEN_STORAGE_KEY, useGameStore, type AuthUser } from '../state/useGameStore';

const API_BASE =
  (typeof import.meta !== 'undefined' &&
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_API_URL
    ? `${(import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_API_URL}/api`
    : '/api');

export class ApiError extends Error {
  public readonly status: number;
  public readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function getAuthToken(): string | null {
  const storeToken = useGameStore.getState().token;
  if (storeToken) return storeToken;
  if (typeof window !== 'undefined') {
    try {
      return window.localStorage.getItem(TOKEN_STORAGE_KEY);
    } catch {
      return null;
    }
  }
  return null;
}

async function request<T>(
  path: string,
  options: RequestInit & { skipAuth?: boolean } = {}
): Promise<T> {
  const { skipAuth, headers, ...rest } = options;
  const finalHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(headers as Record<string, string> | undefined),
  };

  if (!skipAuth) {
    const token = getAuthToken();
    if (token) {
      finalHeaders.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: finalHeaders,
  });

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!response.ok) {
    const errObj = (data ?? {}) as { error?: string; message?: string; code?: string };
    const message = errObj.error || errObj.message || `Request failed (${response.status})`;
    throw new ApiError(message, response.status, errObj.code);
  }

  return data as T;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface RoomsListResponse {
  publicRooms: RoomSummary[];
  myRooms: RoomSummary[];
  playerRooms: RoomSummary[];
}

export interface CreateRoomPayload {
  name: string;
  description?: string;
  templateId: RoomTemplateId;
  floorStyle?: FloorStyle;
  wallStyle?: WallStyle;
  floorColor?: string;
  wallColor?: string;
  isPublic?: boolean;
  accessMode?: RoomAccessMode;
  tags?: string[];
}

export interface PurchaseResponse {
  item: InventoryItem;
  credits: number;
  stars: number;
  user?: AuthUser;
}

export interface ClaimDailyRewardResponse {
  rewardCredits: number;
  rewardStars: number;
  credits: number;
  stars: number;
  status: DailyRewardStatus;
}

export interface UserSearchResult {
  id: string;
  username: string;
  motto: string;
  avatar: AvatarConfig;
  onlineStatus?: string;
  currentRoomId?: string | null;
  currentRoomName?: string | null;
}

export const api = {
  // ---------------------------------------------------------------------------
  // Auth & Profile
  // ---------------------------------------------------------------------------
  register: (payload: {
    username: string;
    email: string;
    password: string;
    avatar?: AvatarConfig;
  }): Promise<AuthResponse> =>
    request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
      skipAuth: true,
    }),

  login: (payload: { usernameOrEmail: string; password: string }): Promise<AuthResponse> =>
    request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: payload.usernameOrEmail,
        email: payload.usernameOrEmail,
        usernameOrEmail: payload.usernameOrEmail,
        password: payload.password,
      }),
      skipAuth: true,
    }),

  me: (): Promise<{ user: AuthUser }> => request<{ user: AuthUser }>('/auth/me'),

  updateAvatar: (avatar: AvatarConfig, motto?: string): Promise<{ user: AuthUser }> =>
    request<{ user: AuthUser }>('/auth/avatar', {
      method: 'PATCH',
      body: JSON.stringify(motto !== undefined ? { avatar, motto } : { avatar }),
    }),

  updateMotto: (motto: string): Promise<{ user: AuthUser }> =>
    request<{ user: AuthUser }>('/auth/motto', {
      method: 'PATCH',
      body: JSON.stringify({ motto }),
    }),

  // ---------------------------------------------------------------------------
  // Rooms
  // ---------------------------------------------------------------------------
  listRooms: async (): Promise<RoomsListResponse> => {
    const res = await request<Partial<RoomsListResponse> | RoomSummary[]>('/rooms');
    if (Array.isArray(res)) {
      return {
        publicRooms: res.filter((r) => r.isPublic),
        myRooms: [],
        playerRooms: res.filter((r) => !r.isPublic),
      };
    }
    return {
      publicRooms: res.publicRooms ?? [],
      myRooms: res.myRooms ?? [],
      playerRooms: res.playerRooms ?? [],
    };
  },

  getRooms: (): Promise<RoomsListResponse> => api.listRooms(),

  createRoom: (payload: CreateRoomPayload): Promise<{ room: RoomState }> =>
    request<{ room: RoomState }>('/rooms', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  searchRooms: async (query: string): Promise<RoomSummary[]> => {
    const res = await request<{ rooms: RoomSummary[] } | RoomSummary[]>(
      `/rooms/search?q=${encodeURIComponent(query)}`
    );
    return Array.isArray(res) ? res : res.rooms ?? [];
  },

  updateRoomSettings: (
    roomId: string,
    patch: RoomSettingsPatch
  ): Promise<{ room: RoomState }> =>
    request<{ room: RoomState }>(`/rooms/${encodeURIComponent(roomId)}/settings`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  // ---------------------------------------------------------------------------
  // Economy
  // ---------------------------------------------------------------------------
  getCatalog: async (): Promise<CatalogItem[]> => {
    const res = await request<{ items: CatalogItem[] } | CatalogItem[]>('/economy/catalog');
    return Array.isArray(res) ? res : res.items ?? [];
  },

  purchaseItem: (catalogItemId: string, quantity = 1): Promise<PurchaseResponse> =>
    request<PurchaseResponse>('/economy/buy', {
      method: 'POST',
      body: JSON.stringify({ catalogItemId, quantity }),
    }),

  buyItem: (catalogItemId: string, quantity = 1): Promise<PurchaseResponse> =>
    api.purchaseItem(catalogItemId, quantity),

  getInventory: async (): Promise<InventoryItem[]> => {
    const res = await request<{ items: InventoryItem[] } | InventoryItem[]>('/economy/inventory');
    return Array.isArray(res) ? res : res.items ?? [];
  },

  getDailyReward: (): Promise<DailyRewardStatus> =>
    request<DailyRewardStatus>('/economy/daily-reward'),

  claimDailyReward: (): Promise<ClaimDailyRewardResponse> =>
    request<ClaimDailyRewardResponse>('/economy/daily-reward/claim', {
      method: 'POST',
    }),

  getTransactions: async (): Promise<TransactionRecord[]> => {
    const res = await request<{ transactions: TransactionRecord[] } | TransactionRecord[]>(
      '/economy/transactions'
    );
    return Array.isArray(res) ? res : res.transactions ?? [];
  },

  // ---------------------------------------------------------------------------
  // Social
  // ---------------------------------------------------------------------------
  getFriends: async (): Promise<FriendInfo[]> => {
    const res = await request<{ friends: FriendInfo[] } | FriendInfo[]>('/social/friends');
    return Array.isArray(res) ? res : res.friends ?? [];
  },

  getFriendRequests: async (): Promise<FriendRequestInfo[]> => {
    const res = await request<{ requests: FriendRequestInfo[] } | FriendRequestInfo[]>(
      '/social/friends/requests'
    );
    return Array.isArray(res) ? res : res.requests ?? [];
  },

  sendFriendRequest: (targetUsername: string): Promise<{ request: FriendRequestInfo }> =>
    request<{ request: FriendRequestInfo }>('/social/friends/request', {
      method: 'POST',
      body: JSON.stringify({ targetUsername }),
    }),

  respondFriendRequest: (
    requestId: string,
    accept: boolean
  ): Promise<{ ok: boolean; friend?: FriendInfo }> =>
    request<{ ok: boolean; friend?: FriendInfo }>(
      `/social/friends/requests/${encodeURIComponent(requestId)}`,
      {
        method: 'POST',
        body: JSON.stringify({ accept }),
      }
    ),

  removeFriend: (friendUserId: string): Promise<{ ok: boolean }> =>
    request<{ ok: boolean }>(`/social/friends/${encodeURIComponent(friendUserId)}`, {
      method: 'DELETE',
    }),

  getBlockedUsers: async (): Promise<string[]> => {
    const res = await request<{ blockedIds: string[] } | string[]>('/social/blocked');
    return Array.isArray(res) ? res : res.blockedIds ?? [];
  },

  blockUser: (targetUserId: string): Promise<{ ok: boolean }> =>
    request<{ ok: boolean }>('/social/block', {
      method: 'POST',
      body: JSON.stringify({ targetUserId }),
    }),

  unblockUser: (targetUserId: string): Promise<{ ok: boolean }> =>
    request<{ ok: boolean }>(`/social/block/${encodeURIComponent(targetUserId)}`, {
      method: 'DELETE',
    }),

  getDirectMessages: async (peerUserId: string): Promise<DirectMessage[]> => {
    const res = await request<{ messages: DirectMessage[] } | DirectMessage[]>(
      `/social/dms/${encodeURIComponent(peerUserId)}`
    );
    return Array.isArray(res) ? res : res.messages ?? [];
  },

  sendDirectMessage: (
    toUserId: string,
    text: string
  ): Promise<{ message: DirectMessage }> =>
    request<{ message: DirectMessage }>(`/social/dms/${encodeURIComponent(toUserId)}`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  getUserProfile: async (userId: string): Promise<UserProfile> => {
    const res = await request<{ profile: UserProfile } | UserProfile>(
      `/social/profile/${encodeURIComponent(userId)}`
    );
    return 'profile' in res ? res.profile : res;
  },

  searchUsers: async (query: string): Promise<UserSearchResult[]> => {
    const res = await request<{ users: UserSearchResult[] } | UserSearchResult[]>(
      `/social/search?q=${encodeURIComponent(query)}`
    );
    return Array.isArray(res) ? res : res.users ?? [];
  },

  reportUser: (payload: ReportPayload): Promise<{ ok: boolean }> =>
    request<{ ok: boolean }>('/social/report', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // ---------------------------------------------------------------------------
  // Minigames & Events
  // ---------------------------------------------------------------------------
  getLeaderboards: async (type?: MinigameType): Promise<LeaderboardEntry[]> => {
    const qs = type ? `?type=${encodeURIComponent(type)}` : '';
    const res = await request<{ entries: LeaderboardEntry[] } | LeaderboardEntry[]>(
      `/minigames/leaderboards${qs}`
    );
    return Array.isArray(res) ? res : res.entries ?? [];
  },

  getLeaderboard: (type?: MinigameType): Promise<LeaderboardEntry[]> =>
    api.getLeaderboards(type),

  getEvents: async (): Promise<HotelEventInfo[]> => {
    const res = await request<{ events: HotelEventInfo[] } | HotelEventInfo[]>(
      '/minigames/events'
    );
    return Array.isArray(res) ? res : res.events ?? [];
  },
};

export default api;
