import { describe, expect, it } from 'vitest';
import {
  CATALOG_BY_ID,
  CATALOG_ITEMS,
  DEFAULT_AVATAR_CONFIG,
  PUBLIC_ROOMS,
  ROOM_TEMPLATES,
  buildWalkabilityGrid,
  getCatalogItem,
  getFurnitureFootprint,
  getPublicRoom,
} from '@handihotel/shared';

describe('Catalog & Public Rooms Data Integrity', () => {
  it('contains at least 55 unique catalog items with valid dimensions and prices', () => {
    expect(CATALOG_ITEMS.length).toBeGreaterThanOrEqual(55);
    const seenIds = new Set<string>();

    for (const item of CATALOG_ITEMS) {
      expect(seenIds.has(item.id), `Duplicate catalog item id: ${item.id}`).toBe(false);
      seenIds.add(item.id);
      expect(item.name.trim().length).toBeGreaterThan(0);
      expect(item.description.trim().length).toBeGreaterThan(0);
      expect(item.priceCredits).toBeGreaterThanOrEqual(0);
      expect(item.priceStars).toBeGreaterThanOrEqual(0);
      expect(item.width).toBeGreaterThanOrEqual(1);
      expect(item.depth).toBeGreaterThanOrEqual(1);
      expect(item.height).toBeGreaterThanOrEqual(0);
      expect(item.primaryColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(item.accentColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(CATALOG_BY_ID.get(item.id)).toBe(item);
      expect(getCatalogItem(item.id)).toBe(item);
    }
  });

  it('includes all 11 public hotel rooms with unique ids and valid spawn points', () => {
    expect(PUBLIC_ROOMS).toHaveLength(11);
    const seenIds = new Set<string>();

    for (const room of PUBLIC_ROOMS) {
      expect(seenIds.has(room.id), `Duplicate public room id: ${room.id}`).toBe(false);
      seenIds.add(room.id);
      expect(room.isPublic).toBe(true);
      expect(room.width).toBeGreaterThanOrEqual(8);
      expect(room.height).toBeGreaterThanOrEqual(8);
      expect(room.spawnX).toBeGreaterThanOrEqual(0);
      expect(room.spawnX).toBeLessThan(room.width);
      expect(room.spawnY).toBeGreaterThanOrEqual(0);
      expect(room.spawnY).toBeLessThan(room.height);
      expect(getPublicRoom(room.id)).toBe(room);

      // Spawn tile must be walkable
      const grid = buildWalkabilityGrid({
        width: room.width,
        height: room.height,
        furniture: room.furniture,
        heightMap: room.heightMap,
      });
      expect(
        grid[room.spawnY][room.spawnX].walkable,
        `Spawn tile (${room.spawnX},${room.spawnY}) in ${room.id} is blocked!`
      ).toBe(true);
    }
  });

  it('verifies every placed furniture item in all 11 public rooms references a valid catalog item and fits inside room bounds', () => {
    for (const room of PUBLIC_ROOMS) {
      expect(room.furniture.length, `Room ${room.id} has no furniture`).toBeGreaterThan(0);
      for (const furni of room.furniture) {
        const catalog = getCatalogItem(furni.catalogItemId);
        expect(
          catalog,
          `Missing catalog item "${furni.catalogItemId}" in room "${room.id}"`
        ).toBeDefined();
        if (!catalog) continue;

        const footprint = getFurnitureFootprint(
          furni.x,
          furni.y,
          catalog.width,
          catalog.depth,
          furni.rotation
        );
        for (const tile of footprint) {
          expect(
            tile.x >= 0 && tile.x < room.width && tile.y >= 0 && tile.y < room.height,
            `Furniture "${furni.catalogItemId}" (${furni.id}) in "${room.id}" spills out of bounds at (${tile.x},${tile.y}) for ${room.width}x${room.height}`
          ).toBe(true);
        }
      }
    }
  });

  it('has valid ROOM_TEMPLATES and DEFAULT_AVATAR_CONFIG', () => {
    expect(Object.keys(ROOM_TEMPLATES).length).toBeGreaterThanOrEqual(8);
    for (const tpl of Object.values(ROOM_TEMPLATES)) {
      expect(tpl.width).toBeGreaterThanOrEqual(8);
      expect(tpl.height).toBeGreaterThanOrEqual(8);
      expect(tpl.spawnX).toBeLessThan(tpl.width);
      expect(tpl.spawnY).toBeLessThan(tpl.height);
    }
    expect(DEFAULT_AVATAR_CONFIG.skinTone).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(DEFAULT_AVATAR_CONFIG.mobilityAid).toBeDefined();
  });
});
