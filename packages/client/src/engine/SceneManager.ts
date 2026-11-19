import * as THREE from 'three';
import type {
  AvatarConfig,
  Direction8,
  EmoteType,
  MinigameSessionState,
  PlacedFurniture,
  PlayerInRoom,
  RoomState,
  RoomTheme,
  Rotation4,
  TileCoord,
} from '@handihotel/shared';
import { buildAvatarRig, type AvatarRig } from './AvatarBuilder';
import { AvatarAnimator } from './AvatarAnimator';
import { RoomRenderer } from './RoomRenderer';
import { MinigameRenderer } from './MinigameRenderer';

export interface SceneCallbacks {
  onTileClick?: (x: number, y: number) => void;
  onFurnitureClick?: (furni: PlacedFurniture) => void;
  onPlayerClick?: (userId: string) => void;
  onTileHover?: (x: number | null, y: number | null) => void;
}

export interface ScreenPosition {
  x: number;
  y: number;
  visible: boolean;
}

export interface PlayerScreenPosition extends ScreenPosition {
  userId: string;
  username: string;
  isAdmin: boolean;
}

interface ManagedAvatar {
  userId: string;
  username: string;
  isAdmin: boolean;
  rig: AvatarRig;
  animator: AvatarAnimator;
  configHash: string;
  currentPos: THREE.Vector3;
  targetPos: THREE.Vector3;
  pathQueue: TileCoord[];
  currentYaw: number;
  targetYaw: number;
  sitting: boolean;
  emote: EmoteType | null;
  speedMultiplier: number;
}

const DIRECTION_YAWS: readonly number[] = [
  Math.PI,              // 0: N (-Z)
  (3 * Math.PI) / 4,    // 1: NE
  Math.PI / 2,          // 2: E (+X)
  Math.PI / 4,          // 3: SE
  0,                    // 4: S (+Z)
  -Math.PI / 4,         // 5: SW
  -Math.PI / 2,         // 6: W (-X)
  -(3 * Math.PI) / 4,   // 7: NW
];

function directionToYaw(dir: Direction8): number {
  return DIRECTION_YAWS[dir] ?? 0;
}

function shortestAngleDelta(from: number, to: number): number {
  let diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function getThemeLighting(theme: RoomTheme): {
  bg: string;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  dirColor: string;
  dirIntensity: number;
  accentColor: string;
  accentIntensity: number;
} {
  switch (theme) {
    case 'nightclub':
      return {
        bg: '#090B1A',
        hemiSky: '#6366F1',
        hemiGround: '#1E1B4B',
        hemiIntensity: 0.65,
        dirColor: '#E0E7FF',
        dirIntensity: 0.75,
        accentColor: '#EC4899',
        accentIntensity: 1.1,
      };
    case 'arcade':
      return {
        bg: '#11102B',
        hemiSky: '#818CF8',
        hemiGround: '#1E1B4B',
        hemiIntensity: 0.7,
        dirColor: '#E0F2FE',
        dirIntensity: 0.8,
        accentColor: '#06B6D4',
        accentIntensity: 1.0,
      };
    case 'rooftop':
      return {
        bg: '#1E1B4B',
        hemiSky: '#FDBA74',
        hemiGround: '#312E81',
        hemiIntensity: 0.85,
        dirColor: '#FDE68A',
        dirIntensity: 1.05,
        accentColor: '#F59E0B',
        accentIntensity: 0.85,
      };
    case 'pool':
      return {
        bg: '#38BDF8',
        hemiSky: '#E0F2FE',
        hemiGround: '#0284C7',
        hemiIntensity: 1.05,
        dirColor: '#FFFBEB',
        dirIntensity: 1.25,
        accentColor: '#22D3EE',
        accentIntensity: 0.45,
      };
    case 'race_arena':
      return {
        bg: '#1E293B',
        hemiSky: '#FEF3C7',
        hemiGround: '#334155',
        hemiIntensity: 0.9,
        dirColor: '#FFFFFF',
        dirIntensity: 1.2,
        accentColor: '#F97316',
        accentIntensity: 0.7,
      };
    case 'lounge':
      return {
        bg: '#1C1412',
        hemiSky: '#FDE68A',
        hemiGround: '#451A03',
        hemiIntensity: 0.8,
        dirColor: '#FEF3C7',
        dirIntensity: 0.95,
        accentColor: '#F97316',
        accentIntensity: 0.85,
      };
    case 'lobby':
    case 'reception':
    case 'event_hall':
    default:
      return {
        bg: '#172554',
        hemiSky: '#FEF9C3',
        hemiGround: '#334155',
        hemiIntensity: 0.95,
        dirColor: '#FFFBEB',
        dirIntensity: 1.15,
        accentColor: '#FACC15',
        accentIntensity: 0.55,
      };
  }
}

export class SceneManager {
  private readonly container: HTMLElement;
  private callbacks: SceneCallbacks;

  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly clock = new THREE.Clock();

  private readonly hemiLight: THREE.HemisphereLight;
  private readonly dirLight: THREE.DirectionalLight;
  private readonly accentLight: THREE.PointLight;

  private readonly roomRenderer = new RoomRenderer();
  private readonly minigameRenderer = new MinigameRenderer();
  private readonly avatarsGroup = new THREE.Group();
  private readonly avatars = new Map<string, ManagedAvatar>();

  private localUserId: string | null = null;
  private followLocalPlayer = true;

  // Isometric camera state
  private frustumSize = 15;
  private targetFrustumSize = 15;
  private readonly minFrustumSize = 7;
  private readonly maxFrustumSize = 28;
  private readonly cameraOffset = new THREE.Vector3(24, 21, 24);
  private lookAtCurrent = new THREE.Vector3(8, 0, 8);
  private lookAtTarget = new THREE.Vector3(8, 0, 8);
  private panOffset = new THREE.Vector3(0, 0, 0);

  // Pointer & raycasting
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private pointerDownX = 0;
  private pointerDownY = 0;
  private lastHoveredTileKey: string | null = null;

  private rafId = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver;

  // Reusable projection vector
  private readonly tmpVec = new THREE.Vector3();

  constructor(container: HTMLElement, callbacks: SceneCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#172554');

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const aspect = width / height;

    this.camera = new THREE.OrthographicCamera(
      (-this.frustumSize * aspect) / 2,
      (this.frustumSize * aspect) / 2,
      this.frustumSize / 2,
      -this.frustumSize / 2,
      0.1,
      150
    );
    this.camera.position.copy(this.lookAtCurrent).add(this.cameraOffset);
    this.camera.lookAt(this.lookAtCurrent);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    // Dynamic lights
    this.hemiLight = new THREE.HemisphereLight('#FEF9C3', '#334155', 0.95);
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight('#FFFBEB', 1.15);
    this.dirLight.position.set(18, 28, 14);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(1024, 1024);
    this.dirLight.shadow.camera.near = 1;
    this.dirLight.shadow.camera.far = 70;
    const d = 20;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;
    this.dirLight.shadow.bias = -0.0006;
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    this.accentLight = new THREE.PointLight('#FACC15', 0.55, 24, 1.5);
    this.accentLight.position.set(8, 5, 8);
    this.scene.add(this.accentLight);

    // World hierarchy
    this.avatarsGroup.name = 'AvatarsRoot';
    this.scene.add(this.roomRenderer.root);
    this.scene.add(this.minigameRenderer.root);
    this.scene.add(this.avatarsGroup);

    // Event bindings
    const dom = this.renderer.domElement;
    dom.addEventListener('pointermove', this.handlePointerMove);
    dom.addEventListener('pointerdown', this.handlePointerDown);
    dom.addEventListener('pointerup', this.handlePointerUp);
    dom.addEventListener('pointerleave', this.handlePointerLeave);
    dom.addEventListener('wheel', this.handleWheel, { passive: false });
    dom.addEventListener('contextmenu', this.handleContextMenu);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    this.clock.start();
    this.animate();
  }

  public setCallbacks(callbacks: SceneCallbacks): void {
    this.callbacks = callbacks;
  }

  public setLocalUserId(userId: string | null): void {
    this.localUserId = userId;
  }

  public setFollowLocalPlayer(enabled: boolean): void {
    this.followLocalPlayer = enabled;
  }

  public setGraphicsQuality(quality: 'high' | 'medium' | 'low'): void {
    if (quality === 'low') {
      this.renderer.setPixelRatio(1);
      this.renderer.shadowMap.enabled = false;
      this.dirLight.castShadow = false;
    } else if (quality === 'medium') {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      this.renderer.shadowMap.enabled = true;
      this.dirLight.castShadow = true;
    } else {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.shadowMap.enabled = true;
      this.dirLight.castShadow = true;
    }
    this.renderer.shadowMap.needsUpdate = true;
  }

  // ============================================================================
  // Room & Furniture API
  // ============================================================================

  public loadRoom(room: RoomState): void {
    this.roomRenderer.loadRoom(room);
    this.minigameRenderer.clear();
    this.applyThemeLighting(room);

    // Center camera on new room
    this.panOffset.set(0, 0, 0);
    this.lookAtTarget.set(room.width / 2, 0, room.height / 2);
    this.lookAtCurrent.copy(this.lookAtTarget);
    this.dirLight.position.set(room.width / 2 + 14, 26, room.height / 2 + 10);
    this.dirLight.target.position.set(room.width / 2, 0, room.height / 2);
    this.accentLight.position.set(room.width / 2, 5.2, room.height / 2);
  }

  public updateRoomAppearance(room: RoomState): void {
    this.roomRenderer.updateRoomAppearance(room);
    this.applyThemeLighting(room);
  }

  private applyThemeLighting(room: RoomState): void {
    const cfg = getThemeLighting(room.theme);
    this.scene.background = new THREE.Color(cfg.bg);
    this.hemiLight.color.set(cfg.hemiSky);
    this.hemiLight.groundColor.set(cfg.hemiGround);
    this.hemiLight.intensity = cfg.hemiIntensity;
    this.dirLight.color.set(cfg.dirColor);
    this.dirLight.intensity = cfg.dirIntensity;
    this.accentLight.color.set(cfg.accentColor);
    this.accentLight.intensity = cfg.accentIntensity;
  }

  public syncFurniture(furniture: readonly PlacedFurniture[]): void {
    this.roomRenderer.syncFurniture(furniture);
  }

  public addOrUpdateFurniture(furni: PlacedFurniture): void {
    this.roomRenderer.addOrUpdateFurniture(furni);
  }

  public removeFurniture(furniId: string): void {
    this.roomRenderer.removeFurniture(furniId);
  }

  public canPlaceAt(catalogItemId: string, x: number, y: number, rotation: Rotation4): boolean {
    return this.roomRenderer.canPlaceAt(catalogItemId, x, y, rotation);
  }

  public setGhostPreview(
    catalogItemId: string | null,
    x: number,
    y: number,
    rotation: Rotation4,
    explicitValid?: boolean
  ): boolean {
    if (!catalogItemId) {
      this.roomRenderer.clearGhostPreview();
      return false;
    }
    const valid = explicitValid ?? this.roomRenderer.canPlaceAt(catalogItemId, x, y, rotation);
    this.roomRenderer.setGhostPreview(catalogItemId, x, y, rotation, valid);
    return valid;
  }

  public clearGhostPreview(): void {
    this.roomRenderer.clearGhostPreview();
  }

  // ============================================================================
  // Minigame Overlays API
  // ============================================================================

  public setMinigameSession(session: MinigameSessionState | null): void {
    this.minigameRenderer.setSession(session, this.roomRenderer.getRoom(), this.localUserId);
  }

  // ============================================================================
  // Player & Avatar Management
  // ============================================================================

  public syncPlayers(players: readonly PlayerInRoom[]): void {
    const incoming = new Set(players.map((p) => p.userId));
    for (const userId of Array.from(this.avatars.keys())) {
      if (!incoming.has(userId)) {
        this.removePlayer(userId);
      }
    }
    for (const p of players) {
      this.addOrUpdatePlayer(p);
    }
  }

  public addOrUpdatePlayer(player: PlayerInRoom): void {
    const configHash = JSON.stringify(player.avatar);
    const existing = this.avatars.get(player.userId);
    const worldPos = this.roomRenderer.tileToWorld(player.x, player.y, player.z);

    if (existing) {
      existing.username = player.username;
      existing.isAdmin = player.isAdmin;
      existing.sitting = player.sitting;
      existing.emote = player.currentEmote;
      existing.speedMultiplier = player.speedMultiplier || 1;
      existing.targetYaw = directionToYaw(player.direction);

      if (existing.pathQueue.length === 0) {
        existing.targetPos.copy(worldPos);
      }

      if (existing.configHash !== configHash) {
        this.rebuildAvatarRig(existing, player.avatar, configHash);
      }
      return;
    }

    const rig = buildAvatarRig(player.avatar);
    this.tagAvatarForRaycast(rig.root, player.userId);
    rig.root.position.copy(worldPos);
    const yaw = directionToYaw(player.direction);
    rig.root.rotation.y = yaw;
    this.avatarsGroup.add(rig.root);

    this.avatars.set(player.userId, {
      userId: player.userId,
      username: player.username,
      isAdmin: player.isAdmin,
      rig,
      animator: new AvatarAnimator(rig),
      configHash,
      currentPos: worldPos.clone(),
      targetPos: worldPos.clone(),
      pathQueue: [],
      currentYaw: yaw,
      targetYaw: yaw,
      sitting: player.sitting,
      emote: player.currentEmote,
      speedMultiplier: player.speedMultiplier || 1,
    });
  }

  public removePlayer(userId: string): void {
    const entry = this.avatars.get(userId);
    if (!entry) return;
    this.avatarsGroup.remove(entry.rig.root);
    entry.rig.dispose();
    this.avatars.delete(userId);
  }

  public setPlayerPath(userId: string, path: TileCoord[]): void {
    const entry = this.avatars.get(userId);
    if (!entry) return;
    entry.pathQueue = path.map((p) => ({ ...p }));
    if (entry.pathQueue.length > 0) {
      entry.sitting = false;
      const first = entry.pathQueue[0];
      entry.targetPos.copy(this.roomRenderer.tileToWorld(first.x, first.y, first.z ?? 0));
    }
  }

  public updatePlayerTransform(
    userId: string,
    x: number,
    y: number,
    z: number,
    direction: Direction8,
    sitting: boolean,
    _sittingFurniId: string | null
  ): void {
    const entry = this.avatars.get(userId);
    if (!entry) return;
    entry.pathQueue = [];
    entry.targetPos.copy(this.roomRenderer.tileToWorld(x, y, z));
    entry.targetYaw = directionToYaw(direction);
    entry.sitting = sitting;
  }

  public setPlayerEmote(userId: string, emote: EmoteType | null): void {
    const entry = this.avatars.get(userId);
    if (!entry) return;
    entry.emote = emote;
  }

  public updatePlayerAvatar(userId: string, avatar: AvatarConfig): void {
    const entry = this.avatars.get(userId);
    if (!entry) return;
    const hash = JSON.stringify(avatar);
    if (entry.configHash === hash) return;
    this.rebuildAvatarRig(entry, avatar, hash);
  }

  private rebuildAvatarRig(entry: ManagedAvatar, config: AvatarConfig, configHash: string): void {
    this.avatarsGroup.remove(entry.rig.root);
    entry.rig.dispose();

    const newRig = buildAvatarRig(config);
    this.tagAvatarForRaycast(newRig.root, entry.userId);
    newRig.root.position.copy(entry.currentPos);
    newRig.root.rotation.y = entry.currentYaw;
    this.avatarsGroup.add(newRig.root);

    entry.rig = newRig;
    entry.animator = new AvatarAnimator(newRig);
    entry.configHash = configHash;
  }

  private tagAvatarForRaycast(root: THREE.Object3D, userId: string): void {
    root.userData.playerId = userId;
    root.traverse((child) => {
      child.userData.playerId = userId;
    });
  }

  // ============================================================================
  // Camera Controls
  // ============================================================================

  public zoomIn(): void {
    this.targetFrustumSize = Math.max(this.minFrustumSize, this.targetFrustumSize - 2.2);
  }

  public zoomOut(): void {
    this.targetFrustumSize = Math.min(this.maxFrustumSize, this.targetFrustumSize + 2.2);
  }

  public resetCamera(): void {
    this.targetFrustumSize = 15;
    this.panOffset.set(0, 0, 0);
    this.followLocalPlayer = true;
    const room = this.roomRenderer.getRoom();
    if (room && !this.localUserId) {
      this.lookAtTarget.set(room.width / 2, 0, room.height / 2);
    }
  }

  public resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.updateCameraProjection(width, height);
    this.renderer.setSize(width, height);
  }

  private updateCameraProjection(width: number, height: number): void {
    const aspect = width / height;
    this.camera.left = (-this.frustumSize * aspect) / 2;
    this.camera.right = (this.frustumSize * aspect) / 2;
    this.camera.top = this.frustumSize / 2;
    this.camera.bottom = -this.frustumSize / 2;
    this.camera.updateProjectionMatrix();
  }

  // ============================================================================
  // Screen Projection for React Floating Chat Bubbles & Nameplates
  // ============================================================================

  public projectToScreen(worldPos: THREE.Vector3): ScreenPosition {
    this.tmpVec.copy(worldPos).project(this.camera);
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const x = (this.tmpVec.x * 0.5 + 0.5) * width;
    const y = (-this.tmpVec.y * 0.5 + 0.5) * height;
    const visible =
      this.tmpVec.z >= -1 &&
      this.tmpVec.z <= 1 &&
      x >= -120 &&
      x <= width + 120 &&
      y >= -120 &&
      y <= height + 120;
    return { x, y, visible };
  }

  public getPlayerScreenPositions(): Record<string, PlayerScreenPosition> {
    const result: Record<string, PlayerScreenPosition> = {};
    for (const [userId, entry] of this.avatars.entries()) {
      const headPos = this.tmpVec.set(
        entry.currentPos.x,
        entry.currentPos.y + 1.82,
        entry.currentPos.z
      );
      const proj = this.projectToScreen(headPos);
      result[userId] = {
        userId,
        username: entry.username,
        isAdmin: entry.isAdmin,
        x: proj.x,
        y: proj.y,
        visible: proj.visible,
      };
    }
    return result;
  }

  // ============================================================================
  // Pointer, Pan, Zoom & Raycasting
  // ============================================================================

  private updatePointerNdc(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private handleContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private handleWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const delta = Math.sign(e.deltaY) * 1.4;
    this.targetFrustumSize = Math.min(
      this.maxFrustumSize,
      Math.max(this.minFrustumSize, this.targetFrustumSize + delta)
    );
  };

  private handlePointerDown = (e: PointerEvent): void => {
    this.pointerDownX = e.clientX;
    this.pointerDownY = e.clientY;
    if (e.button === 1 || e.button === 2) {
      this.isPanning = true;
      this.panStartX = e.clientX;
      this.panStartY = e.clientY;
      this.renderer.domElement.style.cursor = 'grabbing';
    }
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (this.isPanning) {
      const dx = e.clientX - this.panStartX;
      const dy = e.clientY - this.panStartY;
      this.panStartX = e.clientX;
      this.panStartY = e.clientY;

      // Convert screen drag to isometric XZ ground plane pan
      const scale = this.frustumSize / Math.max(1, this.container.clientHeight);
      const rightX = 0.7071;
      const rightZ = -0.7071;
      const fwdX = -0.7071;
      const fwdZ = -0.7071;

      this.panOffset.x += (-dx * rightX + dy * fwdX * 1.45) * scale;
      this.panOffset.z += (-dx * rightZ + dy * fwdZ * 1.45) * scale;
      return;
    }

    this.updatePointerNdc(e);
    const tile = this.raycastFloorTile();
    const key = tile ? `${tile.x},${tile.y}` : null;
    if (key !== this.lastHoveredTileKey) {
      this.lastHoveredTileKey = key;
      this.roomRenderer.setHoverTile(tile ? tile.x : null, tile ? tile.y : null);
      this.callbacks.onTileHover?.(tile ? tile.x : null, tile ? tile.y : null);
    }
  };

  private handlePointerUp = (e: PointerEvent): void => {
    if (this.isPanning) {
      this.isPanning = false;
      this.renderer.domElement.style.cursor = 'default';
      return;
    }

    if (e.button !== 0) return;
    const dist = Math.hypot(e.clientX - this.pointerDownX, e.clientY - this.pointerDownY);
    if (dist > 7) return; // Dragged, not clicked

    this.updatePointerNdc(e);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    // 1. Check avatars first
    const avatarHits = this.raycaster.intersectObjects(this.avatarsGroup.children, true);
    if (avatarHits.length > 0) {
      const playerId = avatarHits[0].object.userData.playerId as string | undefined;
      if (playerId) {
        this.callbacks.onPlayerClick?.(playerId);
        return;
      }
    }

    // 2. Check furniture
    const furniHits = this.raycaster.intersectObjects(
      this.roomRenderer.getFurnitureRootGroup().children,
      true
    );
    if (furniHits.length > 0) {
      const furniId = furniHits[0].object.userData.furniId as string | undefined;
      if (furniId) {
        const furni = this.roomRenderer.getPlacedFurnitureById(furniId);
        if (furni) {
          this.callbacks.onFurnitureClick?.(furni);
          return;
        }
      }
    }

    // 3. Check floor tiles
    const tile = this.raycastFloorTile();
    if (tile) {
      this.callbacks.onTileClick?.(tile.x, tile.y);
    }
  };

  private handlePointerLeave = (): void => {
    this.isPanning = false;
    this.renderer.domElement.style.cursor = 'default';
    if (this.lastHoveredTileKey !== null) {
      this.lastHoveredTileKey = null;
      this.roomRenderer.setHoverTile(null, null);
      this.callbacks.onTileHover?.(null, null);
    }
  };

  private raycastFloorTile(): { x: number; y: number } | null {
    const floor = this.roomRenderer.getFloorInstancedMesh();
    if (!floor) return null;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObject(floor, false);
    if (hits.length === 0 || hits[0].instanceId === undefined) return null;
    const tile = this.roomRenderer.getTileFromInstanceId(hits[0].instanceId);
    return tile ? { x: tile.x, y: tile.y } : null;
  }

  // ============================================================================
  // Main 60 FPS Animation Loop
  // ============================================================================

  private animate = (): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.animate);

    const delta = Math.min(this.clock.getDelta(), 0.1);
    const elapsed = this.clock.elapsedTime;

    // 1. Update avatars (smooth path interpolation + procedural animations)
    this.updateAvatars(delta);

    // 2. Update room furniture & theme ambiance
    this.roomRenderer.update(elapsed, delta);

    // 3. Update minigame 3D overlays
    this.minigameRenderer.update(elapsed, delta);

    // 4. Smooth isometric camera follow & zoom
    this.updateCamera(delta);

    // 5. Render frame
    this.renderer.render(this.scene, this.camera);
  };

  private updateAvatars(delta: number): void {
    const baseSpeed = 3.6;

    for (const entry of this.avatars.values()) {
      const moveSpeed = baseSpeed * Math.max(0.5, entry.speedMultiplier);

      // Advance along queued path waypoints if any
      if (entry.pathQueue.length > 0) {
        const nextTile = entry.pathQueue[0];
        const nextWorld = this.roomRenderer.tileToWorld(
          nextTile.x,
          nextTile.y,
          nextTile.z ?? 0
        );
        entry.targetPos.copy(nextWorld);
      }

      const dx = entry.targetPos.x - entry.currentPos.x;
      const dy = entry.targetPos.y - entry.currentPos.y;
      const dz = entry.targetPos.z - entry.currentPos.z;
      const horizDist = Math.hypot(dx, dz);

      let isMoving = false;
      let speed = 0;

      if (horizDist > 0.025) {
        isMoving = true;
        speed = moveSpeed;
        const step = Math.min(horizDist, moveSpeed * delta);
        const ratio = step / horizDist;
        entry.currentPos.x += dx * ratio;
        entry.currentPos.z += dz * ratio;
        entry.currentPos.y += dy * Math.min(1, delta * 12);
        entry.targetYaw = Math.atan2(dx, dz);

        if (horizDist - step <= 0.03 && entry.pathQueue.length > 0) {
          entry.pathQueue.shift();
        }
      } else {
        entry.currentPos.lerp(entry.targetPos, Math.min(1, delta * 14));
        if (entry.pathQueue.length > 0) {
          entry.pathQueue.shift();
        }
      }

      // Smooth yaw rotation
      const yawDelta = shortestAngleDelta(entry.currentYaw, entry.targetYaw);
      entry.currentYaw += yawDelta * Math.min(1, delta * 12);

      entry.rig.root.position.copy(entry.currentPos);
      entry.rig.root.rotation.y = entry.currentYaw;

      entry.animator.update(delta, {
        isMoving,
        speed,
        isSitting: entry.sitting && !isMoving,
        emote: entry.emote,
        turnDelta: yawDelta,
      });
    }
  }

  private updateCamera(delta: number): void {
    // Follow local player smoothly if enabled
    if (this.followLocalPlayer && this.localUserId) {
      const local = this.avatars.get(this.localUserId);
      if (local) {
        this.lookAtTarget.set(local.currentPos.x, 0, local.currentPos.z);
      }
    }

    const desiredLookAt = this.tmpVec.copy(this.lookAtTarget).add(this.panOffset);
    this.lookAtCurrent.lerp(desiredLookAt, Math.min(1, delta * 6));
    this.camera.position.copy(this.lookAtCurrent).add(this.cameraOffset);
    this.camera.lookAt(this.lookAtCurrent);

    // Smooth zoom
    if (Math.abs(this.frustumSize - this.targetFrustumSize) > 0.01) {
      this.frustumSize += (this.targetFrustumSize - this.frustumSize) * Math.min(1, delta * 10);
      this.updateCameraProjection(
        Math.max(1, this.container.clientWidth),
        Math.max(1, this.container.clientHeight)
      );
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.rafId);

    this.resizeObserver.disconnect();
    const dom = this.renderer.domElement;
    dom.removeEventListener('pointermove', this.handlePointerMove);
    dom.removeEventListener('pointerdown', this.handlePointerDown);
    dom.removeEventListener('pointerup', this.handlePointerUp);
    dom.removeEventListener('pointerleave', this.handlePointerLeave);
    dom.removeEventListener('wheel', this.handleWheel);
    dom.removeEventListener('contextmenu', this.handleContextMenu);

    for (const entry of this.avatars.values()) {
      entry.rig.dispose();
    }
    this.avatars.clear();

    this.roomRenderer.dispose();
    this.minigameRenderer.dispose();
    this.renderer.dispose();

    if (dom.parentElement === this.container) {
      this.container.removeChild(dom);
    }
  }
}
