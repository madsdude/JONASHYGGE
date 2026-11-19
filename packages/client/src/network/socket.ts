import { io, type Socket } from 'socket.io-client';
import type {
  AvatarConfig,
  ChatMode,
  ClientToServerEvents,
  Direction8,
  EmoteType,
  MinigameActionPayload,
  MinigameType,
  PlacedFurniture,
  PlayerInRoom,
  RoomSettingsPatch,
  RoomState,
  Rotation4,
  ServerToClientEvents,
  TileCoord,
} from '@handihotel/shared';
import { audioManager } from '../audio/AudioManager';
import { useGameStore } from '../state/useGameStore';

type GameSocketClient = Socket<ServerToClientEvents, ClientToServerEvents>;

export type AvatarPathListener = (payload: {
  userId: string;
  path: TileCoord[];
  direction: Direction8;
}) => void;

export type FurniEffectListener = (payload: {
  furniture: PlacedFurniture;
  effect?: string;
}) => void;

const SOCKET_URL =
  (typeof import.meta !== 'undefined' &&
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_SOCKET_URL) ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000');

class GameSocketManager {
  private socket: GameSocketClient | null = null;
  private currentToken: string | null = null;
  private lastCountdownSecond: number | null = null;
  private pathListeners = new Set<AvatarPathListener>();
  private furniEffectListeners = new Set<FurniEffectListener>();

  public isConnected(): boolean {
    return Boolean(this.socket?.connected);
  }

  public connect(token: string): void {
    if (this.socket && this.currentToken === token) {
      if (!this.socket.connected) {
        this.socket.connect();
      }
      return;
    }

    this.disconnect();
    this.currentToken = token;

    const socket: GameSocketClient = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      autoConnect: true,
    });

    this.socket = socket;
    this.bindListeners(socket);
  }

  public disconnect(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.currentToken = null;
    this.lastCountdownSecond = null;
  }

  public onAvatarPath(listener: AvatarPathListener): () => void {
    this.pathListeners.add(listener);
    return () => {
      this.pathListeners.delete(listener);
    };
  }

  public onFurniEffect(listener: FurniEffectListener): () => void {
    this.furniEffectListeners.add(listener);
    return () => {
      this.furniEffectListeners.delete(listener);
    };
  }

  private bindListeners(socket: GameSocketClient): void {
    socket.on('connect', () => {
      const store = useGameStore.getState();
      // Re-join current room on automatic reconnect
      if (store.currentRoom) {
        this.joinRoom(store.currentRoom.id);
      }
    });

    socket.on('connect_error', (err) => {
      useGameStore.getState().addNotification({
        type: 'warning',
        title: 'Connection Issue',
        message: err.message || 'Reconnecting to HandiHotel...',
      });
    });

    // -------------------------------------------------------------------------
    // Room Lifecycle
    // -------------------------------------------------------------------------
    socket.on('room:state', ({ room, players, chatHistory }) => {
      useGameStore.getState().setCurrentRoom(room, players, chatHistory);
      audioManager.playDoorChime();
      audioManager.startAmbience(room.theme);
    });

    socket.on('room:userJoined', ({ player }) => {
      useGameStore.getState().upsertPlayer(player);
    });

    socket.on('room:userLeft', ({ userId }) => {
      useGameStore.getState().removePlayer(userId);
    });

    socket.on('room:settingsUpdated', ({ room }) => {
      useGameStore.getState().updateRoom(room);
      audioManager.startAmbience(room.theme);
    });

    socket.on('room:liked', ({ roomId, likes }) => {
      useGameStore.getState().updateRoomLikes(roomId, likes);
    });

    socket.on('room:kicked', ({ reason }) => {
      const store = useGameStore.getState();
      store.addNotification({
        type: 'warning',
        title: 'Removed from Room',
        message: reason || 'You were removed from the room.',
      });
      audioManager.playNotification();
      this.joinRoom('public-lobby');
    });

    // -------------------------------------------------------------------------
    // Movement & Avatar
    // -------------------------------------------------------------------------
    socket.on('avatar:path', (payload) => {
      for (const listener of this.pathListeners) {
        try {
          listener(payload);
        } catch {
          // Isolate listener errors
        }
      }
    });

    socket.on('avatar:moved', ({ userId, x, y, z, direction, sitting, sittingFurniId }) => {
      useGameStore.getState().updatePlayerPosition(userId, {
        x,
        y,
        z,
        direction,
        sitting,
        sittingFurniId,
      });
    });

    socket.on('avatar:emoted', ({ userId, emote }) => {
      useGameStore.getState().updatePlayerEmote(userId, emote);
      if (emote) {
        audioManager.playEmote(emote);
      }
    });

    socket.on('avatar:updated', ({ userId, avatar, motto }) => {
      useGameStore.getState().updatePlayerAvatar(userId, avatar, motto);
    });

    // -------------------------------------------------------------------------
    // Chat
    // -------------------------------------------------------------------------
    socket.on('chat:message', (message) => {
      useGameStore.getState().addChatMessage(message);
      if (message.mode !== 'system') {
        audioManager.playChatPop();
      }
    });

    // -------------------------------------------------------------------------
    // Furniture
    // -------------------------------------------------------------------------
    socket.on('furni:placed', ({ furniture }) => {
      useGameStore.getState().upsertFurniture(furniture);
      audioManager.playFurniturePlace();
    });

    socket.on('furni:moved', ({ furniture }) => {
      useGameStore.getState().upsertFurniture(furniture);
      audioManager.playFurnitureRotate();
    });

    socket.on('furni:removed', ({ furniId }) => {
      useGameStore.getState().removeFurniture(furniId);
      audioManager.playFurniturePickup();
    });

    socket.on('furni:updated', (payload) => {
      useGameStore.getState().upsertFurniture(payload.furniture);
      if (payload.effect === 'elevator') {
        audioManager.playElevatorDing();
      } else if (payload.effect === 'boost') {
        audioManager.playBoost();
      }
      for (const listener of this.furniEffectListeners) {
        try {
          listener(payload);
        } catch {
          // Isolate listener errors
        }
      }
    });

    // -------------------------------------------------------------------------
    // Trading
    // -------------------------------------------------------------------------
    socket.on('trade:requested', ({ trade }) => {
      const store = useGameStore.getState();
      const myId = store.user?.id;
      if (trade.recipient.userId === myId && trade.status === 'pending') {
        store.setIncomingTradeRequest({
          tradeId: trade.id,
          fromUserId: trade.initiator.userId,
          fromUsername: trade.initiator.username,
        });
        audioManager.playNotification();
      } else {
        store.setActiveTrade(trade);
      }
    });

    socket.on('trade:updated', ({ trade }) => {
      const store = useGameStore.getState();
      if (store.incomingTradeRequest?.tradeId === trade.id && trade.status !== 'pending') {
        store.setIncomingTradeRequest(null);
      }
      store.setActiveTrade(trade);
    });

    socket.on('trade:completed', ({ summary }) => {
      const store = useGameStore.getState();
      store.setActiveTrade(null);
      store.setIncomingTradeRequest(null);
      store.addNotification({
        type: 'success',
        title: 'Trade Completed!',
        message: summary || 'Your trade was completed successfully.',
      });
      audioManager.playCoin();
    });

    socket.on('trade:cancelled', ({ reason }) => {
      const store = useGameStore.getState();
      store.setActiveTrade(null);
      store.setIncomingTradeRequest(null);
      store.addNotification({
        type: 'info',
        title: 'Trade Cancelled',
        message: reason || 'The trade was cancelled.',
      });
    });

    // -------------------------------------------------------------------------
    // Social
    // -------------------------------------------------------------------------
    socket.on('social:dmReceived', (message) => {
      const store = useGameStore.getState();
      store.addDirectMessage(message);
      if (message.fromUserId !== store.user?.id) {
        audioManager.playNotification();
        if (store.activeModal !== 'social' || store.activeDmUserId !== message.fromUserId) {
          store.addNotification({
            type: 'info',
            title: `DM from ${message.fromUsername}`,
            message: message.text.slice(0, 80),
          });
        }
      }
    });

    socket.on('social:inviteReceived', (invite) => {
      const store = useGameStore.getState();
      store.addPendingInvite(invite);
      audioManager.playNotification();
    });

    socket.on('social:friendRequestReceived', (request) => {
      const store = useGameStore.getState();
      store.addFriendRequest(request);
      store.addNotification({
        type: 'info',
        title: 'Friend Request',
        message: `${request.fromUsername} wants to be your friend!`,
      });
      audioManager.playNotification();
    });

    socket.on('social:friendStatusChanged', ({ userId, onlineStatus, currentRoomId, currentRoomName }) => {
      useGameStore
        .getState()
        .updateFriendStatus(userId, onlineStatus, currentRoomId, currentRoomName);
    });

    // -------------------------------------------------------------------------
    // Minigames & Events
    // -------------------------------------------------------------------------
    socket.on('minigame:state', (session) => {
      const store = useGameStore.getState();
      const prev = store.activeMinigame;
      store.setActiveMinigame(session);

      if (session.status === 'countdown') {
        if (this.lastCountdownSecond !== session.countdownSeconds) {
          this.lastCountdownSecond = session.countdownSeconds;
          audioManager.playCountdownTick(false);
        }
      } else if (session.status === 'playing' && prev?.status === 'countdown') {
        this.lastCountdownSecond = null;
        audioManager.playCountdownTick(true);
      }
    });

    socket.on('minigame:ended', ({ session, winnerUsername, rewards }) => {
      const store = useGameStore.getState();
      store.setActiveMinigame(session);
      this.lastCountdownSecond = null;
      audioManager.playVictory();

      const myId = store.user?.id;
      const myReward = myId ? rewards[myId] : undefined;
      const rewardText =
        myReward && (myReward.credits > 0 || myReward.stars > 0)
          ? ` You earned +${myReward.credits} Credits & +${myReward.stars} Stars!`
          : '';

      store.addNotification({
        type: 'success',
        title: winnerUsername ? `${winnerUsername} Won!` : 'Minigame Finished!',
        message: `Match complete.${rewardText}`,
      });
    });

    socket.on('event:updated', (events) => {
      useGameStore.getState().setHotelEvents(events);
    });

    // -------------------------------------------------------------------------
    // System & Economy
    // -------------------------------------------------------------------------
    socket.on('economy:updated', ({ credits, stars, reason }) => {
      const store = useGameStore.getState();
      store.updateBalance(credits, stars);
      audioManager.playCoin();
      if (reason) {
        store.addNotification({
          type: 'success',
          title: 'Balance Updated',
          message: reason,
        });
      }
    });

    socket.on('notification', (payload) => {
      useGameStore.getState().addNotification(payload);
      audioManager.playNotification();
    });

    socket.on('error', ({ message }) => {
      useGameStore.getState().addNotification({
        type: 'error',
        title: 'Hotel Notice',
        message: message || 'Something went wrong.',
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Typed Emit Methods
  // ---------------------------------------------------------------------------
  public joinRoom(
    roomId: string,
    password?: string
  ): Promise<{ ok: boolean; error?: string; room?: RoomState; players?: PlayerInRoom[] }> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve({ ok: false, error: 'Not connected to server' });
        return;
      }
      useGameStore.getState().setTransitioningRoom(true);
      this.socket.emit('room:join', { roomId, password }, (res) => {
        if (!res?.ok) {
          useGameStore.getState().setTransitioningRoom(false);
          if (res?.error) {
            useGameStore.getState().addNotification({
              type: 'error',
              title: 'Could Not Enter Room',
              message: res.error,
            });
          }
        }
        resolve(res ?? { ok: false, error: 'No response from server' });
      });
    });
  }

  public leaveRoom(roomId: string): void {
    this.socket?.emit('room:leave', { roomId });
  }

  public likeRoom(roomId: string): void {
    this.socket?.emit('room:like', { roomId });
  }

  public kickUser(roomId: string, targetUserId: string): void {
    this.socket?.emit('room:kick', { roomId, targetUserId });
  }

  public moveTo(x: number, y: number): void {
    this.socket?.emit('avatar:move', { x, y });
  }

  public sitOn(payload: { furniId?: string; x?: number; y?: number }): void {
    this.socket?.emit('avatar:sit', payload);
  }

  public standUp(): void {
    this.socket?.emit('avatar:stand');
  }

  public sendEmote(emote: EmoteType): void {
    this.socket?.emit('avatar:emote', { emote });
  }

  public broadcastAvatarUpdate(avatar: AvatarConfig, motto?: string): void {
    this.socket?.emit('avatar:update', { avatar, motto });
  }

  public sendChat(text: string, mode: ChatMode = 'normal', targetUsername?: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.socket?.emit('chat:send', { text: trimmed, mode, targetUsername });
  }

  public placeFurniture(
    inventoryItemId: string,
    x: number,
    y: number,
    rotation: Rotation4 = 0
  ): Promise<{ ok: boolean; error?: string; furniture?: PlacedFurniture }> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve({ ok: false, error: 'Not connected' });
        return;
      }
      this.socket.emit('furni:place', { inventoryItemId, x, y, rotation }, (res) => {
        if (!res?.ok && res?.error) {
          useGameStore.getState().addNotification({
            type: 'warning',
            title: 'Cannot Place Furniture',
            message: res.error,
          });
        }
        resolve(res ?? { ok: false, error: 'No response' });
      });
    });
  }

  public moveFurniture(
    furniId: string,
    x: number,
    y: number,
    rotation?: Rotation4
  ): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve({ ok: false, error: 'Not connected' });
        return;
      }
      this.socket.emit('furni:move', { furniId, x, y, rotation }, (res) => {
        if (!res?.ok && res?.error) {
          useGameStore.getState().addNotification({
            type: 'warning',
            title: 'Cannot Move Furniture',
            message: res.error,
          });
        }
        resolve(res ?? { ok: false, error: 'No response' });
      });
    });
  }

  public rotateFurniture(
    furniId: string,
    rotation?: Rotation4
  ): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve({ ok: false, error: 'Not connected' });
        return;
      }
      this.socket.emit('furni:rotate', { furniId, rotation }, (res) => {
        resolve(res ?? { ok: false, error: 'No response' });
      });
    });
  }

  public pickupFurniture(furniId: string): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve({ ok: false, error: 'Not connected' });
        return;
      }
      this.socket.emit('furni:pickup', { furniId }, (res) => {
        resolve(res ?? { ok: false, error: 'No response' });
      });
    });
  }

  public interactFurniture(furniId: string): void {
    this.socket?.emit('furni:interact', { furniId });
  }

  public updateRoomSettings(
    roomId: string,
    patch: RoomSettingsPatch
  ): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve({ ok: false, error: 'Not connected' });
        return;
      }
      this.socket.emit('room:updateSettings', { roomId, patch }, (res) => {
        resolve(res ?? { ok: false, error: 'No response' });
      });
    });
  }

  public requestTrade(targetUserId: string): void {
    this.socket?.emit('trade:request', { targetUserId });
  }

  public respondTrade(tradeId: string, accept: boolean): void {
    this.socket?.emit('trade:respond', { tradeId, accept });
    useGameStore.getState().setIncomingTradeRequest(null);
  }

  public updateTradeOffer(tradeId: string, itemIds: string[], credits: number): void {
    this.socket?.emit('trade:updateOffer', { tradeId, itemIds, credits });
  }

  public acceptTrade(tradeId: string, accepted: boolean): void {
    this.socket?.emit('trade:accept', { tradeId, accepted });
  }

  public confirmTrade(tradeId: string): void {
    this.socket?.emit('trade:confirm', { tradeId });
  }

  public cancelTrade(tradeId: string): void {
    this.socket?.emit('trade:cancel', { tradeId });
  }

  public sendDm(toUserId: string, text: string): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve({ ok: false, error: 'Not connected' });
        return;
      }
      this.socket.emit('social:dm', { toUserId, text }, (res) => {
        if (res?.ok && res.message) {
          useGameStore.getState().addDirectMessage(res.message);
        }
        resolve({ ok: Boolean(res?.ok), error: res?.error });
      });
    });
  }

  public sendRoomInvite(toUserId: string, roomId: string, message?: string): void {
    this.socket?.emit('social:invite', { toUserId, roomId, message });
  }

  public joinMinigame(roomId: string, type: MinigameType): void {
    this.socket?.emit('minigame:join', { roomId, type });
  }

  public leaveMinigame(sessionId: string): void {
    this.socket?.emit('minigame:leave', { sessionId });
    useGameStore.getState().setActiveMinigame(null);
  }

  public setMinigameReady(sessionId: string, ready: boolean): void {
    this.socket?.emit('minigame:ready', { sessionId, ready });
  }

  public startMinigame(sessionId: string): void {
    this.socket?.emit('minigame:start', { sessionId });
  }

  public minigameAction(payload: MinigameActionPayload): void {
    if (payload.action === 'boost') {
      audioManager.playBoost();
    }
    this.socket?.emit('minigame:action', payload);
  }
}

export const gameSocket = new GameSocketManager();
export default gameSocket;
