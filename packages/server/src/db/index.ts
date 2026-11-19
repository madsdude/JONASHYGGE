import { config } from '../config.js';
import { LocalJsonStore } from './localStore.js';
import { PrismaPostgresStore } from './prismaStore.js';
import type { IDataStore } from './store.js';

export type { IDataStore } from './store.js';
export { toPublicUserProfile } from './store.js';

export async function createDataStore(): Promise<IDataStore> {
  if (config.storageMode !== 'local' && config.databaseUrl) {
    try {
      const pgStore = new PrismaPostgresStore();
      await pgStore.init();
      console.log('[DB] Connected to PostgreSQL via Prisma.');
      return pgStore;
    } catch (err) {
      if (config.storageMode === 'postgres') {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[DB] PostgreSQL unavailable (${message}). Falling back to LocalJsonStore at ${config.localDataFile}.`
      );
    }
  } else {
    console.log(
      `[DB] Using LocalJsonStore (STORAGE_MODE=${config.storageMode}, file=${config.localDataFile}).`
    );
  }

  const localStore = new LocalJsonStore(config.localDataFile);
  await localStore.init();
  return localStore;
}
