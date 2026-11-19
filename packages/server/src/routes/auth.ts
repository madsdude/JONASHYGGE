import { Router } from 'express';
import { z } from 'zod';
import { DEFAULT_AVATAR_CONFIG } from '@handihotel/shared';
import type { IDataStore } from '../db/store.js';
import { toPublicUserProfile } from '../db/store.js';
import type { IPresenceService } from '../redis/presence.js';
import {
  authRateLimiter,
  hashPassword,
  requireAuth,
  sanitizePlainText,
  signAuthToken,
  validateBody,
  verifyPassword,
  type AuthenticatedRequest,
} from '../security/auth.js';

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color');

export const avatarConfigSchema = z.object({
  bodyType: z.enum(['slim', 'standard', 'broad', 'petite', 'tall']),
  skinTone: hexColor,
  hairStyle: z.enum([
    'spiky',
    'bob',
    'afro',
    'mohawk',
    'long',
    'ponytail',
    'bun',
    'curly',
    'buzz',
    'pompadour',
  ]),
  hairColor: hexColor,
  shirtStyle: z.enum([
    'tshirt',
    'hoodie',
    'jacket',
    'jersey',
    'suit',
    'sweater',
    'tank',
    'robe',
  ]),
  shirtColor: hexColor,
  pantsColor: hexColor,
  shoeColor: hexColor,
  accessory: z.enum([
    'none',
    'sunglasses',
    'crown',
    'headphones',
    'scarf',
    'cape',
    'top_hat',
    'party_hat',
    'backpack',
  ]),
  accessoryColor: hexColor,
  expression: z.enum([
    'happy',
    'cheeky',
    'cool',
    'surprised',
    'laughing',
    'wink',
    'focused',
  ]),
  mobilityAid: z.enum([
    'none',
    'manual_wheelchair',
    'racing_wheelchair',
    'power_wheelchair',
    'forearm_crutches',
    'underarm_crutches',
    'prosthetic_leg',
    'prosthetic_arm',
    'guide_cane',
    'rollator_walker',
  ]),
  mobilityAidColor: hexColor,
});

const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters')
    .max(20, 'Username must be at most 20 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Username may only contain letters, numbers, _ and -'),
  email: z.string().trim().email('Valid email required').max(120),
  password: z.string().min(6, 'Password must be at least 6 characters').max(100),
  motto: z.string().max(100).optional(),
  avatar: avatarConfigSchema.optional(),
});

const loginSchema = z
  .object({
    identifier: z.string().trim().min(1).optional(),
    usernameOrEmail: z.string().trim().min(1).optional(),
    username: z.string().trim().min(1).optional(),
    email: z.string().trim().min(1).optional(),
    password: z.string().min(1, 'Password is required'),
  })
  .refine((d) => Boolean(d.identifier || d.usernameOrEmail || d.username || d.email), {
    message: 'Username or email is required',
  });

const updateMottoSchema = z.object({
  motto: z.string().max(120),
});

const updateAvatarSchema = z.object({
  avatar: avatarConfigSchema,
  motto: z.string().max(120).optional(),
});

export function createAuthRouter(
  store: IDataStore,
  presence: IPresenceService
): Router {
  const router = Router();

  router.post(
    '/register',
    authRateLimiter,
    validateBody(registerSchema),
    async (req, res) => {
      try {
        const { username, email, password, motto, avatar } = req.body as z.infer<
          typeof registerSchema
        >;

        const [existingByUsername, existingByEmail] = await Promise.all([
          store.findUserByUsername(username),
          store.findUserByEmail(email),
        ]);

        if (existingByUsername) {
          res.status(409).json({ error: 'Username is already taken' });
          return;
        }
        if (existingByEmail) {
          res.status(409).json({ error: 'Email is already registered' });
          return;
        }

        const passwordHash = await hashPassword(password);
        const created = await store.createUser({
          username,
          email,
          passwordHash,
          motto: motto ? sanitizePlainText(motto, 100) : 'Welcome to HandiHotel!',
          avatar: avatar ?? DEFAULT_AVATAR_CONFIG,
        });

        const token = signAuthToken({
          userId: created.id,
          username: created.username,
          role: created.role,
        });

        res.status(201).json({
          token,
          user: toPublicUserProfile(created),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Registration failed';
        res.status(400).json({ error: message });
      }
    }
  );

  router.post(
    '/login',
    authRateLimiter,
    validateBody(loginSchema),
    async (req, res) => {
      try {
        const body = req.body as z.infer<typeof loginSchema>;
        const identifier = (
          body.identifier ??
          body.usernameOrEmail ??
          body.username ??
          body.email ??
          ''
        ).trim();

        const user = identifier.includes('@')
          ? await store.findUserByEmail(identifier)
          : (await store.findUserByUsername(identifier)) ??
            (await store.findUserByEmail(identifier));

        if (!user) {
          res.status(401).json({ error: 'Invalid username or password' });
          return;
        }
        if (user.banned) {
          res.status(403).json({ error: 'This account has been suspended' });
          return;
        }

        const valid = await verifyPassword(body.password, user.passwordHash);
        if (!valid) {
          res.status(401).json({ error: 'Invalid username or password' });
          return;
        }

        const token = signAuthToken({
          userId: user.id,
          username: user.username,
          role: user.role,
        });

        const livePresence = await presence.getUserPresence(user.id);
        const profile = toPublicUserProfile(user);
        if (livePresence) {
          profile.onlineStatus = livePresence.onlineStatus;
          profile.currentRoomId = livePresence.currentRoomId;
          profile.currentRoomName = livePresence.currentRoomName;
        }

        res.json({ token, user: profile });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Login failed';
        res.status(500).json({ error: message });
      }
    }
  );

  router.get('/me', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const user = await store.findUserById(req.authUser!.userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const livePresence = await presence.getUserPresence(user.id);
      const profile = toPublicUserProfile(user);
      if (livePresence) {
        profile.onlineStatus = livePresence.onlineStatus;
        profile.currentRoomId = livePresence.currentRoomId;
        profile.currentRoomName = livePresence.currentRoomName;
      }

      res.json({ user: profile });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch profile';
      res.status(500).json({ error: message });
    }
  });

  router.patch(
    '/avatar',
    requireAuth,
    validateBody(updateAvatarSchema),
    async (req: AuthenticatedRequest, res) => {
      try {
        const { avatar, motto } = req.body as z.infer<typeof updateAvatarSchema>;
        let updated = await store.updateAvatar(req.authUser!.userId, avatar);
        if (!updated) {
          res.status(404).json({ error: 'User not found' });
          return;
        }
        if (motto !== undefined) {
          const withMotto = await store.updateMotto(
            req.authUser!.userId,
            sanitizePlainText(motto, 120)
          );
          if (withMotto) updated = withMotto;
        }
        res.json({ user: toPublicUserProfile(updated) });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update avatar';
        res.status(400).json({ error: message });
      }
    }
  );

  router.patch(
    '/motto',
    requireAuth,
    validateBody(updateMottoSchema),
    async (req: AuthenticatedRequest, res) => {
      try {
        const { motto } = req.body as z.infer<typeof updateMottoSchema>;
        const cleanMotto = sanitizePlainText(motto, 120);
        const updated = await store.updateMotto(req.authUser!.userId, cleanMotto);
        if (!updated) {
          res.status(404).json({ error: 'User not found' });
          return;
        }
        res.json({ user: toPublicUserProfile(updated) });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update motto';
        res.status(400).json({ error: message });
      }
    }
  );

  router.get('/users/search', requireAuth, async (req, res) => {
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

  return router;
}
