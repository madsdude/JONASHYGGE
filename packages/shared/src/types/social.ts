import type { AvatarConfig } from './avatar.js';

export type UserRole = 'player' | 'vip' | 'moderator' | 'admin';

export type OnlineStatus = 'online' | 'away' | 'busy' | 'offline';

export interface UserProfile {
  id: string;
  username: string;
  motto: string;
  avatar: AvatarConfig;
  credits: number;
  stars: number;
  role: UserRole;
  level: number;
  xp: number;
  createdAt: string;
  lastOnlineAt: string;
  onlineStatus: OnlineStatus;
  currentRoomId: string | null;
  currentRoomName: string | null;
  badges: string[];
  favoriteRoomIds: string[];
  ownedCosmetics: string[];
}

export interface FriendInfo {
  userId: string;
  username: string;
  motto: string;
  avatar: AvatarConfig;
  onlineStatus: OnlineStatus;
  currentRoomId: string | null;
  currentRoomName: string | null;
  since: string;
}

export interface FriendRequestInfo {
  id: string;
  fromUserId: string;
  fromUsername: string;
  fromAvatar: AvatarConfig;
  toUserId: string;
  toUsername: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
}

export interface DirectMessage {
  id: string;
  fromUserId: string;
  fromUsername: string;
  toUserId: string;
  toUsername: string;
  text: string;
  read: boolean;
  createdAt: string;
}

export interface RoomInvite {
  id: string;
  fromUserId: string;
  fromUsername: string;
  toUserId: string;
  roomId: string;
  roomName: string;
  message: string;
  createdAt: string;
}

export type ReportReason =
  | 'harassment'
  | 'spam'
  | 'inappropriate_content'
  | 'cheating'
  | 'scamming'
  | 'other';

export interface ReportPayload {
  targetUserId?: string;
  targetUsername?: string;
  roomId?: string;
  reason: ReportReason;
  details: string;
}
