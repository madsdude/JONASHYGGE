import { create } from 'zustand';
import type {
  AvatarConfig,
  CatalogItem,
  ChatMessage,
  ChatMode,
  DailyRewardStatus,
  Direction8,
  DirectMessage,
  EmoteType,
  FriendInfo,
  FriendRequestInfo,
  HotelEventInfo,
  InventoryItem,
  LeaderboardEntry,
  MinigameSessionState,
  OnlineStatus,
  PlacedFurniture,
  PlayerInRoom,
  RoomInvite,
  RoomState,
  RoomSummary,
  Rotation4,
  TradeState,
  TransactionRecord,
  UserRole,
} from '@handihotel/shared';

export const TOKEN_STORAGE_KEY = 'handihotel_token';
const GRAPHICS_STORAGE_KEY = 'handihotel_graphics_quality';

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  motto: string;
  credits: number;
  stars: number;
  role: UserRole;
  avatar: AvatarConfig;
  level?: number;
  xp?: number;
  badges?: string[];
  ownedCosmetics?: string[];
  createdAt?: string;
}

export interface ChatBubble {
  id: string;
  userId: string;
  username: string;
  text: string;
  mode: ChatMode;
  expiresAt: number;
}

export type EditorTool = 'select' | 'place' | 'move' | 'rotate' | 'pickup';

export type ActiveModal =
  | null
  | 'navigator'
  | 'avatar'
  | 'shop'
  | 'inventory'
  | 'social'
  | 'minigames'
  | 'settings';

export type GraphicsQuality = 'high' | 'medium' | 'low';

export interface NotificationItem {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  createdAt: number;
}

export interface IncomingTradeRequest {
  tradeId: string;
  fromUserId: string;
  fromUsername: string;
}

function loadStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveStoredToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

function loadStoredGraphicsQuality(): GraphicsQuality {
  if (typeof window === 'undefined') return 'high';
  try {
    const val = window.localStorage.getItem(GRAPHICS_STORAGE_KEY);
    if (val === 'high' || val === 'medium' || val === 'low') return val;
    return 'high';
  } catch {
    return 'high';
  }
}

export interface GameState {
  // Auth
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  authLoading: boolean;

  // Room
  currentRoom: RoomState | null;
  players: Record<string, PlayerInRoom>;
  publicRooms: RoomSummary[];
  myRooms: RoomSummary[];
  playerRooms: RoomSummary[];
  isTransitioningRoom: boolean;

  // Chat
  chatMessages: ChatMessage[];
  chatBubbles: ChatBubble[];

  // Economy
  catalog: CatalogItem[];
  inventory: InventoryItem[];
  dailyReward: DailyRewardStatus | null;
  transactions: TransactionRecord[];

  // Room Editor
  editorOpen: boolean;
  editorTool: EditorTool;
  placingCatalogItemId: string | null;
  placingInventoryItemId: string | null;
  placingRotation: Rotation4;
  selectedFurniId: string | null;

  // Social
  friends: FriendInfo[];
  friendRequests: FriendRequestInfo[];
  blockedIds: string[];
  directMessages: Record<string, DirectMessage[]>;
  activeDmUserId: string | null;
  pendingInvites: RoomInvite[];

  // Trade
  activeTrade: TradeState | null;
  incomingTradeRequest: IncomingTradeRequest | null;

  // Minigames & Events
  activeMinigame: MinigameSessionState | null;
  leaderboards: Record<string, LeaderboardEntry[]>;
  hotelEvents: HotelEventInfo[];

  // UI
  activeModal: ActiveModal;
  profileUserId: string | null;
  notifications: NotificationItem[];
  graphicsQuality: GraphicsQuality;

  // Auth actions
  setAuth: (token: string, user: AuthUser) => void;
  setUser: (user: AuthUser | null) => void;
  updateUser: (patch: Partial<AuthUser>) => void;
  setAuthLoading: (loading: boolean) => void;
  logout: () => void;

  // Room actions
  setCurrentRoom: (room: RoomState | null, players?: PlayerInRoom[], chatHistory?: ChatMessage[]) => void;
  updateRoom: (room: RoomState) => void;
  updateRoomLikes: (roomId: string, likes: number) => void;
  setPlayers: (players: PlayerInRoom[]) => void;
  upsertPlayer: (player: PlayerInRoom) => void;
  removePlayer: (userId: string) => void;
  updatePlayerPosition: (
    userId: string,
    patch: {
      x: number;
      y: number;
      z: number;
      direction: Direction8;
      sitting: boolean;
      sittingFurniId: string | null;
    }
  ) => void;
  updatePlayerEmote: (userId: string, emote: EmoteType | null) => void;
  updatePlayerAvatar: (userId: string, avatar: AvatarConfig, motto?: string) => void;
  upsertFurniture: (furniture: PlacedFurniture) => void;
  removeFurniture: (furniId: string) => void;
  setPublicRooms: (rooms: RoomSummary[]) => void;
  setMyRooms: (rooms: RoomSummary[]) => void;
  setPlayerRooms: (rooms: RoomSummary[]) => void;
  setTransitioningRoom: (transitioning: boolean) => void;

  // Chat actions
  addChatMessage: (message: ChatMessage) => void;
  setChatMessages: (messages: ChatMessage[]) => void;
  clearExpiredBubbles: () => void;

  // Economy actions
  setCatalog: (items: CatalogItem[]) => void;
  setInventory: (items: InventoryItem[]) => void;
  addInventoryItem: (item: InventoryItem) => void;
  removeInventoryItem: (itemId: string) => void;
  setDailyReward: (status: DailyRewardStatus | null) => void;
  setTransactions: (records: TransactionRecord[]) => void;
  updateBalance: (credits: number, stars: number) => void;

  // Room Editor actions
  setEditorOpen: (open: boolean) => void;
  toggleEditor: () => void;
  setEditorTool: (tool: EditorTool) => void;
  setPlacingCatalogItemId: (catalogItemId: string | null) => void;
  setPlacingItem: (catalogItemId: string | null, inventoryItemId?: string | null) => void;
  setPlacingRotation: (rotation: Rotation4) => void;
  rotatePlacing: () => void;
  setSelectedFurniId: (furniId: string | null) => void;
  resetEditor: () => void;

  // Social actions
  setFriends: (friends: FriendInfo[]) => void;
  updateFriendStatus: (
    userId: string,
    onlineStatus: OnlineStatus,
    currentRoomId: string | null,
    currentRoomName: string | null
  ) => void;
  setFriendRequests: (requests: FriendRequestInfo[]) => void;
  addFriendRequest: (request: FriendRequestInfo) => void;
  removeFriendRequest: (requestId: string) => void;
  setBlockedIds: (ids: string[]) => void;
  addBlockedId: (userId: string) => void;
  removeBlockedId: (userId: string) => void;
  setDirectMessages: (peerUserId: string, messages: DirectMessage[]) => void;
  addDirectMessage: (message: DirectMessage) => void;
  setActiveDmUserId: (userId: string | null) => void;
  addPendingInvite: (invite: RoomInvite) => void;
  removePendingInvite: (inviteId: string) => void;

  // Trade actions
  setActiveTrade: (trade: TradeState | null) => void;
  setIncomingTradeRequest: (request: IncomingTradeRequest | null) => void;

  // Minigame actions
  setActiveMinigame: (session: MinigameSessionState | null) => void;
  setLeaderboard: (type: string, entries: LeaderboardEntry[]) => void;
  setHotelEvents: (events: HotelEventInfo[]) => void;

  // UI actions
  setActiveModal: (modal: ActiveModal) => void;
  toggleModal: (modal: Exclude<ActiveModal, null>) => void;
  setProfileUserId: (userId: string | null) => void;
  addNotification: (notif: Omit<NotificationItem, 'id' | 'createdAt'> & { id?: string }) => void;
  dismissNotification: (id: string) => void;
  setGraphicsQuality: (quality: GraphicsQuality) => void;
}

const MAX_CHAT_HISTORY = 150;
const MAX_NOTIFICATIONS = 6;
const CHAT_BUBBLE_LIFETIME_MS = 6500;

export const useGameStore = create<GameState>((set) => ({
  // Auth
  token: loadStoredToken(),
  user: null,
  isAuthenticated: false,
  authLoading: Boolean(loadStoredToken()),

  // Room
  currentRoom: null,
  players: {},
  publicRooms: [],
  myRooms: [],
  playerRooms: [],
  isTransitioningRoom: false,

  // Chat
  chatMessages: [],
  chatBubbles: [],

  // Economy
  catalog: [],
  inventory: [],
  dailyReward: null,
  transactions: [],

  // Room Editor
  editorOpen: false,
  editorTool: 'select',
  placingCatalogItemId: null,
  placingInventoryItemId: null,
  placingRotation: 0,
  selectedFurniId: null,

  // Social
  friends: [],
  friendRequests: [],
  blockedIds: [],
  directMessages: {},
  activeDmUserId: null,
  pendingInvites: [],

  // Trade
  activeTrade: null,
  incomingTradeRequest: null,

  // Minigames & Events
  activeMinigame: null,
  leaderboards: {},
  hotelEvents: [],

  // UI
  activeModal: null,
  profileUserId: null,
  notifications: [],
  graphicsQuality: loadStoredGraphicsQuality(),

  // ---------------------------------------------------------------------------
  // Auth Actions
  // ---------------------------------------------------------------------------
  setAuth: (token, user) => {
    saveStoredToken(token);
    set({
      token,
      user,
      isAuthenticated: true,
      authLoading: false,
    });
  },

  setUser: (user) =>
    set((state) => ({
      user,
      isAuthenticated: Boolean(user && state.token),
    })),

  updateUser: (patch) =>
    set((state) => {
      if (!state.user) return state;
      const updatedUser = { ...state.user, ...patch };
      const existingPlayer = state.players[updatedUser.id];
      const nextPlayers = existingPlayer
        ? {
            ...state.players,
            [updatedUser.id]: {
              ...existingPlayer,
              avatar: updatedUser.avatar,
              motto: updatedUser.motto,
            },
          }
        : state.players;
      return {
        user: updatedUser,
        players: nextPlayers,
      };
    }),

  setAuthLoading: (authLoading) => set({ authLoading }),

  logout: () => {
    saveStoredToken(null);
    set({
      token: null,
      user: null,
      isAuthenticated: false,
      authLoading: false,
      currentRoom: null,
      players: {},
      chatMessages: [],
      chatBubbles: [],
      inventory: [],
      dailyReward: null,
      transactions: [],
      editorOpen: false,
      editorTool: 'select',
      placingCatalogItemId: null,
      placingInventoryItemId: null,
      placingRotation: 0,
      selectedFurniId: null,
      friends: [],
      friendRequests: [],
      blockedIds: [],
      directMessages: {},
      activeDmUserId: null,
      pendingInvites: [],
      activeTrade: null,
      incomingTradeRequest: null,
      activeMinigame: null,
      activeModal: null,
      profileUserId: null,
      isTransitioningRoom: false,
    });
  },

  // ---------------------------------------------------------------------------
  // Room Actions
  // ---------------------------------------------------------------------------
  setCurrentRoom: (room, playersList, chatHistory) =>
    set((state) => {
      const playersMap: Record<string, PlayerInRoom> = {};
      if (playersList) {
        for (const p of playersList) {
          playersMap[p.userId] = p;
        }
      }
      return {
        currentRoom: room,
        players: playersList ? playersMap : room ? state.players : {},
        chatMessages: chatHistory ? chatHistory.slice(-MAX_CHAT_HISTORY) : room ? state.chatMessages : [],
        chatBubbles: [],
        isTransitioningRoom: false,
        selectedFurniId: null,
        placingCatalogItemId: null,
        placingInventoryItemId: null,
      };
    }),

  updateRoom: (room) =>
    set((state) => {
      if (state.currentRoom && state.currentRoom.id !== room.id) return state;
      return { currentRoom: room };
    }),

  updateRoomLikes: (roomId, likes) =>
    set((state) => ({
      currentRoom:
        state.currentRoom && state.currentRoom.id === roomId
          ? { ...state.currentRoom, likes }
          : state.currentRoom,
      publicRooms: state.publicRooms.map((r) => (r.id === roomId ? { ...r, likes } : r)),
      myRooms: state.myRooms.map((r) => (r.id === roomId ? { ...r, likes } : r)),
      playerRooms: state.playerRooms.map((r) => (r.id === roomId ? { ...r, likes } : r)),
    })),

  setPlayers: (playersList) => {
    const map: Record<string, PlayerInRoom> = {};
    for (const p of playersList) {
      map[p.userId] = p;
    }
    set({ players: map });
  },

  upsertPlayer: (player) =>
    set((state) => ({
      players: {
        ...state.players,
        [player.userId]: player,
      },
    })),

  removePlayer: (userId) =>
    set((state) => {
      if (!state.players[userId]) return state;
      const next = { ...state.players };
      delete next[userId];
      return { players: next };
    }),

  updatePlayerPosition: (userId, patch) =>
    set((state) => {
      const existing = state.players[userId];
      if (!existing) return state;
      return {
        players: {
          ...state.players,
          [userId]: {
            ...existing,
            ...patch,
          },
        },
      };
    }),

  updatePlayerEmote: (userId, emote) =>
    set((state) => {
      const existing = state.players[userId];
      if (!existing) return state;
      return {
        players: {
          ...state.players,
          [userId]: {
            ...existing,
            currentEmote: emote,
          },
        },
      };
    }),

  updatePlayerAvatar: (userId, avatar, motto) =>
    set((state) => {
      const existing = state.players[userId];
      if (!existing) return state;
      return {
        players: {
          ...state.players,
          [userId]: {
            ...existing,
            avatar,
            motto: motto !== undefined ? motto : existing.motto,
          },
        },
      };
    }),

  upsertFurniture: (furniture) =>
    set((state) => {
      if (!state.currentRoom || state.currentRoom.id !== furniture.roomId) return state;
      const exists = state.currentRoom.furniture.some((f) => f.id === furniture.id);
      const nextFurniture = exists
        ? state.currentRoom.furniture.map((f) => (f.id === furniture.id ? furniture : f))
        : [...state.currentRoom.furniture, furniture];
      return {
        currentRoom: {
          ...state.currentRoom,
          furniture: nextFurniture,
        },
      };
    }),

  removeFurniture: (furniId) =>
    set((state) => {
      if (!state.currentRoom) return state;
      return {
        currentRoom: {
          ...state.currentRoom,
          furniture: state.currentRoom.furniture.filter((f) => f.id !== furniId),
        },
        selectedFurniId: state.selectedFurniId === furniId ? null : state.selectedFurniId,
      };
    }),

  setPublicRooms: (publicRooms) => set({ publicRooms }),
  setMyRooms: (myRooms) => set({ myRooms }),
  setPlayerRooms: (playerRooms) => set({ playerRooms }),
  setTransitioningRoom: (isTransitioningRoom) => set({ isTransitioningRoom }),

  // ---------------------------------------------------------------------------
  // Chat Actions
  // ---------------------------------------------------------------------------
  addChatMessage: (message) =>
    set((state) => {
      const now = Date.now();
      const nextMessages = [...state.chatMessages, message].slice(-MAX_CHAT_HISTORY);
      const activeBubbles = state.chatBubbles.filter((b) => b.expiresAt > now);
      if (message.mode !== 'system') {
        activeBubbles.push({
          id: message.id,
          userId: message.userId,
          username: message.username,
          text: message.text,
          mode: message.mode,
          expiresAt: now + CHAT_BUBBLE_LIFETIME_MS,
        });
      }
      return {
        chatMessages: nextMessages,
        chatBubbles: activeBubbles.slice(-16),
      };
    }),

  setChatMessages: (messages) => set({ chatMessages: messages.slice(-MAX_CHAT_HISTORY) }),

  clearExpiredBubbles: () =>
    set((state) => {
      const now = Date.now();
      const remaining = state.chatBubbles.filter((b) => b.expiresAt > now);
      if (remaining.length === state.chatBubbles.length) return state;
      return { chatBubbles: remaining };
    }),

  // ---------------------------------------------------------------------------
  // Economy Actions
  // ---------------------------------------------------------------------------
  setCatalog: (catalog) => set({ catalog }),
  setInventory: (inventory) => set({ inventory }),
  addInventoryItem: (item) =>
    set((state) => ({
      inventory: [...state.inventory, item],
    })),
  removeInventoryItem: (itemId) =>
    set((state) => ({
      inventory: state.inventory.filter((i) => i.id !== itemId),
    })),
  setDailyReward: (dailyReward) => set({ dailyReward }),
  setTransactions: (transactions) => set({ transactions }),
  updateBalance: (credits, stars) =>
    set((state) => {
      if (!state.user) return state;
      return {
        user: {
          ...state.user,
          credits,
          stars,
        },
      };
    }),

  // ---------------------------------------------------------------------------
  // Room Editor Actions
  // ---------------------------------------------------------------------------
  setEditorOpen: (editorOpen) =>
    set((state) => ({
      editorOpen,
      ...(editorOpen
        ? {}
        : {
            editorTool: 'select' as EditorTool,
            placingCatalogItemId: null,
            placingInventoryItemId: null,
            selectedFurniId: null,
          }),
    })),

  toggleEditor: () =>
    set((state) => {
      const next = !state.editorOpen;
      return {
        editorOpen: next,
        ...(next
          ? {}
          : {
              editorTool: 'select' as EditorTool,
              placingCatalogItemId: null,
              placingInventoryItemId: null,
              selectedFurniId: null,
            }),
      };
    }),

  setEditorTool: (editorTool) => set({ editorTool }),

  setPlacingCatalogItemId: (placingCatalogItemId) =>
    set({
      placingCatalogItemId,
      placingInventoryItemId: null,
      ...(placingCatalogItemId ? { editorOpen: true, editorTool: 'place' as EditorTool } : {}),
    }),

  setPlacingItem: (placingCatalogItemId, placingInventoryItemId = null) =>
    set({
      placingCatalogItemId,
      placingInventoryItemId,
      ...(placingCatalogItemId ? { editorOpen: true, editorTool: 'place' as EditorTool } : {}),
    }),

  setPlacingRotation: (placingRotation) => set({ placingRotation }),

  rotatePlacing: () =>
    set((state) => ({
      placingRotation: (((state.placingRotation + 1) % 4) as Rotation4),
    })),

  setSelectedFurniId: (selectedFurniId) => set({ selectedFurniId }),

  resetEditor: () =>
    set({
      editorOpen: false,
      editorTool: 'select',
      placingCatalogItemId: null,
      placingInventoryItemId: null,
      placingRotation: 0,
      selectedFurniId: null,
    }),

  // ---------------------------------------------------------------------------
  // Social Actions
  // ---------------------------------------------------------------------------
  setFriends: (friends) => set({ friends }),

  updateFriendStatus: (userId, onlineStatus, currentRoomId, currentRoomName) =>
    set((state) => ({
      friends: state.friends.map((f) =>
        f.userId === userId
          ? { ...f, onlineStatus, currentRoomId, currentRoomName }
          : f
      ),
    })),

  setFriendRequests: (friendRequests) => set({ friendRequests }),

  addFriendRequest: (request) =>
    set((state) => {
      if (state.friendRequests.some((r) => r.id === request.id)) return state;
      return { friendRequests: [request, ...state.friendRequests] };
    }),

  removeFriendRequest: (requestId) =>
    set((state) => ({
      friendRequests: state.friendRequests.filter((r) => r.id !== requestId),
    })),

  setBlockedIds: (blockedIds) => set({ blockedIds }),

  addBlockedId: (userId) =>
    set((state) => ({
      blockedIds: state.blockedIds.includes(userId)
        ? state.blockedIds
        : [...state.blockedIds, userId],
    })),

  removeBlockedId: (userId) =>
    set((state) => ({
      blockedIds: state.blockedIds.filter((id) => id !== userId),
    })),

  setDirectMessages: (peerUserId, messages) =>
    set((state) => ({
      directMessages: {
        ...state.directMessages,
        [peerUserId]: messages,
      },
    })),

  addDirectMessage: (message) =>
    set((state) => {
      const myId = state.user?.id;
      const peerId = message.fromUserId === myId ? message.toUserId : message.fromUserId;
      const existing = state.directMessages[peerId] ?? [];
      if (existing.some((m) => m.id === message.id)) return state;
      return {
        directMessages: {
          ...state.directMessages,
          [peerId]: [...existing, message],
        },
      };
    }),

  setActiveDmUserId: (activeDmUserId) => set({ activeDmUserId }),

  addPendingInvite: (invite) =>
    set((state) => {
      if (state.pendingInvites.some((i) => i.id === invite.id)) return state;
      return { pendingInvites: [invite, ...state.pendingInvites].slice(0, 10) };
    }),

  removePendingInvite: (inviteId) =>
    set((state) => ({
      pendingInvites: state.pendingInvites.filter((i) => i.id !== inviteId),
    })),

  // ---------------------------------------------------------------------------
  // Trade Actions
  // ---------------------------------------------------------------------------
  setActiveTrade: (activeTrade) => set({ activeTrade }),
  setIncomingTradeRequest: (incomingTradeRequest) => set({ incomingTradeRequest }),

  // ---------------------------------------------------------------------------
  // Minigame Actions
  // ---------------------------------------------------------------------------
  setActiveMinigame: (activeMinigame) => set({ activeMinigame }),

  setLeaderboard: (type, entries) =>
    set((state) => ({
      leaderboards: {
        ...state.leaderboards,
        [type]: entries,
      },
    })),

  setHotelEvents: (hotelEvents) => set({ hotelEvents }),

  // ---------------------------------------------------------------------------
  // UI Actions
  // ---------------------------------------------------------------------------
  setActiveModal: (activeModal) => set({ activeModal }),

  toggleModal: (modal) =>
    set((state) => ({
      activeModal: state.activeModal === modal ? null : modal,
    })),

  setProfileUserId: (profileUserId) => set({ profileUserId }),

  addNotification: (notif) =>
    set((state) => {
      const id =
        notif.id ?? `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const item: NotificationItem = {
        id,
        type: notif.type,
        title: notif.title,
        message: notif.message,
        createdAt: Date.now(),
      };
      return {
        notifications: [...state.notifications, item].slice(-MAX_NOTIFICATIONS),
      };
    }),

  dismissNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),

  setGraphicsQuality: (graphicsQuality) => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(GRAPHICS_STORAGE_KEY, graphicsQuality);
      } catch {
        // Ignore storage errors
      }
    }
    set({ graphicsQuality });
  },
}));

export default useGameStore;
