import * as THREE from 'three';
import {
  getCatalogItem,
  type MinigameSessionState,
  type RoomState,
} from '@handihotel/shared';

interface AnimatedMarker {
  object: THREE.Object3D;
  kind: 'pulse_ring' | 'spin_star' | 'spotlight' | 'hazard_warn' | 'chevron' | 'target';
  baseY: number;
  phase: number;
}

export class MinigameRenderer {
  public readonly root = new THREE.Group();

  private animated: AnimatedMarker[] = [];
  private activeSessionId: string | null = null;
  private lastSignature = '';

  constructor() {
    this.root.name = 'MinigameOverlayRoot';
  }

  public setSession(
    session: MinigameSessionState | null,
    room: RoomState | null = null,
    localUserId: string | null = null
  ): void {
    if (!session || session.status === 'finished') {
      if (this.activeSessionId !== null) {
        this.clear();
      }
      return;
    }

    // Build a lightweight signature so we only rebuild when layout/hazards/checkpoint changes
    const localPlayer = localUserId
      ? session.players.find((p) => p.userId === localUserId)
      : undefined;
    const hazardSig = (session.activeHazards ?? [])
      .map((h) => `${h.id}:${h.x}:${h.y}:${h.kind}`)
      .join('|');
    const sig = `${session.id}|${session.type}|${session.status}|${localPlayer?.checkpointIndex ?? -1}|${session.olympicsRound ?? ''}|${session.currentPrompt?.id ?? ''}|${hazardSig}`;

    if (sig === this.lastSignature) return;
    this.lastSignature = sig;
    this.activeSessionId = session.id;

    this.clearObjects();

    switch (session.type) {
      case 'wheelchair_racing':
        this.buildWheelchairRacing(session, localPlayer?.checkpointIndex ?? 0);
        break;
      case 'dance_battle':
        this.buildDanceBattle(session, room);
        break;
      case 'furniture_chaos':
        this.buildFurnitureChaos(session, room);
        break;
      case 'hotel_olympics':
        this.buildHotelOlympics(session, room);
        break;
    }
  }

  private buildWheelchairRacing(session: MinigameSessionState, nextCheckpointIdx: number): void {
    const checkpoints = session.checkpoints ?? [];

    checkpoints.forEach((cp, idx) => {
      const wx = cp.x + 0.5;
      const wz = cp.y + 0.5;
      const isNext = idx === nextCheckpointIdx % Math.max(1, checkpoints.length);

      if (cp.isBoostPad) {
        // Glowing green/yellow chevron boost pad overlay
        const padGroup = new THREE.Group();
        padGroup.position.set(wx, 0.08, wz);
        const chevMat = new THREE.MeshBasicMaterial({
          color: '#22C55E',
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
        });
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.52, 16), chevMat);
        ring.rotation.x = -Math.PI / 2;
        padGroup.add(ring);

        const arrow = new THREE.Mesh(
          new THREE.ConeGeometry(0.24, 0.42, 3),
          new THREE.MeshBasicMaterial({ color: '#FACC15' })
        );
        arrow.rotation.x = Math.PI / 2;
        arrow.position.y = 0.06;
        padGroup.add(arrow);

        this.root.add(padGroup);
        this.animated.push({ object: padGroup, kind: 'chevron', baseY: 0.08, phase: idx * 0.7 });
      }

      // Glowing checkpoint ring
      const ringColor = isNext ? '#FACC15' : '#38BDF8';
      const torus = new THREE.Mesh(
        new THREE.TorusGeometry(Math.max(0.65, cp.radius * 0.55), isNext ? 0.08 : 0.05, 10, 24),
        new THREE.MeshStandardMaterial({
          color: ringColor,
          emissive: new THREE.Color(ringColor),
          emissiveIntensity: isNext ? 1.5 : 0.75,
          transparent: true,
          opacity: isNext ? 0.95 : 0.55,
        })
      );
      torus.rotation.x = Math.PI / 2;
      torus.position.set(wx, isNext ? 0.42 : 0.14, wz);
      this.root.add(torus);
      this.animated.push({
        object: torus,
        kind: 'pulse_ring',
        baseY: torus.position.y,
        phase: idx * 0.6,
      });

      // Vertical beacon beam on the next active checkpoint
      if (isNext) {
        const beacon = new THREE.Mesh(
          new THREE.CylinderGeometry(0.38, 0.58, 2.6, 16, 1, true),
          new THREE.MeshBasicMaterial({
            color: '#FACC15',
            transparent: true,
            opacity: 0.16,
            side: THREE.DoubleSide,
            depthWrite: false,
          })
        );
        beacon.position.set(wx, 1.35, wz);
        this.root.add(beacon);
      }
    });

    // Finish line banner arch at checkpoint 0 (or default arena start)
    const startCp = checkpoints[0] ?? { x: 8, y: 12 };
    const archGroup = new THREE.Group();
    archGroup.position.set(startCp.x + 0.5, 0, startCp.y + 0.5);
    const poleMat = new THREE.MeshStandardMaterial({ color: '#EF4444', roughness: 0.35 });
    const bannerMat = new THREE.MeshStandardMaterial({
      color: '#F8FAFC',
      emissive: '#FACC15',
      emissiveIntensity: 0.35,
    });
    const leftPole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.6, 10), poleMat);
    leftPole.position.set(-1.1, 1.3, 0);
    const rightPole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.6, 10), poleMat);
    rightPole.position.set(1.1, 1.3, 0);
    const banner = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.42, 0.14), bannerMat);
    banner.position.set(0, 2.55, 0);
    archGroup.add(leftPole, rightPole, banner);
    this.root.add(archGroup);
  }

  private buildDanceBattle(session: MinigameSessionState, room: RoomState | null): void {
    const cx = room ? room.width / 2 : 8;
    const cz = room ? room.height * 0.42 : 6;

    const promptColorMap: Record<string, string> = {
      up: '#22C55E',
      down: '#EC4899',
      left: '#38BDF8',
      right: '#F59E0B',
      space: '#A855F7',
    };
    const activeColor = session.currentPrompt
      ? promptColorMap[session.currentPrompt.key] ?? '#EC4899'
      : '#A855F7';

    // Pulsing stage spotlight cone
    const coneGeo = new THREE.ConeGeometry(2.4, 5.2, 24, 1, true);
    coneGeo.translate(0, -2.6, 0);
    const spotlight = new THREE.Mesh(
      coneGeo,
      new THREE.MeshBasicMaterial({
        color: activeColor,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    spotlight.position.set(cx, 5.2, cz);
    this.root.add(spotlight);
    this.animated.push({ object: spotlight, kind: 'spotlight', baseY: 5.2, phase: 0 });

    // Floating rhythm ring above the dance floor
    const rhythmRing = new THREE.Mesh(
      new THREE.TorusGeometry(2.1, 0.09, 10, 32),
      new THREE.MeshStandardMaterial({
        color: activeColor,
        emissive: new THREE.Color(activeColor),
        emissiveIntensity: 1.4,
        transparent: true,
        opacity: 0.9,
      })
    );
    rhythmRing.rotation.x = Math.PI / 2;
    rhythmRing.position.set(cx, 0.25, cz);
    this.root.add(rhythmRing);
    this.animated.push({ object: rhythmRing, kind: 'pulse_ring', baseY: 0.25, phase: 0 });
  }

  private buildFurnitureChaos(session: MinigameSessionState, room: RoomState | null): void {
    const hazards = session.activeHazards ?? [];

    hazards.forEach((h, idx) => {
      const wx = h.x + 0.5;
      const wz = h.y + 0.5;

      if (h.kind === 'golden_star') {
        // Golden collectible star + glowing floor ring
        const starGroup = new THREE.Group();
        starGroup.position.set(wx, 0.65, wz);
        const star = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.32, 0),
          new THREE.MeshStandardMaterial({
            color: '#FACC15',
            emissive: '#F59E0B',
            emissiveIntensity: 1.3,
            metalness: 0.6,
            roughness: 0.2,
          })
        );
        starGroup.add(star);
        this.root.add(starGroup);
        this.animated.push({ object: starGroup, kind: 'spin_star', baseY: 0.65, phase: idx });

        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.35, 0.52, 20),
          new THREE.MeshBasicMaterial({
            color: '#FACC15',
            transparent: true,
            opacity: 0.75,
            side: THREE.DoubleSide,
          })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(wx, 0.06, wz);
        this.root.add(ring);
        this.animated.push({ object: ring, kind: 'pulse_ring', baseY: 0.06, phase: idx });
      } else {
        // Pulsing red danger warning tile + falling/rolling marker
        const warnRadius = Math.max(0.55, h.radius * 0.55);
        const warnDisc = new THREE.Mesh(
          new THREE.CircleGeometry(warnRadius, 20),
          new THREE.MeshBasicMaterial({
            color: '#EF4444',
            transparent: true,
            opacity: 0.42,
            side: THREE.DoubleSide,
            depthWrite: false,
          })
        );
        warnDisc.rotation.x = -Math.PI / 2;
        warnDisc.position.set(wx, 0.06, wz);
        this.root.add(warnDisc);
        this.animated.push({ object: warnDisc, kind: 'hazard_warn', baseY: 0.06, phase: idx * 0.8 });

        const dangerRing = new THREE.Mesh(
          new THREE.TorusGeometry(warnRadius, 0.05, 8, 20),
          new THREE.MeshBasicMaterial({ color: '#FCA5A5' })
        );
        dangerRing.rotation.x = Math.PI / 2;
        dangerRing.position.set(wx, 0.1, wz);
        this.root.add(dangerRing);
      }
    });

    // Golden glow rings around safe sittable chairs in the room
    if (room) {
      let safeCount = 0;
      for (const furni of room.furniture) {
        const item = getCatalogItem(furni.catalogItemId);
        if (!item?.sittable) continue;
        safeCount++;
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.62, 0.055, 8, 20),
          new THREE.MeshStandardMaterial({
            color: '#FACC15',
            emissive: '#EAB308',
            emissiveIntensity: 1.1,
            transparent: true,
            opacity: 0.85,
          })
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.set(furni.x + 0.5, 0.12, furni.y + 0.5);
        this.root.add(ring);
        this.animated.push({ object: ring, kind: 'pulse_ring', baseY: 0.12, phase: safeCount * 0.5 });
      }
    }
  }

  private buildHotelOlympics(session: MinigameSessionState, room: RoomState | null): void {
    const round = session.olympicsRound ?? 'sprint';
    const w = room?.width ?? 20;
    const h = room?.height ?? 16;

    if (round === 'target_toss') {
      // 3 glowing bullseye target markers
      const targets: Array<[number, number]> = [
        [w * 0.3, h * 0.35],
        [w * 0.5, h * 0.5],
        [w * 0.7, h * 0.35],
      ];
      targets.forEach(([tx, tz], idx) => {
        const group = new THREE.Group();
        group.position.set(tx, 0.08, tz);
        const outer = new THREE.Mesh(
          new THREE.RingGeometry(0.55, 0.8, 24),
          new THREE.MeshBasicMaterial({ color: '#EF4444', side: THREE.DoubleSide })
        );
        outer.rotation.x = -Math.PI / 2;
        const mid = new THREE.Mesh(
          new THREE.RingGeometry(0.28, 0.55, 24),
          new THREE.MeshBasicMaterial({ color: '#F8FAFC', side: THREE.DoubleSide })
        );
        mid.rotation.x = -Math.PI / 2;
        mid.position.y = 0.01;
        const bull = new THREE.Mesh(
          new THREE.CircleGeometry(0.28, 20),
          new THREE.MeshBasicMaterial({ color: '#FACC15', side: THREE.DoubleSide })
        );
        bull.rotation.x = -Math.PI / 2;
        bull.position.y = 0.02;
        group.add(outer, mid, bull);
        this.root.add(group);
        this.animated.push({ object: group, kind: 'target', baseY: 0.08, phase: idx });
      });
    } else {
      // Sprint hurdles or Slalom gates
      const hurdleColor = round === 'slalom' ? '#06B6D4' : '#F97316';
      const points =
        session.checkpoints && session.checkpoints.length > 0
          ? session.checkpoints.map((c) => [c.x + 0.5, c.y + 0.5] as [number, number])
          : ([
              [w * 0.25, h * 0.65],
              [w * 0.45, h * 0.45],
              [w * 0.65, h * 0.65],
              [w * 0.75, h * 0.35],
            ] as [number, number][]);

      const postMat = new THREE.MeshStandardMaterial({
        color: hurdleColor,
        emissive: new THREE.Color(hurdleColor),
        emissiveIntensity: 0.65,
      });
      const barMat = new THREE.MeshStandardMaterial({ color: '#F8FAFC', roughness: 0.3 });

      points.forEach(([px, pz], idx) => {
        const hurdle = new THREE.Group();
        hurdle.position.set(px, 0, pz);
        const l = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 8), postMat);
        l.position.set(-0.6, 0.45, 0);
        const r = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 8), postMat);
        r.position.set(0.6, 0.45, 0);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 0.08), barMat);
        bar.position.set(0, 0.85, 0);
        hurdle.add(l, r, bar);
        this.root.add(hurdle);
        this.animated.push({ object: hurdle, kind: 'pulse_ring', baseY: 0, phase: idx });
      });
    }
  }

  public update(elapsedTime: number, delta: number): void {
    for (const item of this.animated) {
      const t = elapsedTime + item.phase;
      switch (item.kind) {
        case 'pulse_ring': {
          const s = 1 + Math.sin(t * 4.5) * 0.08;
          item.object.scale.set(s, s, 1);
          break;
        }
        case 'spin_star': {
          item.object.rotation.y += delta * 2.4;
          item.object.position.y = item.baseY + Math.sin(t * 3.5) * 0.12;
          break;
        }
        case 'spotlight': {
          item.object.rotation.z = Math.sin(t * 2.2) * 0.16;
          item.object.rotation.x = Math.cos(t * 1.8) * 0.12;
          break;
        }
        case 'hazard_warn': {
          const s = 0.85 + Math.abs(Math.sin(t * 7)) * 0.28;
          item.object.scale.set(s, s, 1);
          break;
        }
        case 'chevron': {
          item.object.position.y = item.baseY + Math.abs(Math.sin(t * 5)) * 0.06;
          break;
        }
        case 'target': {
          const s = 0.95 + Math.sin(t * 4) * 0.08;
          item.object.scale.set(s, 1, s);
          break;
        }
      }
    }
  }

  private clearObjects(): void {
    while (this.root.children.length > 0) {
      const child = this.root.children[0];
      child.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const m = obj as THREE.Mesh;
          m.geometry.dispose();
          if (Array.isArray(m.material)) {
            m.material.forEach((mat) => mat.dispose());
          } else {
            m.material.dispose();
          }
        }
      });
      this.root.remove(child);
    }
    this.animated = [];
  }

  public clear(): void {
    this.clearObjects();
    this.activeSessionId = null;
    this.lastSignature = '';
  }

  public dispose(): void {
    this.clear();
  }
}
