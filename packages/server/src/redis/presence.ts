import type { OnlineStatus } from '@handihotel/shared';
import type { Redis } from 'ioredis';

export interface UserPresence {
  userId: string;
  username: string;
  onlineStatus: OnlineStatus;
  currentRoomId: string | null;
  currentRoomName: string | null;
  socketIds: string[];
  lastSeenAt: number;
}

export interface IPresenceService {
  readonly backend: 'redis' | 'memory';

  setUserOnline(userId: string, username: string, socketId: string): Promise<void>;
  setUserOffline(userId: string, socketId: string): Promise<boolean>;
  setUserRoom(userId: string, roomId: string | null, roomName: string | null): Promise<void>;
  getUserPresence(userId: string): Promise<UserPresence | null>;
  getUsersPresence(userIds: string[]): Promise<Map<string, UserPresence>>;
  getRoomUserIds(roomId: string): Promise<string[]>;
  getRoomUserCount(roomId: string): Promise<number>;
  getRoomUserCounts(roomIds: string[]): Promise<Record<string, number>>;
  getOnlineUserCount(): Promise<number>;
  getUserSocketIds(userId: string): Promise<string[]>;
  close(): Promise<void>;
}

export class MemoryPresenceService implements IPresenceService {
  readonly backend = 'memory' as const;

  private users = new Map<string, UserPresence>();
  private roomUsers = new Map<string, Set<string>>();

  async setUserOnline(userId: string, username: string, socketId: string): Promise<void> {
    const existing = this.users.get(userId);
    if (existing) {
      if (!existing.socketIds.includes(socketId)) {
        existing.socketIds.push(socketId);
      }
      existing.username = username;
      existing.onlineStatus = 'online';
      existing.lastSeenAt = Date.now();
    } else {
      this.users.set(userId, {
        userId,
        username,
        onlineStatus: 'online',
        currentRoomId: null,
        currentRoomName: null,
        socketIds: [socketId],
        lastSeenAt: Date.now(),
      });
    }
  }

  async setUserOffline(userId: string, socketId: string): Promise<boolean> {
    const existing = this.users.get(userId);
    if (!existing) return true;

    existing.socketIds = existing.socketIds.filter((id) => id !== socketId);
    existing.lastSeenAt = Date.now();

    if (existing.socketIds.length === 0) {
      if (existing.currentRoomId) {
        const members = this.roomUsers.get(existing.currentRoomId);
        if (members) {
          members.delete(userId);
          if (members.size === 0) {
            this.roomUsers.delete(existing.currentRoomId);
          }
        }
      }
      this.users.delete(userId);
      return true;
    }

    return false;
  }

  async setUserRoom(
    userId: string,
    roomId: string | null,
    roomName: string | null
  ): Promise<void> {
    const existing = this.users.get(userId);
    if (!existing) return;

    if (existing.currentRoomId && existing.currentRoomId !== roomId) {
      const prevSet = this.roomUsers.get(existing.currentRoomId);
      if (prevSet) {
        prevSet.delete(userId);
        if (prevSet.size === 0) {
          this.roomUsers.delete(existing.currentRoomId);
        }
      }
    }

    existing.currentRoomId = roomId;
    existing.currentRoomName = roomName;
    existing.lastSeenAt = Date.now();

    if (roomId) {
      let nextSet = this.roomUsers.get(roomId);
      if (!nextSet) {
        nextSet = new Set<string>();
        this.roomUsers.set(roomId, nextSet);
      }
      nextSet.add(userId);
    }
  }

  async getUserPresence(userId: string): Promise<UserPresence | null> {
    const entry = this.users.get(userId);
    if (!entry) return null;
    return { ...entry, socketIds: [...entry.socketIds] };
  }

  async getUsersPresence(userIds: string[]): Promise<Map<string, UserPresence>> {
    const result = new Map<string, UserPresence>();
    for (const id of userIds) {
      const entry = this.users.get(id);
      if (entry) {
        result.set(id, { ...entry, socketIds: [...entry.socketIds] });
      }
    }
    return result;
  }

  async getRoomUserIds(roomId: string): Promise<string[]> {
    const set = this.roomUsers.get(roomId);
    return set ? Array.from(set) : [];
  }

  async getRoomUserCount(roomId: string): Promise<number> {
    return this.roomUsers.get(roomId)?.size ?? 0;
  }

  async getRoomUserCounts(roomIds: string[]): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const roomId of roomIds) {
      counts[roomId] = this.roomUsers.get(roomId)?.size ?? 0;
    }
    return counts;
  }

  async getOnlineUserCount(): Promise<number> {
    return this.users.size;
  }

  async getUserSocketIds(userId: string): Promise<string[]> {
    return [...(this.users.get(userId)?.socketIds ?? [])];
  }

  async close(): Promise<void> {
    this.users.clear();
    this.roomUsers.clear();
  }
}

const KEY_PREFIX = 'handihotel:presence';

export class RedisPresenceService implements IPresenceService {
  readonly backend = 'redis' as const;

  constructor(private readonly redis: Redis) {}

  private userKey(userId: string): string {
    return `${KEY_PREFIX}:user:${userId}`;
  }

  private userSocketsKey(userId: string): string {
    return `${KEY_PREFIX}:user:${userId}:sockets`;
  }

  private roomKey(roomId: string): string {
    return `${KEY_PREFIX}:room:${roomId}`;
  }

  private onlineSetKey(): string {
    return `${KEY_PREFIX}:online`;
  }

  async setUserOnline(userId: string, username: string, socketId: string): Promise<void> {
    const now = String(Date.now());
    const pipeline = this.redis.pipeline();
    pipeline.sadd(this.onlineSetKey(), userId);
    pipeline.sadd(this.userSocketsKey(userId), socketId);
    pipeline.hset(this.userKey(userId), {
      userId,
      username,
      onlineStatus: 'online',
      lastSeenAt: now,
    });
    await pipeline.exec();
  }

  async setUserOffline(userId: string, socketId: string): Promise<boolean> {
    await this.redis.srem(this.userSocketsKey(userId), socketId);
    const remaining = await this.redis.scard(this.userSocketsKey(userId));

    if (remaining <= 0) {
      const currentRoomId = await this.redis.hget(this.userKey(userId), 'currentRoomId');
      const pipeline = this.redis.pipeline();
      pipeline.srem(this.onlineSetKey(), userId);
      if (currentRoomId) {
        pipeline.srem(this.roomKey(currentRoomId), userId);
      }
      pipeline.del(this.userKey(userId), this.userSocketsKey(userId));
      await pipeline.exec();
      return true;
    }

    await this.redis.hset(this.userKey(userId), 'lastSeenAt', String(Date.now()));
    return false;
  }

  async setUserRoom(
    userId: string,
    roomId: string | null,
    roomName: string | null
  ): Promise<void> {
    const prevRoomId = await this.redis.hget(this.userKey(userId), 'currentRoomId');
    const pipeline = this.redis.pipeline();

    if (prevRoomId && prevRoomId !== roomId) {
      pipeline.srem(this.roomKey(prevRoomId), userId);
    }

    if (roomId) {
      pipeline.sadd(this.roomKey(roomId), userId);
      pipeline.hset(this.userKey(userId), {
        currentRoomId: roomId,
        currentRoomName: roomName ?? '',
        lastSeenAt: String(Date.now()),
      });
    } else {
      pipeline.hdel(this.userKey(userId), 'currentRoomId', 'currentRoomName');
      pipeline.hset(this.userKey(userId), 'lastSeenAt', String(Date.now()));
    }

    await pipeline.exec();
  }

  async getUserPresence(userId: string): Promise<UserPresence | null> {
    const [data, socketIds] = await Promise.all([
      this.redis.hgetall(this.userKey(userId)),
      this.redis.smembers(this.userSocketsKey(userId)),
    ]);

    if (!data || !data.userId) return null;

    return {
      userId: data.userId,
      username: data.username ?? '',
      onlineStatus: (data.onlineStatus as OnlineStatus) || 'online',
      currentRoomId: data.currentRoomId || null,
      currentRoomName: data.currentRoomName || null,
      socketIds,
      lastSeenAt: Number(data.lastSeenAt || Date.now()),
    };
  }

  async getUsersPresence(userIds: string[]): Promise<Map<string, UserPresence>> {
    const result = new Map<string, UserPresence>();
    if (userIds.length === 0) return result;

    const entries = await Promise.all(userIds.map((id) => this.getUserPresence(id)));
    for (const entry of entries) {
      if (entry) {
        result.set(entry.userId, entry);
      }
    }
    return result;
  }

  async getRoomUserIds(roomId: string): Promise<string[]> {
    return this.redis.smembers(this.roomKey(roomId));
  }

  async getRoomUserCount(roomId: string): Promise<number> {
    return this.redis.scard(this.roomKey(roomId));
  }

  async getRoomUserCounts(roomIds: string[]): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    if (roomIds.length === 0) return counts;

    const pipeline = this.redis.pipeline();
    for (const roomId of roomIds) {
      pipeline.scard(this.roomKey(roomId));
    }
    const results = await pipeline.exec();
    roomIds.forEach((roomId, idx) => {
      const val = results?.[idx]?.[1];
      counts[roomId] = typeof val === 'number' ? val : 0;
    });
    return counts;
  }

  async getOnlineUserCount(): Promise<number> {
    return this.redis.scard(this.onlineSetKey());
  }

  async getUserSocketIds(userId: string): Promise<string[]> {
    return this.redis.smembers(this.userSocketsKey(userId));
  }

  async close(): Promise<void> {
    // Lifecycle of the shared Redis client is managed by the caller.
  }
}

export function createPresenceService(redisClient?: Redis | null): IPresenceService {
  if (redisClient && redisClient.status === 'ready') {
    return new RedisPresenceService(redisClient);
  }
  return new MemoryPresenceService();
}
