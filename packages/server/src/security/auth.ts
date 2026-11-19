import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { ZodSchema } from 'zod';
import type { UserRole } from '@handihotel/shared';
import { config } from '../config.js';

export interface AuthTokenPayload {
  userId: string;
  username: string;
  role: UserRole;
}

export interface AuthenticatedRequest extends Request {
  authUser?: AuthTokenPayload;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, config.bcryptRounds);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signAuthToken(payload: AuthTokenPayload): string {
  const options: SignOptions = {
    expiresIn: config.jwtExpiresIn as SignOptions['expiresIn'],
  };
  return jwt.sign(payload, config.jwtSecret, options);
}

export function verifyAuthToken(token: string): AuthTokenPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload &
      Partial<AuthTokenPayload>;
    if (!decoded || typeof decoded.userId !== 'string' || typeof decoded.username !== 'string') {
      return null;
    }
    return {
      userId: decoded.userId,
      username: decoded.username,
      role: (decoded.role as UserRole) ?? 'player',
    };
  } catch {
    return null;
  }
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const payload = verifyAuthToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired authentication token' });
    return;
  }

  req.authUser = payload;
  next();
}

export function optionalAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  const token = extractBearerToken(req);
  if (token) {
    const payload = verifyAuthToken(token);
    if (payload) {
      req.authUser = payload;
    }
  }
  next();
}

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
      return;
    }
    req.body = parsed.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid query parameters',
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
      return;
    }
    (req as Request & { validatedQuery?: T }).validatedQuery = parsed.data;
    next();
  };
}

interface RateBucket {
  timestamps: number[];
}

export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
}) {
  const buckets = new Map<string, RateBucket>();
  const { windowMs, maxRequests, keyPrefix = 'rl' } = options;

  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const identity = req.authUser?.userId ?? req.ip ?? 'unknown';
    const key = `${keyPrefix}:${identity}`;
    const now = Date.now();
    const cutoff = now - windowMs;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { timestamps: [] };
      buckets.set(key, bucket);
    }

    bucket.timestamps = bucket.timestamps.filter((ts) => ts > cutoff);
    if (bucket.timestamps.length >= maxRequests) {
      res.status(429).json({
        error: 'Too many requests, please slow down.',
        retryAfterMs: Math.max(1000, windowMs - (now - bucket.timestamps[0])),
      });
      return;
    }

    bucket.timestamps.push(now);
    next();
  };
}

export class SocketRateLimiter {
  private buckets = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly maxEvents: number
  ) {}

  allow(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const prev = this.buckets.get(key) ?? [];
    const recent = prev.filter((ts) => ts > cutoff);
    if (recent.length >= this.maxEvents) {
      this.buckets.set(key, recent);
      return false;
    }
    recent.push(now);
    this.buckets.set(key, recent);
    return true;
  }

  clear(key: string): void {
    this.buckets.delete(key);
  }
}

export const authRateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 30,
  keyPrefix: 'auth',
});

export const apiRateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 240,
  keyPrefix: 'api',
});

const PROFANITY_LIST = [
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'bastard',
  'dick',
  'cunt',
  'slut',
  'whore',
  'nigger',
  'faggot',
  'retard',
  'cripple',
];

const PROFANITY_REGEX = new RegExp(`\\b(${PROFANITY_LIST.join('|')})\\b`, 'gi');

export function sanitizePlainText(input: string, maxLength = 200): string {
  return input
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, maxLength);
}

export function sanitizeChatText(input: string, maxLength = 240): string {
  const cleaned = sanitizePlainText(input, maxLength);
  return cleaned.replace(PROFANITY_REGEX, 'bobba');
}
