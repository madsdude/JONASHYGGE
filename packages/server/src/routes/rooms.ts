import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ROOM_TEMPLATES, type RoomSummary } from '@handihotel/shared';
import type { IDataStore } from '../db/store.js';
import type { IPresenceService } from '../redis/presence.js';
import {
  optionalAuth,
  requireAuth,
  sanitizePlainText,
  validateBody,
  type AuthenticatedRequest,
} from '../security/auth.js';

const floorStyleEnum = z.enum([
  'wood_oak',
  'wood_dark',
  'marble_white',
  'marble_gold',
  'checkerboard',
  'carpet_red',
  'carpet_blue',
  'tile_pool',
  'neon_grid',
  'track_asphalt',
  'concrete',
  'grass',
]);

const wallStyleEnum = z.enum([
  'cream_plaster',
  'royal_blue',
  'warm_brick',
  'dark_club',
  'marble_panel',
  'pastel_mint',
  'sunset_orange',
  'glass_skyline',
  'retro_arcade',
  'hotel_gold',
]);

const createRoomSchema = z.object({
  name: z.string().trim().min(2, 'Room name must be at least 2 characters').max(50),
  description: z.string().max(240).optional(),
  templateId: z
    .enum(['studio', 'suite', 'penthouse', 'lounge', 'club', 'pool', 'arena', 'lobby'])
    .default('studio'),
  theme: z
    .enum([
      'lobby',
      'reception',
      'lounge',
      'restaurant',
      'nightclub',
      'pool',
      'arcade',
      'rooftop',
      'corridor',
      'race_arena',
      'event_hall',
      'private',
    ])
    .optional(),
  floorStyle: floorStyleEnum.optional(),
  wallStyle: wallStyleEnum.optional(),
  floorColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  wallColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  isPublic: z.boolean().optional(),
  accessMode: z.enum(['open', 'locked', 'friends_only', 'password']).optional(),
  tags: z.array(z.string().max(24)).max(6).optional(),
});

const updateRoomSchema = z.object({
  name: z.string().trim().min(2).max(50).optional(),
  description: z.string().max(240).optional(),
  floorStyle: floorStyleEnum.optional(),
  wallStyle: wallStyleEnum.optional(),
  floorColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  wallColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  tags: z.array(z.string().max(24)).max(6).optional(),
  permissions: z
    .object({
      accessMode: z.enum(['open', 'locked', 'friends_only', 'password']).optional(),
      allowTrading: z.boolean().optional(),
      allowWalkThrough: z.boolean().optional(),
      maxUsers: z.number().int().min(2).max(80).optional(),
    })
    .optional(),
});

async function attachUserCounts(
  rooms: RoomSummary[],
  presence: IPresenceService
): Promise<RoomSummary[]> {
  if (rooms.length === 0) return rooms;
  const counts = await presence.getRoomUserCounts(rooms.map((r) => r.id));
  return rooms.map((r) => ({
    ...r,
    userCount: counts[r.id] ?? 0,
  }));
}

export function createRoomsRouter(
  store: IDataStore,
  presence: IPresenceService
): Router {
  const router = Router();

  router.get('/', optionalAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const [allPublic, owned] = await Promise.all([
        store.listPublicRooms(),
        req.authUser ? store.listRoomsByOwner(req.authUser.userId) : Promise.resolve([]),
      ]);
      const [enrichedPublic, enrichedOwned] = await Promise.all([
        attachUserCounts(allPublic, presence),
        attachUserCounts(owned, presence),
      ]);

      const publicRooms = enrichedPublic.filter((r) => r.ownerId === 'system');
      const playerRooms = enrichedPublic.filter((r) => r.ownerId !== 'system');

      res.json({
        publicRooms,
        myRooms: enrichedOwned,
        playerRooms,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to list rooms';
      res.status(500).json({ error: message });
    }
  });

  router.get('/templates', (_req, res) => {
    res.json({ templates: Object.values(ROOM_TEMPLATES) });
  });

  router.get('/public', async (_req, res) => {
    try {
      const rooms = await store.listPublicRooms();
      const enriched = await attachUserCounts(rooms, presence);
      res.json({ rooms: enriched });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to list public rooms';
      res.status(500).json({ error: message });
    }
  });

  router.get('/mine', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const rooms = await store.listRoomsByOwner(req.authUser!.userId);
      const enriched = await attachUserCounts(rooms, presence);
      res.json({ rooms: enriched });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to list your rooms';
      res.status(500).json({ error: message });
    }
  });

  router.get('/search', async (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const rooms = await store.searchRooms(q, 40);
      const enriched = await attachUserCounts(rooms, presence);
      res.json({ rooms: enriched });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to search rooms';
      res.status(500).json({ error: message });
    }
  });

  router.get('/:roomId', async (req, res) => {
    try {
      const room = await store.getRoomState(req.params.roomId);
      if (!room) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }
      const userCount = await presence.getRoomUserCount(room.id);
      res.json({ room, userCount });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load room';
      res.status(500).json({ error: message });
    }
  });

  router.post(
    '/',
    requireAuth,
    validateBody(createRoomSchema),
    async (req: AuthenticatedRequest, res) => {
      try {
        const body = req.body as z.infer<typeof createRoomSchema>;
        let room = await store.createRoom({
          ownerId: req.authUser!.userId,
          ownerUsername: req.authUser!.username,
          name: sanitizePlainText(body.name, 50),
          description: body.description ? sanitizePlainText(body.description, 240) : '',
          templateId: body.templateId,
          theme: body.theme ?? 'private',
          isPublic: body.isPublic ?? true,
          tags: body.tags?.map((t) => sanitizePlainText(t, 24)).filter(Boolean),
        });

        if (
          body.floorStyle ||
          body.wallStyle ||
          body.floorColor ||
          body.wallColor ||
          body.accessMode
        ) {
          const updated = await store.updateRoomSettings(room.id, {
            floorStyle: body.floorStyle,
            wallStyle: body.wallStyle,
            floorColor: body.floorColor,
            wallColor: body.wallColor,
            ...(body.accessMode ? { permissions: { accessMode: body.accessMode } } : {}),
          });
          if (updated) room = updated;
        }

        res.status(201).json({ room });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create room';
        res.status(400).json({ error: message });
      }
    }
  );

  const handleUpdateRoom = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const roomId = String(req.params.roomId);
      const existing = await store.getRoomState(roomId);
      if (!existing) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }

      const isStaff =
        req.authUser!.role === 'admin' || req.authUser!.role === 'moderator';
      if (existing.ownerId !== req.authUser!.userId && !isStaff) {
        res.status(403).json({ error: 'Only the room owner can update room settings' });
        return;
      }

      const patch = req.body as z.infer<typeof updateRoomSchema>;
      const updated = await store.updateRoomSettings(roomId, {
        ...patch,
        ...(patch.name !== undefined ? { name: sanitizePlainText(patch.name, 50) } : {}),
        ...(patch.description !== undefined
          ? { description: sanitizePlainText(patch.description, 240) }
          : {}),
      });

      res.json({ room: updated });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update room';
      res.status(400).json({ error: message });
    }
  };

  router.patch('/:roomId', requireAuth, validateBody(updateRoomSchema), handleUpdateRoom);
  router.patch(
    '/:roomId/settings',
    requireAuth,
    validateBody(updateRoomSchema),
    handleUpdateRoom
  );

  router.post('/:roomId/like', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const roomId = String(req.params.roomId);
      const likes = await store.likeRoom(roomId, req.authUser!.userId);
      res.json({ roomId, likes });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to like room';
      res.status(400).json({ error: message });
    }
  });

  router.post(
    '/:roomId/favorite',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const roomId = String((req as Request).params.roomId);
        const favoriteRoomIds = await store.toggleFavoriteRoom(
          req.authUser!.userId,
          roomId
        );
        res.json({ favoriteRoomIds });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update favorites';
        res.status(400).json({ error: message });
      }
    }
  );

  return router;
}
