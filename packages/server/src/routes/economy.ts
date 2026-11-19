import { Router, type Response } from 'express';
import { z } from 'zod';
import { CATALOG_ITEMS } from '@handihotel/shared';
import type { IDataStore } from '../db/store.js';
import { toPublicUserProfile } from '../db/store.js';
import {
  requireAuth,
  validateBody,
  type AuthenticatedRequest,
} from '../security/auth.js';

const purchaseSchema = z.object({
  catalogItemId: z.string().min(1),
  quantity: z.number().int().min(1).max(20).optional().default(1),
});

export function createEconomyRouter(store: IDataStore): Router {
  const router = Router();

  router.get('/catalog', (req, res) => {
    const category =
      typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const items = category
      ? CATALOG_ITEMS.filter((item) => item.category === category)
      : CATALOG_ITEMS;
    res.json({ items });
  });

  router.get('/inventory', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const items = await store.getInventory(req.authUser!.userId);
      res.json({ items });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load inventory';
      res.status(500).json({ error: message });
    }
  });

  const handlePurchase = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { catalogItemId, quantity } = req.body as z.infer<typeof purchaseSchema>;
      const result = await store.purchaseCatalogItem(
        req.authUser!.userId,
        catalogItemId,
        quantity
      );
      const updatedUser = await store.findUserById(req.authUser!.userId);
      res.status(201).json({
        ...result,
        item: result.items[0],
        user: updatedUser ? toPublicUserProfile(updatedUser) : undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Purchase failed';
      const status =
        message.includes('Insufficient') || message.includes('not found') ? 400 : 500;
      res.status(status).json({ error: message });
    }
  };

  router.post('/purchase', requireAuth, validateBody(purchaseSchema), handlePurchase);
  router.post('/buy', requireAuth, validateBody(purchaseSchema), handlePurchase);

  router.get('/daily-reward', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const status = await store.getDailyRewardStatus(req.authUser!.userId);
      res.json({ ...status, status });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to check daily reward';
      res.status(500).json({ error: message });
    }
  });

  router.post(
    '/daily-reward/claim',
    requireAuth,
    async (req: AuthenticatedRequest, res) => {
      try {
        const result = await store.claimDailyReward(req.authUser!.userId);
        res.json({
          ...result,
          rewardCredits: result.creditsAwarded,
          rewardStars: result.starsAwarded,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to claim daily reward';
        res.status(400).json({ error: message });
      }
    }
  );

  router.get('/transactions', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const limitRaw = Number(req.query.limit ?? 50);
      const limit = Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(100, Math.floor(limitRaw)))
        : 50;
      const transactions = await store.getTransactions(req.authUser!.userId, limit);
      res.json({ transactions });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load transactions';
      res.status(500).json({ error: message });
    }
  });

  return router;
}
