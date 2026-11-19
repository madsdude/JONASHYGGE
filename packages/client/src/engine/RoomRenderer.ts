import * as THREE from 'three';
import {
  getCatalogItem,
  getFurnitureFootprint,
  type CatalogItem,
  type FloorStyle,
  type PlacedFurniture,
  type RoomState,
  type Rotation4,
  type WallStyle,
} from '@handihotel/shared';
import { createFurnitureMesh, updateFurnitureAnimation } from './FurnitureFactory';

export const TILE_SIZE = 1;
const FLOOR_THICKNESS = 0.24;
const WALL_HEIGHT = 3.2;
const WALL_THICKNESS = 0.22;

interface FloorPalette {
  a: string;
  b: string;
  roughness: number;
  metalness: number;
  emissive?: string;
  emissiveIntensity?: number;
}

function getFloorPalette(style: FloorStyle, fallbackColor: string): FloorPalette {
  switch (style) {
    case 'wood_oak':
      return { a: '#C89B6E', b: '#B8895C', roughness: 0.72, metalness: 0.04 };
    case 'wood_dark':
      return { a: '#5C4033', b: '#4E3429', roughness: 0.68, metalness: 0.05 };
    case 'marble_white':
      return { a: '#F1F5F9', b: '#E2E8F0', roughness: 0.25, metalness: 0.1 };
    case 'marble_gold':
      return { a: '#F5EBD6', b: '#EAD8B4', roughness: 0.28, metalness: 0.14 };
    case 'checkerboard':
      return { a: '#F8FAFC', b: '#1E293B', roughness: 0.35, metalness: 0.08 };
    case 'carpet_red':
      return { a: '#881337', b: '#9F1239', roughness: 0.94, metalness: 0.0 };
    case 'carpet_blue':
      return { a: '#1E3A8A', b: '#1D4ED8', roughness: 0.92, metalness: 0.0 };
    case 'tile_pool':
      return { a: '#E0F2FE', b: '#BAE6FD', roughness: 0.22, metalness: 0.08 };
    case 'neon_grid':
      return { a: '#111827', b: '#1E1B4B', roughness: 0.3, metalness: 0.35, emissive: '#1E1B4B', emissiveIntensity: 0.2 };
    case 'track_asphalt':
      return { a: '#334155', b: '#3B485B', roughness: 0.85, metalness: 0.04 };
    case 'concrete':
      return { a: '#94A3B8', b: '#8795A8', roughness: 0.88, metalness: 0.02 };
    case 'grass':
      return { a: '#22C55E', b: '#16A34A', roughness: 0.9, metalness: 0.0 };
    default: {
      const base = new THREE.Color(fallbackColor || '#D6D3D1');
      const alt = base.clone().multiplyScalar(0.92);
      return { a: `#${base.getHexString()}`, b: `#${alt.getHexString()}`, roughness: 0.65, metalness: 0.05 };
    }
  }
}

function getWallAccentColor(style: WallStyle): { trim: string; panel: string; windowGlow: string } {
  switch (style) {
    case 'hotel_gold':
      return { trim: '#FACC15', panel: '#92400E', windowGlow: '#FEF08A' };
    case 'royal_blue':
      return { trim: '#E2E8F0', panel: '#1E3A8A', windowGlow: '#BAE6FD' };
    case 'warm_brick':
      return { trim: '#451A03', panel: '#7C2D12', windowGlow: '#FDBA74' };
    case 'dark_club':
      return { trim: '#A855F7', panel: '#090D16', windowGlow: '#EC4899' };
    case 'retro_arcade':
      return { trim: '#06B6D4', panel: '#312E81', windowGlow: '#A855F7' };
    case 'pastel_mint':
      return { trim: '#FFFFFF', panel: '#6EE7B7', windowGlow: '#E0F2FE' };
    case 'sunset_orange':
      return { trim: '#FACC15', panel: '#C2410C', windowGlow: '#FED7AA' };
    case 'glass_skyline':
      return { trim: '#38BDF8', panel: '#0F172A', windowGlow: '#F59E0B' };
    case 'marble_panel':
      return { trim: '#D97706', panel: '#CBD5E1', windowGlow: '#FEF3C7' };
    case 'cream_plaster':
    default:
      return { trim: '#78350F', panel: '#F5EFE6', windowGlow: '#FEF9C3' };
  }
}

export class RoomRenderer {
  public readonly root = new THREE.Group();

  private readonly floorGroup = new THREE.Group();
  private readonly wallGroup = new THREE.Group();
  private readonly ambientGroup = new THREE.Group();
  private readonly furnitureGroup = new THREE.Group();
  private readonly overlayGroup = new THREE.Group();

  private floorInstancedMesh: THREE.InstancedMesh | null = null;
  private instanceToTile: Array<{ x: number; y: number; elevation: number }> = [];

  private furnitureMeshes = new Map<string, { group: THREE.Group; data: PlacedFurniture; seed: number }>();
  private currentRoom: RoomState | null = null;

  // Interactive hover & ghost preview
  private hoverMesh: THREE.Mesh;
  private ghostGroup: THREE.Group | null = null;
  private ghostValidMat: THREE.MeshStandardMaterial;
  private ghostInvalidMat: THREE.MeshStandardMaterial;

  // Theme animation handles
  private discoBeams: THREE.Mesh[] = [];
  private poolShimmerMesh: THREE.Mesh | null = null;
  private chandelierLights: THREE.PointLight[] = [];
  private trackStrips: THREE.Mesh[] = [];

  constructor() {
    this.root.name = 'RoomRoot';
    this.root.add(this.floorGroup);
    this.root.add(this.wallGroup);
    this.root.add(this.ambientGroup);
    this.root.add(this.furnitureGroup);
    this.root.add(this.overlayGroup);

    // Tile hover highlight
    const hoverGeo = new THREE.PlaneGeometry(0.94, 0.94);
    hoverGeo.rotateX(-Math.PI / 2);
    const hoverMat = new THREE.MeshBasicMaterial({
      color: '#38BDF8',
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
    });
    this.hoverMesh = new THREE.Mesh(hoverGeo, hoverMat);
    this.hoverMesh.visible = false;
    this.hoverMesh.renderOrder = 2;
    this.overlayGroup.add(this.hoverMesh);

    this.ghostValidMat = new THREE.MeshStandardMaterial({
      color: '#22C55E',
      emissive: '#16A34A',
      emissiveIntensity: 0.45,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.ghostInvalidMat = new THREE.MeshStandardMaterial({
      color: '#EF4444',
      emissive: '#DC2626',
      emissiveIntensity: 0.45,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
  }

  public getRoom(): RoomState | null {
    return this.currentRoom;
  }

  public getFloorInstancedMesh(): THREE.InstancedMesh | null {
    return this.floorInstancedMesh;
  }

  public getTileFromInstanceId(instanceId: number): { x: number; y: number; elevation: number } | null {
    return this.instanceToTile[instanceId] ?? null;
  }

  public getFurnitureRootGroup(): THREE.Group {
    return this.furnitureGroup;
  }

  public getPlacedFurnitureById(furniId: string): PlacedFurniture | null {
    return this.furnitureMeshes.get(furniId)?.data ?? null;
  }

  public getTileElevation(x: number, y: number): number {
    if (!this.currentRoom?.heightMap) return 0;
    const row = this.currentRoom.heightMap[y];
    if (!row) return 0;
    const val = row[x];
    return val !== undefined && val >= 0 ? val : 0;
  }

  public tileToWorld(x: number, y: number, z = 0): THREE.Vector3 {
    const elev = this.getTileElevation(Math.round(x), Math.round(y));
    return new THREE.Vector3(x + 0.5, elev + z, y + 0.5);
  }

  public loadRoom(room: RoomState): void {
    this.clearRoom();
    this.currentRoom = room;

    this.buildFloor(room);
    this.buildWalls(room);
    this.buildThemeAmbiance(room);
    this.syncFurniture(room.furniture);
  }

  public updateRoomAppearance(room: RoomState): void {
    this.currentRoom = room;
    this.clearGroup(this.floorGroup);
    this.clearGroup(this.wallGroup);
    this.clearGroup(this.ambientGroup);
    this.floorInstancedMesh = null;
    this.instanceToTile = [];
    this.discoBeams = [];
    this.poolShimmerMesh = null;
    this.chandelierLights = [];
    this.trackStrips = [];

    this.buildFloor(room);
    this.buildWalls(room);
    this.buildThemeAmbiance(room);
  }

  private buildFloor(room: RoomState): void {
    const { width, height, floorStyle, floorColor, heightMap } = room;
    const palette = getFloorPalette(floorStyle, floorColor);

    const tiles: Array<{ x: number; y: number; elevation: number }> = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const elev = heightMap?.[y]?.[x] ?? 0;
        if (elev < 0) continue;
        tiles.push({ x, y, elevation: elev });
      }
    }

    const tileGeo = new THREE.BoxGeometry(0.985, FLOOR_THICKNESS, 0.985);
    const tileMat = new THREE.MeshStandardMaterial({
      color: '#FFFFFF',
      roughness: palette.roughness,
      metalness: palette.metalness,
      emissive: palette.emissive ? new THREE.Color(palette.emissive) : undefined,
      emissiveIntensity: palette.emissiveIntensity ?? 0,
    });

    const instanced = new THREE.InstancedMesh(tileGeo, tileMat, tiles.length);
    instanced.receiveShadow = true;
    instanced.castShadow = false;
    instanced.name = 'RoomFloorInstanced';

    const dummy = new THREE.Object3D();
    const colorA = new THREE.Color(palette.a);
    const colorB = new THREE.Color(palette.b);
    const accent = new THREE.Color('#06B6D4');
    const laneColor = new THREE.Color('#FACC15');
    const tmp = new THREE.Color();

    tiles.forEach((tile, i) => {
      dummy.position.set(tile.x + 0.5, tile.elevation - FLOOR_THICKNESS / 2, tile.y + 0.5);
      dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);

      if (floorStyle === 'wood_oak' || floorStyle === 'wood_dark') {
        tmp.copy((tile.y % 2 === 0 ? (tile.x % 3 === 0) : (tile.x % 3 === 1)) ? colorA : colorB);
      } else if (floorStyle === 'neon_grid') {
        const isGridEdge = tile.x % 4 === 0 || tile.y % 4 === 0;
        tmp.copy(isGridEdge ? colorB : colorA);
        if (tile.x === 0 || tile.y === 0 || tile.x === width - 1 || tile.y === height - 1) {
          tmp.lerp(accent, 0.25);
        }
      } else if (floorStyle === 'track_asphalt') {
        const onTrackBorder =
          tile.x === 1 || tile.x === width - 2 || tile.y === 1 || tile.y === height - 2;
        tmp.copy((tile.x + tile.y) % 2 === 0 ? colorA : colorB);
        if (onTrackBorder && (tile.x + tile.y) % 2 === 0) {
          tmp.lerp(laneColor, 0.35);
        }
      } else {
        tmp.copy((tile.x + tile.y) % 2 === 0 ? colorA : colorB);
      }

      instanced.setColorAt(i, tmp);
    });

    instanced.instanceMatrix.needsUpdate = true;
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;

    this.floorInstancedMesh = instanced;
    this.instanceToTile = tiles;
    this.floorGroup.add(instanced);

    // Classic Habbo cutaway isometric floor plinth skirt
    const plinthMat = new THREE.MeshStandardMaterial({ color: '#1E293B', roughness: 0.85 });
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.08, 0.28, height + 0.08),
      plinthMat
    );
    plinth.position.set(width / 2, -FLOOR_THICKNESS - 0.14, height / 2);
    plinth.receiveShadow = true;
    this.floorGroup.add(plinth);
  }

  private buildWalls(room: RoomState): void {
    const { width, height, wallStyle, wallColor, spawnX, spawnY } = room;
    const accents = getWallAccentColor(wallStyle);
    const isGlass = wallStyle === 'glass_skyline';

    const wallMat = new THREE.MeshStandardMaterial({
      color: wallColor || accents.panel,
      roughness: isGlass ? 0.18 : 0.78,
      metalness: isGlass ? 0.25 : 0.05,
      transparent: isGlass,
      opacity: isGlass ? 0.38 : 1,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: accents.trim,
      roughness: 0.4,
      metalness: 0.25,
    });
    const darkFrameMat = new THREE.MeshStandardMaterial({
      color: '#1E293B',
      roughness: 0.45,
      metalness: 0.35,
    });
    const windowGlassMat = new THREE.MeshStandardMaterial({
      color: accents.windowGlow,
      emissive: new THREE.Color(accents.windowGlow),
      emissiveIntensity: 0.55,
      roughness: 0.15,
      transparent: true,
      opacity: 0.82,
    });

    // North Wall (z = 0, x = 0..width)
    const northWall = new THREE.Mesh(
      new THREE.BoxGeometry(width + WALL_THICKNESS, WALL_HEIGHT, WALL_THICKNESS),
      wallMat
    );
    northWall.position.set(width / 2 - WALL_THICKNESS / 2, WALL_HEIGHT / 2, -WALL_THICKNESS / 2);
    northWall.receiveShadow = true;
    northWall.castShadow = !isGlass;
    this.wallGroup.add(northWall);

    // West Wall (x = 0, z = 0..height)
    const westWall = new THREE.Mesh(
      new THREE.BoxGeometry(WALL_THICKNESS, WALL_HEIGHT, height),
      wallMat
    );
    westWall.position.set(-WALL_THICKNESS / 2, WALL_HEIGHT / 2, height / 2);
    westWall.receiveShadow = true;
    westWall.castShadow = !isGlass;
    this.wallGroup.add(westWall);

    // Skirting boards (baseboards) & top crown molding
    const northSkirt = new THREE.Mesh(new THREE.BoxGeometry(width, 0.24, 0.06), trimMat);
    northSkirt.position.set(width / 2, 0.12, 0.03);
    this.wallGroup.add(northSkirt);

    const westSkirt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.24, height), trimMat);
    westSkirt.position.set(0.03, 0.12, height / 2);
    this.wallGroup.add(westSkirt);

    const northCrown = new THREE.Mesh(new THREE.BoxGeometry(width + WALL_THICKNESS + 0.06, 0.14, WALL_THICKNESS + 0.08), trimMat);
    northCrown.position.set(width / 2 - WALL_THICKNESS / 2, WALL_HEIGHT + 0.05, -WALL_THICKNESS / 2);
    this.wallGroup.add(northCrown);

    const westCrown = new THREE.Mesh(new THREE.BoxGeometry(WALL_THICKNESS + 0.08, 0.14, height + 0.06), trimMat);
    westCrown.position.set(-WALL_THICKNESS / 2, WALL_HEIGHT + 0.05, height / 2);
    this.wallGroup.add(westCrown);

    // Decorative vertical pilasters & windows on North wall
    const winStep = 4;
    for (let wx = 2; wx < width - 1; wx += winStep) {
      // Skip if near elevator placement on back wall (y=0)
      if (wallStyle !== 'glass_skyline') {
        const frame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.25, 0.08), darkFrameMat);
        frame.position.set(wx, 2.05, 0.02);
        this.wallGroup.add(frame);

        const pane = new THREE.Mesh(new THREE.BoxGeometry(1.32, 1.06, 0.09), windowGlassMat);
        pane.position.set(wx, 2.05, 0.03);
        this.wallGroup.add(pane);

        // Window mullion crossbars
        const barH = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.05, 0.1), darkFrameMat);
        barH.position.set(wx, 2.05, 0.035);
        this.wallGroup.add(barH);
        const barV = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.08, 0.1), darkFrameMat);
        barV.position.set(wx, 2.05, 0.035);
        this.wallGroup.add(barV);
      } else {
        // Sleek glass skyline mullions
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, WALL_HEIGHT, 0.12), darkFrameMat);
        post.position.set(wx, WALL_HEIGHT / 2, 0);
        this.wallGroup.add(post);
      }
    }

    // Framed hotel entrance doorway on the West wall near spawnY (clamped safely)
    const doorZ = Math.min(Math.max(spawnY + 0.5, 2), height - 2);
    const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.3, 1.3), trimMat);
    doorFrame.position.set(0.04, 1.15, doorZ);
    this.wallGroup.add(doorFrame);

    const doorPanel = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 2.12, 1.06),
      new THREE.MeshStandardMaterial({ color: '#451A03', roughness: 0.55 })
    );
    doorPanel.position.set(0.05, 1.06, doorZ);
    this.wallGroup.add(doorPanel);

    const doorKnob = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 8, 8),
      new THREE.MeshStandardMaterial({ color: '#FACC15', metalness: 0.85, roughness: 0.2 })
    );
    doorKnob.position.set(0.14, 1.02, doorZ + 0.34);
    this.wallGroup.add(doorKnob);

    // Subtle glowing entrance mat at spawn tile
    const spawnMat = new THREE.Mesh(
      new THREE.BoxGeometry(0.86, 0.02, 0.86),
      new THREE.MeshStandardMaterial({
        color: '#FACC15',
        emissive: '#F59E0B',
        emissiveIntensity: 0.25,
        roughness: 0.6,
      })
    );
    spawnMat.position.set(spawnX + 0.5, 0.01, spawnY + 0.5);
    spawnMat.receiveShadow = true;
    this.wallGroup.add(spawnMat);
  }

  private buildThemeAmbiance(room: RoomState): void {
    const { theme, width, height } = room;

    if (theme === 'pool') {
      // Shimmering translucent turquoise water basin sheen over pool center
      const waterMat = new THREE.MeshStandardMaterial({
        color: '#22D3EE',
        emissive: '#06B6D4',
        emissiveIntensity: 0.28,
        roughness: 0.1,
        metalness: 0.15,
        transparent: true,
        opacity: 0.36,
      });
      const waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), waterMat);
      waterMesh.rotation.x = -Math.PI / 2;
      waterMesh.position.set(8, 0.095, 6);
      this.ambientGroup.add(waterMesh);
      this.poolShimmerMesh = waterMesh;
    } else if (theme === 'nightclub' || theme === 'arcade') {
      // Rotating translucent disco spotlights + glowing perimeter floor rails
      const beamColors = ['#EC4899', '#06B6D4', '#A855F7', '#22C55E'];
      beamColors.forEach((hex, idx) => {
        const coneGeo = new THREE.ConeGeometry(1.7, 5.2, 16, 1, true);
        coneGeo.translate(0, -2.6, 0);
        const coneMat = new THREE.MeshBasicMaterial({
          color: hex,
          transparent: true,
          opacity: 0.11,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const beam = new THREE.Mesh(coneGeo, coneMat);
        beam.position.set(
          (idx % 2 === 0 ? 0.28 : 0.72) * width,
          4.4,
          (idx < 2 ? 0.28 : 0.72) * height
        );
        beam.rotation.z = idx % 2 === 0 ? 0.32 : -0.32;
        this.ambientGroup.add(beam);
        this.discoBeams.push(beam);
      });

      const neonStripMat = new THREE.MeshStandardMaterial({
        color: '#06B6D4',
        emissive: '#06B6D4',
        emissiveIntensity: 1.1,
      });
      const nStrip = new THREE.Mesh(new THREE.BoxGeometry(width, 0.05, 0.08), neonStripMat);
      nStrip.position.set(width / 2, 0.03, 0.06);
      this.ambientGroup.add(nStrip);
      const wStrip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, height), neonStripMat);
      wStrip.position.set(0.06, 0.03, height / 2);
      this.ambientGroup.add(wStrip);
    } else if (theme === 'rooftop') {
      // Stylized low-poly twilight city skyline silhouettes behind North & West walls
      const bldgMat = new THREE.MeshStandardMaterial({ color: '#1E293B', roughness: 0.7 });
      const bldgAlt = new THREE.MeshStandardMaterial({ color: '#0F172A', roughness: 0.75 });
      const winGlow = new THREE.MeshBasicMaterial({ color: '#FDE047' });

      for (let i = 0; i < 10; i++) {
        const bw = 1.4 + ((i * 7) % 3) * 0.5;
        const bh = 3.2 + ((i * 11) % 5) * 1.1;
        const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 1.5), i % 2 === 0 ? bldgMat : bldgAlt);
        b.position.set(i * 1.85 - 0.5, bh / 2 - 1.2, -2.6 - (i % 3) * 0.9);
        this.ambientGroup.add(b);

        // Lit skyscraper windows
        for (let wy = 1.2; wy < bh - 0.6; wy += 0.85) {
          const wMesh = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.65, 0.2, 0.05), winGlow);
          wMesh.position.set(b.position.x, wy - 1.2, b.position.z + 0.78);
          this.ambientGroup.add(wMesh);
        }
      }
      for (let i = 0; i < 8; i++) {
        const bd = 1.4 + ((i * 5) % 3) * 0.45;
        const bh = 3.0 + ((i * 13) % 5) * 1.0;
        const b = new THREE.Mesh(new THREE.BoxGeometry(1.5, bh, bd), i % 2 === 0 ? bldgAlt : bldgMat);
        b.position.set(-2.6 - (i % 2) * 0.9, bh / 2 - 1.2, i * 1.85);
        this.ambientGroup.add(b);
      }
    } else if (theme === 'lobby' || theme === 'reception' || theme === 'event_hall') {
      // Warm golden chandelier ambient lights
      const goldLight = new THREE.PointLight('#FDE68A', 1.2, 16, 1.5);
      goldLight.position.set(width / 2, 4.2, height / 2);
      this.ambientGroup.add(goldLight);
      this.chandelierLights.push(goldLight);

      // Subtle floating golden halo ring representing grand ceiling chandelier glow
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(0.9, 0.05, 8, 24),
        new THREE.MeshBasicMaterial({ color: '#FACC15', transparent: true, opacity: 0.45 })
      );
      halo.rotation.x = Math.PI / 2;
      halo.position.set(width / 2, 4.1, height / 2);
      this.ambientGroup.add(halo);
    } else if (theme === 'race_arena') {
      // Glowing neon track lane strips around the arena perimeter
      const laneMat = new THREE.MeshStandardMaterial({
        color: '#22C55E',
        emissive: '#22C55E',
        emissiveIntensity: 0.95,
      });
      const strips: Array<[number, number, number, number]> = [
        [width / 2, 2.0, width - 4, 0.1],
        [width / 2, height - 2.0, width - 4, 0.1],
        [2.0, height / 2, 0.1, height - 4],
        [width - 2.0, height / 2, 0.1, height - 4],
      ];
      strips.forEach(([sx, sz, sw, sd]) => {
        const s = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.02, sd), laneMat);
        s.position.set(sx, 0.015, sz);
        this.ambientGroup.add(s);
        this.trackStrips.push(s);
      });
    }
  }

  // ============================================================================
  // Furniture Sync & Placement
  // ============================================================================

  public syncFurniture(furnitureList: readonly PlacedFurniture[]): void {
    const incomingIds = new Set(furnitureList.map((f) => f.id));

    // Remove deleted furniture
    for (const [id, entry] of this.furnitureMeshes.entries()) {
      if (!incomingIds.has(id)) {
        this.furnitureGroup.remove(entry.group);
        this.furnitureMeshes.delete(id);
      }
    }

    // Add or update furniture
    for (const furni of furnitureList) {
      this.addOrUpdateFurniture(furni);
    }
  }

  public addOrUpdateFurniture(furni: PlacedFurniture): void {
    const item = getCatalogItem(furni.catalogItemId);
    if (!item) return;

    const existing = this.furnitureMeshes.get(furni.id);
    if (existing) {
      this.furnitureGroup.remove(existing.group);
    }

    const group = createFurnitureMesh(item, furni.rotation, furni.state);
    this.positionFurnitureGroup(group, item, furni.x, furni.y, furni.z, furni.rotation);

    // Tag all descendant meshes so raycasting finds the PlacedFurniture immediately
    group.userData.furniId = furni.id;
    group.traverse((child) => {
      child.userData.furniId = furni.id;
    });

    this.furnitureGroup.add(group);
    this.furnitureMeshes.set(furni.id, {
      group,
      data: furni,
      seed: (furni.x * 1.37 + furni.y * 2.19) % 10,
    });
  }

  public removeFurniture(furniId: string): void {
    const existing = this.furnitureMeshes.get(furniId);
    if (!existing) return;
    this.furnitureGroup.remove(existing.group);
    this.furnitureMeshes.delete(furniId);
  }

  private positionFurnitureGroup(
    group: THREE.Group,
    item: CatalogItem,
    x: number,
    y: number,
    z: number,
    rotation: Rotation4
  ): void {
    const effectiveW = rotation % 2 === 1 ? item.depth : item.width;
    const effectiveD = rotation % 2 === 1 ? item.width : item.depth;
    const elev = this.getTileElevation(x, y);
    group.position.set(x + effectiveW / 2, elev + z, y + effectiveD / 2);
  }

  // ============================================================================
  // Interactive Hover & Room Builder Ghost Preview
  // ============================================================================

  public setHoverTile(x: number | null, y: number | null): void {
    if (x === null || y === null || !this.currentRoom) {
      this.hoverMesh.visible = false;
      return;
    }
    const elev = this.getTileElevation(x, y);
    this.hoverMesh.position.set(x + 0.5, elev + 0.025, y + 0.5);
    this.hoverMesh.visible = true;
  }

  public setGhostPreview(
    catalogItemId: string | null,
    x: number,
    y: number,
    rotation: Rotation4,
    valid: boolean
  ): void {
    if (this.ghostGroup) {
      this.overlayGroup.remove(this.ghostGroup);
      this.ghostGroup = null;
    }
    if (!catalogItemId || !this.currentRoom) return;

    const item = getCatalogItem(catalogItemId);
    if (!item) return;

    const ghost = createFurnitureMesh(item, rotation);
    const mat = valid ? this.ghostValidMat : this.ghostInvalidMat;
    ghost.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        m.material = mat;
        m.castShadow = false;
        m.receiveShadow = false;
      }
    });

    this.positionFurnitureGroup(ghost, item, x, y, 0.02, rotation);
    this.overlayGroup.add(ghost);
    this.ghostGroup = ghost;
  }

  public clearGhostPreview(): void {
    if (this.ghostGroup) {
      this.overlayGroup.remove(this.ghostGroup);
      this.ghostGroup = null;
    }
  }

  /**
   * Checks whether placing `catalogItemId` at (x, y, rotation) fits inside room bounds
   * and doesn't collide with non-stackable furniture.
   */
  public canPlaceAt(catalogItemId: string, x: number, y: number, rotation: Rotation4): boolean {
    if (!this.currentRoom) return false;
    const item = getCatalogItem(catalogItemId);
    if (!item) return false;

    const footprint = getFurnitureFootprint(x, y, item.width, item.depth, rotation);
    for (const tile of footprint) {
      if (
        tile.x < 0 ||
        tile.x >= this.currentRoom.width ||
        tile.y < 0 ||
        tile.y >= this.currentRoom.height
      ) {
        return false;
      }
      const elev = this.currentRoom.heightMap?.[tile.y]?.[tile.x] ?? 0;
      if (elev < 0) return false;
    }

    // Check collisions with existing furniture
    for (const entry of this.furnitureMeshes.values()) {
      const existingItem = getCatalogItem(entry.data.catalogItemId);
      if (!existingItem) continue;
      if (existingItem.walkable || existingItem.stackable || item.walkable) continue;
      const existingTiles = getFurnitureFootprint(
        entry.data.x,
        entry.data.y,
        existingItem.width,
        existingItem.depth,
        entry.data.rotation
      );
      for (const a of footprint) {
        for (const b of existingTiles) {
          if (a.x === b.x && a.y === b.y) return false;
        }
      }
    }
    return true;
  }

  // ============================================================================
  // Per-Frame Animation Update
  // ============================================================================

  public update(elapsedTime: number, delta: number): void {
    // Animate interactive furniture
    for (const entry of this.furnitureMeshes.values()) {
      updateFurnitureAnimation(entry.group, elapsedTime, delta, entry.seed);
    }

    // Animate theme features
    if (this.discoBeams.length > 0) {
      this.discoBeams.forEach((beam, idx) => {
        beam.rotation.y = elapsedTime * (0.9 + idx * 0.25) * (idx % 2 === 0 ? 1 : -1);
        beam.rotation.x = Math.sin(elapsedTime * 1.4 + idx) * 0.28;
      });
    }

    if (this.poolShimmerMesh) {
      const mat = this.poolShimmerMesh.material as THREE.MeshStandardMaterial;
      mat.opacity = 0.3 + 0.1 * Math.sin(elapsedTime * 2.5);
      this.poolShimmerMesh.position.y = 0.09 + Math.sin(elapsedTime * 2.0) * 0.008;
    }

    if (this.chandelierLights.length > 0) {
      this.chandelierLights.forEach((light, idx) => {
        light.intensity = 1.15 + Math.sin(elapsedTime * 2.2 + idx) * 0.12;
      });
    }
  }

  private clearGroup(group: THREE.Group): void {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
    }
  }

  public clearRoom(): void {
    if (this.floorInstancedMesh) {
      this.floorInstancedMesh.geometry.dispose();
      (this.floorInstancedMesh.material as THREE.Material).dispose();
      this.floorInstancedMesh = null;
    }
    this.clearGroup(this.floorGroup);
    this.clearGroup(this.wallGroup);
    this.clearGroup(this.ambientGroup);
    this.clearGroup(this.furnitureGroup);
    this.clearGhostPreview();
    this.hoverMesh.visible = false;
    this.furnitureMeshes.clear();
    this.instanceToTile = [];
    this.discoBeams = [];
    this.poolShimmerMesh = null;
    this.chandelierLights = [];
    this.trackStrips = [];
    this.currentRoom = null;
  }

  public dispose(): void {
    this.clearRoom();
    this.hoverMesh.geometry.dispose();
    (this.hoverMesh.material as THREE.Material).dispose();
    this.ghostValidMat.dispose();
    this.ghostInvalidMat.dispose();
  }
}
