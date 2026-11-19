import path from 'node:path';

export interface ServerConfig {
  port: number;
  nodeEnv: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  clientOrigin: string;
  storageMode: 'auto' | 'postgres' | 'local';
  databaseUrl: string | null;
  redisUrl: string | null;
  localDataFile: string;
  bcryptRounds: number;
}

const rawStorageMode = (process.env.STORAGE_MODE ?? 'auto').toLowerCase();
const storageMode: ServerConfig['storageMode'] =
  rawStorageMode === 'local' || rawStorageMode === 'postgres' ? rawStorageMode : 'auto';

export const config: ServerConfig = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  jwtSecret:
    process.env.JWT_SECRET ?? 'handihotel-dev-secret-change-in-production-9f8e7d6c5b4a',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  storageMode,
  databaseUrl: process.env.DATABASE_URL?.trim() || null,
  redisUrl: process.env.REDIS_URL?.trim() || null,
  localDataFile:
    process.env.LOCAL_DATA_FILE ??
    path.resolve(process.cwd(), '.data', 'handihotel.json'),
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS ?? 10),
};
