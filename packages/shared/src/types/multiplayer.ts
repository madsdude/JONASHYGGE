import type { AvatarConfig, EmoteType } from './avatar.js';
import type { TradeState } from './economy.js';
import type {
  HotelEventInfo,
  MinigameSessionState,
  MinigameType,
} from './minigames.js';
import type {
  Direction8,
  FloorStyle,
  PlacedFurniture,
  RoomPermissions,
  RoomState,
  Rotation4,
  TileCoord,
  WallStyle,
} from './room.js';
import type {
  DirectMessage,
  FriendRequestInfo,
  OnlineStatus,
  ReportPayload,
  RoomInvite,
} from './social.js';

export interface PlayerInRoom {
  userId: string;
  username: string;
  motto: string;
  avatar: AvatarConfig;
  x: number;
  y: number;
  z: number;
  direction: Direction8;
  sitting: boolean;
  sittingFurniId: string | null;
  currentEmote: EmoteType | null;
  isAdmin: boolean;
  speedMultiplier: number;
}

export type ChatMode = 'normal' | 'shout' | 'whisper' | 'system';

export interface ChatMessage {
  id: string;
  roomId: string;
  userId: string;
  username: string;
  text: string;
  mode: ChatMode;
  targetUsername?: string;
  timestamp: number;
}

export interface RoomSettingsPatch {
  name?: string;
  description?: string;
  floorStyle?: FloorStyle;
  wallStyle?: WallStyle;
  floorColor?: string;
  wallColor?: string;
  permissions?: Partial<RoomPermissions>;
  tags?: string[];
}

export interface MinigameActionPayload {
  sessionId: string;
  action:
    | 'checkpoint'
    | 'boost'
    | 'dance_hit'
    | 'collect_star'
    | 'hit_hazard'
    | 'olympics_score';
  value?: number;
  key?: 'up' | 'down' | 'left' | 'right' | 'space';
  x?: number;
  y?: number;
  hazardId?: string;
}

export interface ClientToServerEvents {
  // Room lifecycle
  'room:join': (
    payload: { roomId: string; password?: string },
    callback?: (res: { ok: boolean; error?: string; room?: RoomState; players?: PlayerInRoom[] }) => void
  ) => void;
  'room:leave': (payload: { roomId: string }) => void;
  'room:updateSettings': (
    payload: { roomId: string; patch: RoomSettingsPatch },
    callback?: (res: { ok: boolean; error?: string }) => void
  ) => void;
  'room:like': (payload: { roomId: string }) => void;
  'room:kick': (payload: { roomId: string; targetUserId: string }) => void;

  // Movement & Avatar
  'avatar:move': (payload: { x: number; y: number }) => void;
  'avatar:sit': (payload: { furniId?: string; x?: number; y?: number }) => void;
  'avatar:stand': () => void;
  'avatar:emote': (payload: { emote: EmoteType }) => void;
  'avatar:update': (payload: { avatar: AvatarConfig; motto?: string }) => void;

  // Chat
  'chat:send': (payload: { text: string; mode?: ChatMode; targetUsername?: string }) => void;

  // Furniture manipulation
  'furni:place': (
    payload: { inventoryItemId: string; x: number; y: number; rotation?: Rotation4 },
    callback?: (res: { ok: boolean; error?: string; furniture?: PlacedFurniture }) => void
  ) => void;
  'furni:move': (
    payload: { furniId: string; x: number; y: number; rotation?: Rotation4 },
    callback?: (res: { ok: boolean; error?: string }) => void
  ) => void;
  'furni:rotate': (
    payload: { furniId: string; rotation?: Rotation4 },
    callback?: (res: { ok: boolean; error?: string }) => void
  ) => void;
  'furni:pickup': (
    payload: { furniId: string },
    callback?: (res: { ok: boolean; error?: string }) => void
  ) => void;
  'furni:interact': (payload: { furniId: string }) => void;

  // Trading
  'trade:request': (payload: { targetUserId: string }) => void;
  'trade:respond': (payload: { tradeId: string; accept: boolean }) => void;
  'trade:updateOffer': (payload: { tradeId: string; itemIds: string[]; credits: number }) => void;
  'trade:accept': (payload: { tradeId: string; accepted: boolean }) => void;
  'trade:confirm': (payload: { tradeId: string }) => void;
  'trade:cancel': (payload: { tradeId: string }) => void;

  // Social
  'social:dm': (
    payload: { toUserId: string; text: string },
    callback?: (res: { ok: boolean; message?: DirectMessage; error?: string }) => void
  ) => void;
  'social:invite': (payload: { toUserId: string; roomId: string; message?: string }) => void;
  'social:friendRequest': (payload: { targetUsername: string }) => void;
  'social:report': (
    payload: ReportPayload,
    callback?: (res: { ok: boolean; error?: string }) => void
  ) => void;

  // Minigames
  'minigame:join': (payload: { roomId: string; type: MinigameType }) => void;
  'minigame:leave': (payload: { sessionId: string }) => void;
  'minigame:ready': (payload: { sessionId: string; ready: boolean }) => void;
  'minigame:start': (payload: { sessionId: string }) => void;
  'minigame:action': (payload: MinigameActionPayload) => void;
}

export interface ServerToClientEvents {
  // Room lifecycle
  'room:state': (payload: { room: RoomState; players: PlayerInRoom[]; chatHistory: ChatMessage[] }) => void;
  'room:userJoined': (payload: { player: PlayerInRoom }) => void;
  'room:userLeft': (payload: { userId: string }) => void;
  'room:settingsUpdated': (payload: { room: RoomState }) => void;
  'room:liked': (payload: { roomId: string; likes: number }) => void;
  'room:kicked': (payload: { roomId: string; reason: string }) => void;

  // Movement & Avatar
  'avatar:path': (payload: { userId: string; path: TileCoord[]; direction: Direction8 }) => void;
  'avatar:moved': (payload: {
    userId: string;
    x: number;
    y: number;
    z: number;
    direction: Direction8;
    sitting: boolean;
    sittingFurniId: string | null;
  }) => void;
  'avatar:emoted': (payload: { userId: string; emote: EmoteType | null }) => void;
  'avatar:updated': (payload: { userId: string; avatar: AvatarConfig; motto: string }) => void;

  // Chat
  'chat:message': (message: ChatMessage) => void;

  // Furniture
  'furni:placed': (payload: { furniture: PlacedFurniture }) => void;
  'furni:moved': (payload: { furniture: PlacedFurniture }) => void;
  'furni:removed': (payload: { furniId: string }) => void;
  'furni:updated': (payload: { furniture: PlacedFurniture; effect?: string }) => void;

  // Trading
  'trade:requested': (payload: { trade: TradeState }) => void;
  'trade:updated': (payload: { trade: TradeState }) => void;
  'trade:completed': (payload: { tradeId: string; summary: string }) => void;
  'trade:cancelled': (payload: { tradeId: string; reason: string }) => void;

  // Social
  'social:dmReceived': (message: DirectMessage) => void;
  'social:inviteReceived': (invite: RoomInvite) => void;
  'social:friendRequestReceived': (request: FriendRequestInfo) => void;
  'social:friendStatusChanged': (payload: {
    userId: string;
    onlineStatus: OnlineStatus;
    currentRoomId: string | null;
    currentRoomName: string | null;
  }) => void;

  // Minigames & Events
  'minigame:state': (session: MinigameSessionState) => void;
  'minigame:ended': (payload: {
    session: MinigameSessionState;
    winnerUsername: string | null;
    rewards: Record<string, { credits: number; stars: number }>;
  }) => void;
  'event:updated': (events: HotelEventInfo[]) => void;

  // System & Economy
  'economy:updated': (payload: { credits: number; stars: number; reason?: string }) => void;
  notification: (payload: {
    id: string;
    type: 'info' | 'success' | 'warning' | 'error';
    title: string;
    message: string;
  }) => void;
  error: (payload: { code: string; message: string }) => void;
}
