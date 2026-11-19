import { v4 as uuidv4 } from 'uuid';
import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  DirectMessage,
  OnlineStatus,
  ReportPayload,
  RoomInvite,
  ServerToClientEvents,
} from '@handihotel/shared';
import type { IDataStore } from '../db/store.js';
import type { IPresenceService } from '../redis/presence.js';

export type GameIO = Server<ClientToServerEvents, ServerToClientEvents>;
export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export interface SocketUserContext {
  userId: string;
  username: string;
  role: string;
  currentRoomId: string | null;
}

export function getSocketUser(socket: GameSocket): SocketUserContext | null {
  const data = socket.data as Partial<SocketUserContext> | undefined;
  if (!data?.userId || !data?.username) return null;
  return {
    userId: data.userId,
    username: data.username,
    role: data.role ?? 'player',
    currentRoomId: data.currentRoomId ?? null,
  };
}

export class SocialManager {
  constructor(
    private readonly io: GameIO,
    private readonly store: IDataStore,
    private readonly presence: IPresenceService
  ) {}

  async emitToUser<E extends keyof ServerToClientEvents>(
    userId: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): Promise<boolean> {
    const socketIds = await this.presence.getUserSocketIds(userId);
    if (socketIds.length === 0) return false;
    for (const sid of socketIds) {
      this.io.to(sid).emit(event, ...args);
    }
    return true;
  }

  async notifyFriendsStatus(
    userId: string,
    onlineStatus: OnlineStatus,
    currentRoomId: string | null,
    currentRoomName: string | null
  ): Promise<void> {
    try {
      const friends = await this.store.getFriends(userId);
      if (friends.length === 0) return;

      const payload = {
        userId,
        onlineStatus,
        currentRoomId,
        currentRoomName,
      };

      await Promise.all(
        friends.map((friend) =>
          this.emitToUser(friend.userId, 'social:friendStatusChanged', payload)
        )
      );
    } catch (err) {
      console.error('[SocialManager] notifyFriendsStatus error:', err);
    }
  }

  async handleDirectMessage(
    socket: GameSocket,
    payload: { toUserId: string; text: string },
    callback?: (res: { ok: boolean; message?: DirectMessage; error?: string }) => void
  ): Promise<void> {
    const user = getSocketUser(socket);
    if (!user) {
      callback?.({ ok: false, error: 'Not authenticated' });
      return;
    }

    const toUserId = payload?.toUserId?.trim();
    const rawText = typeof payload?.text === 'string' ? payload.text : '';
    const text = rawText.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 500);

    if (!toUserId || toUserId === user.userId) {
      callback?.({ ok: false, error: 'Invalid recipient' });
      return;
    }
    if (!text) {
      callback?.({ ok: false, error: 'Message cannot be empty' });
      return;
    }

    try {
      const [senderBlocked, recipientBlocked, recipient] = await Promise.all([
        this.store.getBlockedIds(user.userId),
        this.store.getBlockedIds(toUserId),
        this.store.findUserById(toUserId),
      ]);

      if (!recipient) {
        callback?.({ ok: false, error: 'Recipient not found' });
        return;
      }

      if (senderBlocked.includes(toUserId) || recipientBlocked.includes(user.userId)) {
        callback?.({ ok: false, error: 'Unable to send message to this user' });
        return;
      }

      const message = await this.store.saveDirectMessage(user.userId, toUserId, text);

      // Deliver live to recipient if online
      await this.emitToUser(toUserId, 'social:dmReceived', message);

      // Also sync to sender's other open tabs/sockets
      const senderSockets = await this.presence.getUserSocketIds(user.userId);
      for (const sid of senderSockets) {
        if (sid !== socket.id) {
          this.io.to(sid).emit('social:dmReceived', message);
        }
      }

      callback?.({ ok: true, message });
    } catch (err) {
      console.error('[SocialManager] handleDirectMessage error:', err);
      callback?.({ ok: false, error: 'Failed to send direct message' });
    }
  }

  async handleRoomInvite(
    socket: GameSocket,
    payload: { toUserId: string; roomId: string; message?: string }
  ): Promise<void> {
    const user = getSocketUser(socket);
    if (!user) return;

    const toUserId = payload?.toUserId?.trim();
    const roomId = payload?.roomId?.trim();
    if (!toUserId || !roomId || toUserId === user.userId) return;

    try {
      const [recipientBlocked, room] = await Promise.all([
        this.store.getBlockedIds(toUserId),
        this.store.getRoomState(roomId),
      ]);

      if (recipientBlocked.includes(user.userId)) {
        socket.emit('notification', {
          id: uuidv4(),
          type: 'warning',
          title: 'Invite Not Sent',
          message: 'Unable to invite this user.',
        });
        return;
      }

      if (!room) {
        socket.emit('error', { code: 'ROOM_NOT_FOUND', message: 'Room not found' });
        return;
      }

      const cleanMessage = (payload.message ?? `Come join me in ${room.name}!`)
        .replace(/[\u0000-\u001F\u007F]/g, '')
        .trim()
        .slice(0, 200);

      const invite: RoomInvite = {
        id: uuidv4(),
        fromUserId: user.userId,
        fromUsername: user.username,
        toUserId,
        roomId: room.id,
        roomName: room.name,
        message: cleanMessage || `Come join me in ${room.name}!`,
        createdAt: new Date().toISOString(),
      };

      const delivered = await this.emitToUser(toUserId, 'social:inviteReceived', invite);
      socket.emit('notification', {
        id: uuidv4(),
        type: delivered ? 'success' : 'info',
        title: delivered ? 'Room Invite Sent' : 'User Offline',
        message: delivered
          ? `Invited player to ${room.name}!`
          : 'That player is currently offline.',
      });
    } catch (err) {
      console.error('[SocialManager] handleRoomInvite error:', err);
      socket.emit('error', { code: 'INVITE_FAILED', message: 'Failed to send room invite' });
    }
  }

  async handleFriendRequest(
    socket: GameSocket,
    payload: { targetUsername: string }
  ): Promise<void> {
    const user = getSocketUser(socket);
    if (!user) return;

    const targetUsername = payload?.targetUsername?.trim();
    if (!targetUsername) {
      socket.emit('error', { code: 'INVALID_USER', message: 'Please enter a username' });
      return;
    }

    try {
      const target = await this.store.findUserByUsername(targetUsername);
      if (!target) {
        socket.emit('notification', {
          id: uuidv4(),
          type: 'error',
          title: 'Player Not Found',
          message: `Could not find player "${targetUsername}".`,
        });
        return;
      }

      if (target.id === user.userId) {
        socket.emit('notification', {
          id: uuidv4(),
          type: 'warning',
          title: 'Friend Request',
          message: 'You cannot add yourself as a friend.',
        });
        return;
      }

      const request = await this.store.sendFriendRequest(user.userId, target.id);
      await this.emitToUser(target.id, 'social:friendRequestReceived', request);

      socket.emit('notification', {
        id: uuidv4(),
        type: 'success',
        title: 'Friend Request Sent',
        message: `Friend request sent to ${target.username}!`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send friend request';
      socket.emit('notification', {
        id: uuidv4(),
        type: 'warning',
        title: 'Friend Request',
        message,
      });
    }
  }

  async handleReport(
    socket: GameSocket,
    payload: ReportPayload,
    callback?: (res: { ok: boolean; error?: string }) => void
  ): Promise<void> {
    const user = getSocketUser(socket);
    if (!user) {
      callback?.({ ok: false, error: 'Not authenticated' });
      return;
    }

    try {
      await this.store.createReport(user.userId, {
        targetUserId: payload.targetUserId,
        targetUsername: payload.targetUsername,
        roomId: payload.roomId ?? user.currentRoomId ?? undefined,
        reason: payload.reason,
        details: (payload.details ?? '').slice(0, 1000),
      });

      socket.emit('notification', {
        id: uuidv4(),
        type: 'info',
        title: 'Report Submitted',
        message: 'Thank you. HandiHotel moderators will review your report.',
      });
      callback?.({ ok: true });
    } catch (err) {
      console.error('[SocialManager] handleReport error:', err);
      callback?.({ ok: false, error: 'Failed to submit report' });
    }
  }
}
