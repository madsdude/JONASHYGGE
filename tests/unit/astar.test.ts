import { describe, expect, it } from 'vitest';
import {
  buildWalkabilityGrid,
  computeDirection,
  findPath,
  getFurnitureFootprint,
  tileKey,
  type PlacedFurniture,
} from '@handihotel/shared';

function furni(
  id: string,
  catalogItemId: string,
  x: number,
  y: number,
  rotation: 0 | 1 | 2 | 3 = 0,
  z = 0
): PlacedFurniture {
  return {
    id,
    roomId: 'test-room',
    catalogItemId,
    ownerId: 'u1',
    x,
    y,
    z,
    rotation,
    state: {},
  };
}

describe('A* Pathfinding & Grid Walkability', () => {
  it('returns empty array when start equals goal or coordinates are out of bounds', () => {
    const opts = { width: 10, height: 10, furniture: [] };
    expect(findPath({ x: 3, y: 3 }, { x: 3, y: 3 }, opts)).toEqual([]);
    expect(findPath({ x: 0, y: 0 }, { x: -1, y: 0 }, opts)).toEqual([]);
    expect(findPath({ x: 0, y: 0 }, { x: 10, y: 5 }, opts)).toEqual([]);
    expect(findPath({ x: -1, y: 0 }, { x: 2, y: 2 }, opts)).toEqual([]);
  });

  it('finds an optimal straight and diagonal path on an empty grid', () => {
    const path = findPath(
      { x: 1, y: 1 },
      { x: 4, y: 4 },
      { width: 10, height: 10, furniture: [] }
    );
    expect(path).toHaveLength(3);
    expect(path[0]).toMatchObject({ x: 2, y: 2 });
    expect(path[path.length - 1]).toMatchObject({ x: 4, y: 4 });
  });

  it('supports 4-directional movement when allowDiagonal is false', () => {
    const path = findPath(
      { x: 1, y: 1 },
      { x: 4, y: 4 },
      { width: 10, height: 10, furniture: [], allowDiagonal: false }
    );
    expect(path).toHaveLength(6);
    for (let i = 0; i < path.length; i++) {
      const prev = i === 0 ? { x: 1, y: 1 } : path[i - 1];
      const stepDist = Math.abs(path[i].x - prev.x) + Math.abs(path[i].y - prev.y);
      expect(stepDist).toBe(1);
    }
  });

  it('routes around solid blocking furniture and respects rotated footprints', () => {
    // coffee_table_oak is 2x1 solid (walkable: false, sittable: false)
    // Rotate by 1 -> occupies (3,2) and (3,3)
    const table = furni('f1', 'coffee_table_oak', 3, 2, 1);
    const footprint = getFurnitureFootprint(3, 2, 2, 1, 1);
    expect(footprint).toEqual([
      { x: 3, y: 2 },
      { x: 3, y: 3 },
    ]);

    const path = findPath(
      { x: 2, y: 2 },
      { x: 4, y: 2 },
      { width: 8, height: 8, furniture: [table] }
    );
    expect(path.length).toBeGreaterThan(2);
    expect(path[path.length - 1]).toMatchObject({ x: 4, y: 2 });
    for (const step of path) {
      expect(tileKey(step.x, step.y)).not.toBe('3,2');
      expect(tileKey(step.x, step.y)).not.toBe('3,3');
    }
  });

  it('prevents diagonal corner-cutting around solid furniture', () => {
    // Place two solid 1x1 items (potted_palm) at (2,1) and (1,2)
    // Going from (1,1) to (2,2) diagonally MUST be blocked by corner-cutting rule
    const blockers = [
      furni('b1', 'potted_palm', 2, 1),
      furni('b2', 'potted_palm', 1, 2),
    ];
    const path = findPath(
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { width: 6, height: 6, furniture: blockers }
    );
    expect(path.length).toBeGreaterThan(1);
    expect(path[0]).not.toMatchObject({ x: 2, y: 2 });
    expect(path[path.length - 1]).toMatchObject({ x: 2, y: 2 });
  });

  it('allows landing on sittable furniture as final goal, but not passing through it', () => {
    // velvet_sofa is 2x1 sittable at (2,2) & (3,2)
    const sofa = furni('s1', 'velvet_sofa', 2, 2, 0);
    const opts = { width: 8, height: 8, furniture: [sofa] };

    // Goal is the sofa tile (2,2) -> reachable!
    const sitPath = findPath({ x: 2, y: 4 }, { x: 2, y: 2 }, opts);
    expect(sitPath.length).toBeGreaterThan(0);
    expect(sitPath[sitPath.length - 1]).toMatchObject({ x: 2, y: 2 });

    // Goal is behind the sofa (2,1), start in front (2,3) -> must route around, never step on (2,2) or (3,2)
    const aroundPath = findPath({ x: 2, y: 3 }, { x: 2, y: 1 }, opts);
    expect(aroundPath.length).toBeGreaterThan(2);
    for (const step of aroundPath) {
      expect(tileKey(step.x, step.y)).not.toBe('2,2');
      expect(tileKey(step.x, step.y)).not.toBe('3,2');
    }
  });

  it('allows walking across walkable items like red_carpet_runner and accessibility_ramp', () => {
    const rug = furni('r1', 'red_carpet_runner', 2, 2, 0);
    const grid = buildWalkabilityGrid({ width: 8, height: 8, furniture: [rug] });
    expect(grid[2][2].walkable).toBe(true);

    const path = findPath(
      { x: 1, y: 2 },
      { x: 5, y: 2 },
      { width: 8, height: 8, furniture: [rug] }
    );
    expect(path).toHaveLength(4);
    expect(path.some((p) => p.x === 2 && p.y === 2)).toBe(true);
  });

  it('returns empty path when goal is completely enclosed by solid furniture', () => {
    const wall = [
      furni('w1', 'potted_palm', 3, 2),
      furni('w2', 'potted_palm', 3, 4),
      furni('w3', 'potted_palm', 2, 3),
      furni('w4', 'potted_palm', 4, 3),
    ];
    const path = findPath(
      { x: 0, y: 0 },
      { x: 3, y: 3 },
      { width: 8, height: 8, furniture: wall }
    );
    expect(path).toEqual([]);
  });

  it('respects heightMap holes (-1) and elevation step limits', () => {
    const heightMap = [
      [0, 0, 0, 0],
      [0, -1, 3, 0],
      [0, 0, 0, 0],
    ];
    const path = findPath(
      { x: 0, y: 1 },
      { x: 3, y: 1 },
      { width: 4, height: 3, furniture: [], heightMap, maxStepHeight: 1.0 }
    );
    expect(path.length).toBeGreaterThan(0);
    for (const step of path) {
      expect(tileKey(step.x, step.y)).not.toBe('1,1');
      expect(tileKey(step.x, step.y)).not.toBe('2,1');
    }
  });

  it('computes all 8 facing directions accurately', () => {
    expect(computeDirection({ x: 5, y: 5 }, { x: 5, y: 4 })).toBe(0); // N
    expect(computeDirection({ x: 5, y: 5 }, { x: 6, y: 4 })).toBe(1); // NE
    expect(computeDirection({ x: 5, y: 5 }, { x: 6, y: 5 })).toBe(2); // E
    expect(computeDirection({ x: 5, y: 5 }, { x: 6, y: 6 })).toBe(3); // SE
    expect(computeDirection({ x: 5, y: 5 }, { x: 5, y: 6 })).toBe(4); // S
    expect(computeDirection({ x: 5, y: 5 }, { x: 4, y: 6 })).toBe(5); // SW
    expect(computeDirection({ x: 5, y: 5 }, { x: 4, y: 5 })).toBe(6); // W
    expect(computeDirection({ x: 5, y: 5 }, { x: 4, y: 4 })).toBe(7); // NW
  });
});
