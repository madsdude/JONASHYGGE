import { getCatalogItem } from '../data/catalog.js';
import type { CatalogItem } from '../types/economy.js';
import type { Direction8, PlacedFurniture, Rotation4, TileCoord } from '../types/room.js';

export interface TileWalkability {
  walkable: boolean;
  sittable: boolean;
  elevation: number;
  furniId: string | null;
}

export interface PathfindingOptions {
  width: number;
  height: number;
  furniture: readonly PlacedFurniture[];
  heightMap?: number[][];
  /** Optional tiles occupied by other players when walk-through is disabled */
  blockedTiles?: ReadonlySet<string>;
  /** Maximum height step an avatar can climb/descend between adjacent tiles (default 1.0) */
  maxStepHeight?: number;
  /** Allow 8-directional movement (default true) */
  allowDiagonal?: boolean;
  /** Hard cap on returned path length (default 128) */
  maxPathLength?: number;
  /** Hard cap on A* node expansions (default 1500) */
  maxIterations?: number;
  /** Optional custom catalog lookup (defaults to built-in CATALOG_BY_ID) */
  catalogLookup?: (catalogItemId: string) => CatalogItem | undefined;
}

export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * Returns all grid tiles occupied by a furniture item given its anchor (x, y) and rotation.
 */
export function getFurnitureFootprint(
  x: number,
  y: number,
  width: number,
  depth: number,
  rotation: Rotation4
): TileCoord[] {
  const effectiveW = rotation % 2 === 1 ? depth : width;
  const effectiveD = rotation % 2 === 1 ? width : depth;
  const tiles: TileCoord[] = [];
  for (let dx = 0; dx < effectiveW; dx++) {
    for (let dy = 0; dy < effectiveD; dy++) {
      tiles.push({ x: x + dx, y: y + dy });
    }
  }
  return tiles;
}

/**
 * Computes 8-way facing direction from tile a to tile b.
 */
export function computeDirection(from: TileCoord, to: TileCoord): Direction8 {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (dx === 0 && dy < 0) return 0; // N
  if (dx > 0 && dy < 0) return 1; // NE
  if (dx > 0 && dy === 0) return 2; // E
  if (dx > 0 && dy > 0) return 3; // SE
  if (dx === 0 && dy > 0) return 4; // S
  if (dx < 0 && dy > 0) return 5; // SW
  if (dx < 0 && dy === 0) return 6; // W
  if (dx < 0 && dy < 0) return 7; // NW
  return 4;
}

/**
 * Builds a 2D [y][x] walkability + elevation grid from room bounds, heightMap, and placed furniture.
 */
export function buildWalkabilityGrid(options: PathfindingOptions): TileWalkability[][] {
  const { width, height, furniture, heightMap, blockedTiles, catalogLookup = getCatalogItem } = options;

  const grid: TileWalkability[][] = [];
  for (let y = 0; y < height; y++) {
    const row: TileWalkability[] = [];
    for (let x = 0; x < width; x++) {
      const baseElevation = heightMap?.[y]?.[x] ?? 0;
      const isHole = baseElevation < 0;
      row.push({
        walkable: !isHole && !(blockedTiles?.has(tileKey(x, y)) ?? false),
        sittable: false,
        elevation: isHole ? 0 : baseElevation,
        furniId: null,
      });
    }
    grid.push(row);
  }

  // Sort furniture bottom-to-top by z so top-most item determines tile state
  const sorted = [...furniture].sort((a, b) => a.z - b.z);

  for (const furni of sorted) {
    const item = catalogLookup(furni.catalogItemId);
    if (!item) continue;

    const footprint = getFurnitureFootprint(furni.x, furni.y, item.width, item.depth, furni.rotation);
    for (const tile of footprint) {
      if (tile.x < 0 || tile.x >= width || tile.y < 0 || tile.y >= height) continue;
      const cell = grid[tile.y][tile.x];
      const topZ = furni.z + item.height;

      if (item.walkable) {
        // Walkable items (rugs, ramps, disco tiles, pool water, arches) keep walkability
        if (item.height <= 0.35) {
          cell.elevation = Math.max(cell.elevation, furni.z + item.height * 0.5);
        }
        cell.furniId = furni.id;
      } else if (item.sittable) {
        // Sittable items are valid final destinations, not pass-through tiles
        cell.walkable = false;
        cell.sittable = true;
        cell.elevation = Math.max(cell.elevation, furni.z + Math.min(item.height * 0.5, 0.5));
        cell.furniId = furni.id;
      } else {
        // Solid blocking furniture
        cell.walkable = false;
        cell.sittable = false;
        cell.elevation = Math.max(cell.elevation, topZ);
        cell.furniId = furni.id;
      }
    }
  }

  return grid;
}

interface AStarNode {
  x: number;
  y: number;
  z: number;
  g: number;
  f: number;
  parent: AStarNode | null;
}

const NEIGHBORS_4: readonly [number, number, number][] = [
  [0, -1, 1],
  [1, 0, 1],
  [0, 1, 1],
  [-1, 0, 1],
];

const NEIGHBORS_8: readonly [number, number, number][] = [
  [0, -1, 1],
  [1, 0, 1],
  [0, 1, 1],
  [-1, 0, 1],
  [1, -1, Math.SQRT2],
  [1, 1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

function octileHeuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

/**
 * Production A* pathfinder on a 2D isometric/3D room grid.
 * - Supports furniture footprints & rotations
 * - Supports sittable goal tiles (cannot pass through them, can land on them)
 * - Prevents diagonal corner-cutting around solid furniture or walls
 * - Enforces elevation step limits and max-path / max-iteration safety caps
 *
 * Returns an array of TileCoords excluding the start tile and including the goal tile.
 * Returns [] if unreachable or already at goal.
 */
export function findPath(
  start: TileCoord,
  goal: TileCoord,
  options: PathfindingOptions
): TileCoord[] {
  const {
    width,
    height,
    maxStepHeight = 1.0,
    allowDiagonal = true,
    maxPathLength = 128,
    maxIterations = 1500,
  } = options;

  const sx = Math.round(start.x);
  const sy = Math.round(start.y);
  const gx = Math.round(goal.x);
  const gy = Math.round(goal.y);

  if (sx === gx && sy === gy) return [];
  if (gx < 0 || gx >= width || gy < 0 || gy >= height) return [];
  if (sx < 0 || sx >= width || sy < 0 || sy >= height) return [];

  const grid = buildWalkabilityGrid(options);
  const goalCell = grid[gy][gx];

  // Goal must be walkable or sittable
  if (!goalCell.walkable && !goalCell.sittable) {
    return [];
  }

  const startElevation = grid[sy][sx].elevation;
  const openList: AStarNode[] = [
    {
      x: sx,
      y: sy,
      z: startElevation,
      g: 0,
      f: octileHeuristic(sx, sy, gx, gy),
      parent: null,
    },
  ];
  const openBestG = new Map<string, number>([[tileKey(sx, sy), 0]]);
  const closedSet = new Set<string>();
  const dirs = allowDiagonal ? NEIGHBORS_8 : NEIGHBORS_4;

  let iterations = 0;

  while (openList.length > 0 && iterations < maxIterations) {
    iterations++;

    // Pop node with lowest f (tie-break by lowest h)
    let bestIdx = 0;
    for (let i = 1; i < openList.length; i++) {
      if (openList[i].f < openList[bestIdx].f) {
        bestIdx = i;
      }
    }
    const current = openList[bestIdx];
    openList[bestIdx] = openList[openList.length - 1];
    openList.pop();

    const cKey = tileKey(current.x, current.y);
    if (closedSet.has(cKey)) continue;
    closedSet.add(cKey);

    if (current.x === gx && current.y === gy) {
      const path: TileCoord[] = [];
      let node: AStarNode | null = current;
      while (node && node.parent !== null) {
        path.push({ x: node.x, y: node.y, z: node.z });
        node = node.parent;
      }
      path.reverse();
      return path.length <= maxPathLength ? path : path.slice(0, maxPathLength);
    }

    for (const [dx, dy, moveCost] of dirs) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

      const nKey = tileKey(nx, ny);
      if (closedSet.has(nKey)) continue;

      const nextCell = grid[ny][nx];
      const isGoal = nx === gx && ny === gy;

      if (!nextCell.walkable && !(isGoal && nextCell.sittable)) {
        continue;
      }

      // Check elevation step limit
      if (Math.abs(nextCell.elevation - current.z) > maxStepHeight) {
        continue;
      }

      // Prevent diagonal corner-cutting: both orthogonal neighbors must be walkable
      if (dx !== 0 && dy !== 0) {
        const adj1 = grid[current.y][nx];
        const adj2 = grid[ny][current.x];
        if (!adj1.walkable || !adj2.walkable) {
          continue;
        }
        if (
          Math.abs(adj1.elevation - current.z) > maxStepHeight ||
          Math.abs(adj2.elevation - current.z) > maxStepHeight
        ) {
          continue;
        }
      }

      const tentativeG = current.g + moveCost;
      const prevBest = openBestG.get(nKey);
      if (prevBest !== undefined && tentativeG >= prevBest) {
        continue;
      }

      openBestG.set(nKey, tentativeG);
      openList.push({
        x: nx,
        y: ny,
        z: nextCell.elevation,
        g: tentativeG,
        f: tentativeG + octileHeuristic(nx, ny, gx, gy),
        parent: current,
      });
    }
  }

  return [];
}
