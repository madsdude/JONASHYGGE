import { Router, type Response } from 'express';
import { z } from 'zod';
import type { IDataStore } from '../db/store.js';
import { toPublicUserProfile } from '../db/store.js';
import type { IPresenceService } from '../redis/presence.js';
import {
  requireAuth,
  sanitizeChatText,
  sanitizePlainText,
  validateBody,
  type AuthenticatedRequest,
} from '../security/auth.js';

const friendRequestSchema = z
  .object({
    targetUserId: z.string().min(1).optional(),
    targetUsername: z.string().min(1).optional(),
  })
  .refine((d) => Boolean(d.targetUserId || d.targetUsername), {
    message: 'targetUserId or targetUsername is required',
  });

const respondRequestSchema = z.object({
  accept: z.boolean(),
});

const blockSchema = z.object({
  targetUserId: z.string().min(1),
});

const sendMessageSchema = z.object({
  toUserId: z.string().min(1),
  text: z.string().trim().min(1).max(300),
});

const sendDmBodySchema = z.object({
  text: z.string().trim().min(1).max(300),
});

const reportSchema = z.object({
  targetUserId: z.string().optional(),
  targetUsername: z.string().optional(),
  roomId: z.string().optional(),
  reason: z.enum([
    'harassment',
    'spam',
    'inappropriate_content',
    'cheating',
    'scamming',
    'other',
  ]),
  details: z.string().trim().min(3).max(500),
});

export function createSocialRouter(
  store: IDataStore,
  presence: IPresenceService
): Router {
  const router = Router();

  router.get('/friends', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const friends = await store.getFriends(req.authUser!.userId);
      const presenceMap = await presence.getUsersPresence(friends.map((f) => f.userId));
      const enriched = friends.map((f) => {
        const p = presenceMap.get(f.userId);
        return p
          ? {
              ...f,
              onlineStatus: p.onlineStatus,
              currentRoomId: p.currentRoomId,
              currentRoomName: p.currentRoomName,
            }
          : {
              ...f,
              onlineStatus: 'offline' as const,
              currentRoomId: null,
              currentRoomName: null,
            };
      });
      res.json({ friends: enriched });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load friends';
      res.status(500).json({ error: message });
    }
  });

  const handleGetRequests = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const requests = await store.getFriendRequests(req.authUser!.userId);
      res.json({
        requests: requests.incoming,
        incoming: requests.incoming,
        outgoing: requests.outgoing,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load friend requests';
      res.status(500).json({ error: message });
    }
  };

  router.get('/requests', requireAuth, handleGetRequests);
  router.get('/friends/requests', requireAuth, handleGetRequests);

  router.post(
    '/friends/request',
    requireAuth,
    validateBody(friendRequestSchema),
    async (req: AuthenticatedRequest, res) => {
      try {
        const { targetUserId, targetUsername } = req.body as z.infer<
          typeof friendRequestSchema
        >;
        let resolvedTargetId = targetUserId;
        if (!resolvedTargetId && targetUsername) {
          const target = await store.findUserByUsername(targetUsername);
          if (!target) {
            res.status(404).json({ error: 'User not found' });
            return;
          }
          resolvedTargetId = target.id;
        }

        const request = await store.sendFriendRequest(
          req.authUser!.userId,
          resolvedTargetId!
        );
        res.status(201).json({ request });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to send friend request';
        res.status(400).json({ error: message });
      }
    }
  );

  const handleRespondRequest = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { accept } = req.body as z.infer<typeof respondRequestSchema>;
      const result = await store.respondFriendRequest(
        String(req.params.requestId),
        req.authUser!.userId,
        accept
      );
      if (!result.request) {
        res.status(404).json({ error: 'Friend request not found' });
        return;
      }
      res.json({ ok: true, ...result });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to respond to friend request';
      res.status(400).json({ error: message });
    }
  };

  router.post(
    '/friends/requests/:requestId',
    requireAuth,
    validateBody(respondRequestSchema),
    handleRespondRequest
  );
  router.post(
    '/friends/requests/:requestId/respond',
    requireAuth,
    validateBody(respondRequestSchema),
    handleRespondRequest
  );

  router.delete(
    '/friends/:friendUserId',
    requireAuth,
    async (req: AuthenticatedRequest, res) => {
      try {
        const removed = await store.removeFriend(
          req.authUser!.userId,
          String(req.params.friendUserId)
        );
        res.json({ ok: true, removed });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to remove friend';
        res.status(400).json({ error: message });
      }
    }
  );

  router.get('/blocked', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const blockedIds = await store.getBlockedIds(req.authUser!.userId);
      res.json({ blockedIds });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load blocked users';
      res.status(500).json({ error: message });
    }
  });

  router.post(
    '/block',
    requireAuth,
    validateBody(blockSchema),
    async (req: AuthenticatedRequest, res) => {
      try {
        const { targetUserId } = req.body as z.infer<typeof blockSchema>;
        await store.blockUser(req.authUser!.userId, targetUserId);
        res.json({ ok: true, blocked: true, targetUserId });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to block user';
        res.status(400).json({ error: message });
      }
    }
  );

  router.delete(
    '/block/:targetUserId',
    requireAuth,
    async (req: AuthenticatedRequest, res) => {
      try {
        const targetUserId = String(req.params.targetUserId);
        await store.unblockUser(req.authUser!.userId, targetUserId);
        res.json({ ok: true, unblocked: true, targetUserId });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to unblock user';
        res.status(400).json({ error: message });
      }
    }
  );

  const handleGetDms = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const limitRaw = Number(req.query.limit ?? 50);
      const limit = Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(100, Math.floor(limitRaw)))
        : 50;
      const messages = await store.getDirectMessages(
        req.authUser!.userId,
        String(req.params.peerUserId),
        limit
      );
      res.json({ messages });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load messages';
      res.status(500).json({ error: message });
    }
  };

  router.get('/messages/:peerUserId', requireAuth, handleGetDms);
  router.get('/dms/:peerUserId', requireAuth, handleGetDms);

  router.post(
    '/messages',
    requireAuth,
    validateBody(sendMessageSchema),
    async (req: AuthenticatedRequest, res) => {
      try {
        const { toUserId, text } = req.body as z.infer<typeof sendMessageSchema>;
        const blockedByTarget = await store.getBlockedIds(toUserId);
        if (blockedByTarget.includes(req.authUser!.userId)) {
          res.status(403).json({ error: 'You cannot message this user' });
          return;
        }
        const cleanText = sanitizeChatText(text, 300);
        const message = await store.saveDirectMessage(
          req.authUser!.userId,
          toUserId,
          cleanText
        );
        res.status(201).json({ message });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to send message';
        res.status(400).json({ error: message });
      }
    }
  );

  router.post(
    '/dms/:toUserId',
    requireAuth,
    validateBody(sendDmBodySchema),
    async (req: AuthenticatedRequest, res) => {
      try {
        const toUserId = String(req.params.toUserId);
        const { text } = req.body as z.infer<typeof sendDmBodySchema>;
        const blockedByTarget = await store.getBlockedIds(toUserId);
        if (blockedByTarget.includes(req.authUser!.userId)) {
          res.status(403).json({ error: 'You cannot message this user' });
          return;
        }
        const cleanText = sanitizeChatText(text, 300);
        const message = await store.saveDirectMessage(
          req.authUser!.userId,
          toUserId,
          cleanText
        );
        res.status(201).json({ message });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to send message';
        res.status(400).json({ error: message });
      }
    }
  );

  router.get('/profile/:userId', requireAuth, async (req, res) => {
    try {
      const user = await store.findUserById(String(req.params.userId));
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      const profile = toPublicUserProfile(user);
      const livePresence = await presence.getUserPresence(user.id);
      if (livePresence) {
        profile.onlineStatus = livePresence.onlineStatus;
        profile.currentRoomId = livePresence.currentRoomId;
        profile.currentRoomName = livePresence.currentRoomName;
      }
      res.json({ profile });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load profile';
      res.status(500).json({ error: message });
    }
  });

  router.get('/search', requireAuth, async (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const users = await store.searchUsers(q, 25);
      const presenceMap = await presence.getUsersPresence(users.map((u) => u.id));
      const enriched = users.map((u) => {
        const p = presenceMap.get(u.id);
        return p
          ? {
              ...u,
              onlineStatus: p.onlineStatus,
              currentRoomId: p.currentRoomId,
              currentRoomName: p.currentRoomName,
            }
          : u;
      });
      res.json({ users: enriched });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Search failed';
      res.status(500).json({ error: message });
    }
  });

  const handleReport = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const body = req.body as z.infer<typeof reportSchema>;
      const report = await store.createReport(req.authUser!.userId, {
        ...body,
        details: sanitizePlainText(body.details, 500),
      });
      res.status(201).json({ ok: true, report });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to submit report';
      res.status(400).json({ error: message });
    }
  };

  router.post('/report', requireAuth, validateBody(reportSchema), handleReport);
  router.post('/reports', requireAuth, validateBody(reportSchema), handleReport);

  return router;
}
