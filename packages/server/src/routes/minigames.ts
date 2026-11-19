import { Router } from 'express';
import { z } from 'zod';
import type { LeaderboardEntry, MinigameType } from '@handihotel/shared';
import type { IDataStore } from '../db/store.js';
import {
  requireAuth,
  sanitizePlainText,
  validateBody,
  type AuthenticatedRequest,
} from '../security/auth.js';

const VALID_GAME_TYPES: readonly MinigameType[] = [
  'wheelchair_racing',
  'hotel_olympics',
  'dance_battle',
  'furniture_chaos',
];

const recordScoreSchema = z.object({
  gameType: z.enum([
    'wheelchair_racing',
    'hotel_olympics',
    'dance_battle',
    'furniture_chaos',
  ]),
  score: z.number().int().min(0).max(1_000_000),
  won: z.boolean().optional(),
  timeMs: z.number().int().min(0).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const upsertEventSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(3).max(80),
  description: z.string().trim().min(3).max(400),
  roomId: z.string().min(1),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  rewardCredits: z.number().int().min(0).max(10_000).default(250),
  rewardStars: z.number().int().min(0).max(1_000).optional(),
  minigameType: z
    .enum(['wheelchair_racing', 'hotel_olympics', 'dance_battle', 'furniture_chaos'])
    .optional(),
});

export function createMinigamesRouter(store: IDataStore): Router {
  const router = Router();

  router.get('/leaderboards', async (req, res) => {
    try {
      const limitRaw = Number(req.query.limit ?? 20);
      const limit = Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(50, Math.floor(limitRaw)))
        : 20;

      const rawType = typeof req.query.type === 'string' ? req.query.type.trim() : '';
      if (rawType) {
        if (!VALID_GAME_TYPES.includes(rawType as MinigameType)) {
          res.status(400).json({ error: 'Invalid minigame type' });
          return;
        }
        const entries = await store.getLeaderboard(rawType as MinigameType, limit);
        res.json({ gameType: rawType, entries });
        return;
      }

      const lists = await Promise.all(
        VALID_GAME_TYPES.map((t) => store.getLeaderboard(t, limit))
      );
      const entries: LeaderboardEntry[] = lists.flat();
      res.json({ entries });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load leaderboards';
      res.status(500).json({ error: message });
    }
  });

  router.get('/leaderboard/:gameType', async (req, res) => {
    try {
      const gameType = req.params.gameType as MinigameType;
      if (!VALID_GAME_TYPES.includes(gameType)) {
        res.status(400).json({ error: 'Invalid minigame type' });
        return;
      }

      const limitRaw = Number(req.query.limit ?? 20);
      const limit = Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(50, Math.floor(limitRaw)))
        : 20;

      const entries = await store.getLeaderboard(gameType, limit);
      res.json({ gameType, entries });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load leaderboard';
      res.status(500).json({ error: message });
    }
  });

  router.post(
    '/scores',
    requireAuth,
    validateBody(recordScoreSchema),
    async (req: AuthenticatedRequest, res) => {
      try {
        const body = req.body as z.infer<typeof recordScoreSchema>;
        const result = await store.recordMinigameScore({
          userId: req.authUser!.userId,
          gameType: body.gameType,
          score: body.score,
          won: body.won,
          timeMs: body.timeMs,
          metadata: body.metadata,
        });
        res.status(201).json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to record score';
        res.status(400).json({ error: message });
      }
    }
  );

  router.get('/events', async (_req, res) => {
    try {
      const events = await store.getActiveEvents();
      res.json({ events });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load hotel events';
      res.status(500).json({ error: message });
    }
  });

  router.post(
    '/events',
    requireAuth,
    validateBody(upsertEventSchema),
    async (req: AuthenticatedRequest, res) => {
      try {
        const body = req.body as z.infer<typeof upsertEventSchema>;
        const event = await store.upsertHotelEvent({
          id: body.id,
          title: sanitizePlainText(body.title, 80),
          description: sanitizePlainText(body.description, 400),
          roomId: body.roomId,
          hostUsername: req.authUser!.username,
          startsAt: body.startsAt,
          endsAt: body.endsAt,
          rewardCredits: body.rewardCredits,
          rewardStars: body.rewardStars,
          minigameType: body.minigameType,
        });
        res.status(201).json({ event });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to save event';
        res.status(400).json({ error: message });
      }
    }
  );

  return router;
}
