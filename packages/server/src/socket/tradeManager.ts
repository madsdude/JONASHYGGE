import { v4 as uuidv4 } from 'uuid';
import type { ServerToClientEvents, TradeOffer, TradeState } from '@handihotel/shared';
import type { IDataStore } from '../db/store.js';
import type { IPresenceService } from '../redis/presence.js';
import { getSocketUser, type GameIO, type GameSocket, type SocialManager } from './socialManager.js';

export class TradeManager {
  private readonly trades = new Map<string, TradeState>();
  private readonly userToTrade = new Map<string, string>();

  constructor(
    private readonly io: GameIO,
    private readonly store: IDataStore,
    private readonly presence: IPresenceService,
    private readonly social: SocialManager
  ) {}

  private async emitTradeEvent<
    E extends 'trade:requested' | 'trade:updated' | 'trade:completed' | 'trade:cancelled',
  >(trade: TradeState, event: E, ...args: Parameters<ServerToClientEvents[E]>): Promise<void> {
    const participants = [trade.initiator.userId, trade.recipient.userId];
    await Promise.all(
      participants.map((uid) => this.social.emitToUser(uid, event, ...args))
    );
  }

  private cleanupTrade(trade: TradeState): void {
    this.trades.delete(trade.id);
    if (this.userToTrade.get(trade.initiator.userId) === trade.id) {
      this.userToTrade.delete(trade.initiator.userId);
    }
    if (this.userToTrade.get(trade.recipient.userId) === trade.id) {
      this.userToTrade.delete(trade.recipient.userId);
    }
  }

  private getParticipantOffer(trade: TradeState, userId: string): TradeOffer | null {
    if (trade.initiator.userId === userId) return trade.initiator;
    if (trade.recipient.userId === userId) return trade.recipient;
    return null;
  }

  async handleRequest(socket: GameSocket, payload: { targetUserId: string }): Promise<void> {
    const user = getSocketUser(socket);
    if (!user) return;

    const targetUserId = payload?.targetUserId?.trim();
    if (!targetUserId || targetUserId === user.userId) {
      socket.emit('error', { code: 'INVALID_TRADE', message: 'Cannot trade with yourself' });
      return;
    }

    if (this.userToTrade.has(user.userId)) {
      socket.emit('notification', {
        id: uuidv4(),
        type: 'warning',
        title: 'Trade Active',
        message: 'Finish or cancel your current trade first.',
      });
      return;
    }

    if (this.userToTrade.has(targetUserId)) {
      socket.emit('notification', {
        id: uuidv4(),
        type: 'warning',
        title: 'Player Busy',
        message: 'That player is already in another trade.',
      });
      return;
    }

    try {
      const [initiatorPresence, targetPresence, targetUser] = await Promise.all([
        this.presence.getUserPresence(user.userId),
        this.presence.getUserPresence(targetUserId),
        this.store.findUserById(targetUserId),
      ]);

      if (!targetUser || !targetPresence) {
        socket.emit('notification', {
          id: uuidv4(),
          type: 'warning',
          title: 'Player Offline',
          message: 'That player is currently offline.',
        });
        return;
      }

      const roomId = user.currentRoomId ?? initiatorPresence?.currentRoomId ?? targetPresence.currentRoomId;
      if (!roomId) {
        socket.emit('notification', {
          id: uuidv4(),
          type: 'warning',
          title: 'Join a Room',
          message: 'You must be in a room to start a trade.',
        });
        return;
      }

      const room = await this.store.getRoomState(roomId);
      if (room && !room.permissions.allowTrading) {
        socket.emit('notification', {
          id: uuidv4(),
          type: 'warning',
          title: 'Trading Disabled',
          message: 'Trading is disabled in this room.',
        });
        return;
      }

      const trade: TradeState = {
        id: uuidv4(),
        roomId,
        status: 'pending',
        initiator: {
          userId: user.userId,
          username: user.username,
          itemIds: [],
          credits: 0,
          accepted: false,
          confirmed: false,
        },
        recipient: {
          userId: targetUser.id,
          username: targetUser.username,
          itemIds: [],
          credits: 0,
          accepted: false,
          confirmed: false,
        },
        createdAt: new Date().toISOString(),
      };

      this.trades.set(trade.id, trade);
      this.userToTrade.set(trade.initiator.userId, trade.id);
      this.userToTrade.set(trade.recipient.userId, trade.id);

      await this.emitTradeEvent(trade, 'trade:requested', { trade });
    } catch (err) {
      console.error('[TradeManager] handleRequest error:', err);
      socket.emit('error', { code: 'TRADE_ERROR', message: 'Failed to request trade' });
    }
  }

  async handleRespond(
    socket: GameSocket,
    payload: { tradeId: string; accept: boolean }
  ): Promise<void> {
    const user = getSocketUser(socket);
    if (!user) return;

    const trade = this.trades.get(payload?.tradeId);
    if (!trade || trade.recipient.userId !== user.userId || trade.status !== 'pending') {
      return;
    }

    if (!payload.accept) {
      trade.status = 'cancelled';
      await this.emitTradeEvent(trade, 'trade:cancelled', {
        tradeId: trade.id,
        reason: `${user.username} declined the trade request.`,
      });
      this.cleanupTrade(trade);
      return;
    }

    trade.status = 'active';
    await this.emitTradeEvent(trade, 'trade:updated', { trade });
  }

  async handleUpdateOffer(
    socket: GameSocket,
    payload: { tradeId: string; itemIds: string[]; credits: number }
  ): Promise<void> {
    const user = getSocketUser(socket);
    if (!user) return;

    const trade = this.trades.get(payload?.tradeId);
    if (!trade || (trade.status !== 'active' && trade.status !== 'confirming')) {
      return;
    }

    const offer = this.getParticipantOffer(trade, user.userId);
    if (!offer) return;

    try {
      const [storedUser, inventory] = await Promise.all([
        this.store.findUserById(user.userId),
        this.store.getInventory(user.userId),
      ]);

      if (!storedUser) return;

      const ownedIds = new Set(
        inventory.filter((item) => !item.placedInRoomId).map((item) => item.id)
      );
      const uniqueItems = Array.from(
        new Set((Array.isArray(payload.itemIds) ? payload.itemIds : []).filter((id) => ownedIds.has(id)))
      ).slice(0, 20);

      const requestedCredits = Math.max(0, Math.floor(Number(payload.credits) || 0));
      const clampedCredits = Math.min(requestedCredits, storedUser.credits);

      offer.itemIds = uniqueItems;
      offer.credits = clampedCredits;

      // Modifying either offer resets both players' acceptance & confirmation for safety
      trade.initiator.accepted = false;
      trade.initiator.confirmed = false;
      trade.recipient.accepted = false;
      trade.recipient.confirmed = false;
      trade.status = 'active';

      await this.emitTradeEvent(trade, 'trade:updated', { trade });
    } catch (err) {
      console.error('[TradeManager] handleUpdateOffer error:', err);
      socket.emit('error', { code: 'TRADE_UPDATE_ERROR', message: 'Failed to update trade offer' });
    }
  }

  async handleAccept(
    socket: GameSocket,
    payload: { tradeId: string; accepted: boolean }
  ): Promise<void> {
    const user = getSocketUser(socket);
    if (!user) return;

    const trade = this.trades.get(payload?.tradeId);
    if (!trade || (trade.status !== 'active' && trade.status !== 'confirming')) {
      return;
    }

    const offer = this.getParticipantOffer(trade, user.userId);
    if (!offer) return;

    offer.accepted = Boolean(payload.accepted);
    if (!offer.accepted) {
      trade.initiator.confirmed = false;
      trade.recipient.confirmed = false;
      trade.status = 'active';
    } else if (trade.initiator.accepted && trade.recipient.accepted) {
      trade.status = 'confirming';
    }

    await this.emitTradeEvent(trade, 'trade:updated', { trade });
  }

  async handleConfirm(socket: GameSocket, payload: { tradeId: string }): Promise<void> {
    const user = getSocketUser(socket);
    if (!user) return;

    const trade = this.trades.get(payload?.tradeId);
    if (!trade || (trade.status !== 'active' && trade.status !== 'confirming')) {
      return;
    }

    const offer = this.getParticipantOffer(trade, user.userId);
    if (!offer) return;

    offer.accepted = true;
    offer.confirmed = true;

    if (trade.initiator.confirmed && trade.recipient.confirmed) {
      await this.completeTrade(trade);
      return;
    }

    if (trade.initiator.accepted && trade.recipient.accepted) {
      trade.status = 'confirming';
    }

    await this.emitTradeEvent(trade, 'trade:updated', { trade });
  }

  private async completeTrade(trade: TradeState): Promise<void> {
    try {
      const result = await this.store.executeTrade({
        userAId: trade.initiator.userId,
        userBId: trade.recipient.userId,
        userAItemIds: trade.initiator.itemIds,
        userBItemIds: trade.recipient.itemIds,
        userACredits: trade.initiator.credits,
        userBCredits: trade.recipient.credits,
      });

      trade.status = 'completed';

      const summary = `${trade.initiator.username} (${trade.initiator.itemIds.length} items, ${trade.initiator.credits}c) ↔ ${trade.recipient.username} (${trade.recipient.itemIds.length} items, ${trade.recipient.credits}c)`;

      await this.emitTradeEvent(trade, 'trade:completed', {
        tradeId: trade.id,
        summary,
      });

      const [userA, userB] = await Promise.all([
        this.store.findUserById(trade.initiator.userId),
        this.store.findUserById(trade.recipient.userId),
      ]);

      if (userA) {
        await this.social.emitToUser(userA.id, 'economy:updated', {
          credits: result.userACredits,
          stars: userA.stars,
          reason: 'Trade completed',
        });
      }
      if (userB) {
        await this.social.emitToUser(userB.id, 'economy:updated', {
          credits: result.userBCredits,
          stars: userB.stars,
          reason: 'Trade completed',
        });
      }

      this.cleanupTrade(trade);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Trade execution failed';
      trade.status = 'cancelled';
      await this.emitTradeEvent(trade, 'trade:cancelled', {
        tradeId: trade.id,
        reason: `Trade failed: ${message}`,
      });
      this.cleanupTrade(trade);
    }
  }

  async handleCancel(socket: GameSocket, payload: { tradeId: string }): Promise<void> {
    const user = getSocketUser(socket);
    if (!user) return;

    const trade = this.trades.get(payload?.tradeId);
    if (!trade) return;
    if (trade.initiator.userId !== user.userId && trade.recipient.userId !== user.userId) {
      return;
    }

    trade.status = 'cancelled';
    await this.emitTradeEvent(trade, 'trade:cancelled', {
      tradeId: trade.id,
      reason: `${user.username} cancelled the trade.`,
    });
    this.cleanupTrade(trade);
  }

  async handleDisconnect(userId: string): Promise<void> {
    const tradeId = this.userToTrade.get(userId);
    if (!tradeId) return;

    const trade = this.trades.get(tradeId);
    if (!trade) {
      this.userToTrade.delete(userId);
      return;
    }

    trade.status = 'cancelled';
    await this.emitTradeEvent(trade, 'trade:cancelled', {
      tradeId: trade.id,
      reason: 'Trade cancelled because a participant disconnected.',
    });
    this.cleanupTrade(trade);
  }
}
