import * as THREE from 'three';
import type { CatalogItem } from '@handihotel/shared';

// ============================================================================
// Shared Geometry & Material Caches (for 60 FPS performance & low memory)
// ============================================================================

const geomCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<string, THREE.Material>();

function getBox(w: number, h: number, d: number): THREE.BoxGeometry {
  const key = `box:${w.toFixed(3)}:${h.toFixed(3)}:${d.toFixed(3)}`;
  let g = geomCache.get(key) as THREE.BoxGeometry | undefined;
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    geomCache.set(key, g);
  }
  return g;
}

function getCyl(rt: number, rb: number, h: number, seg = 12): THREE.CylinderGeometry {
  const key = `cyl:${rt.toFixed(3)}:${rb.toFixed(3)}:${h.toFixed(3)}:${seg}`;
  let g = geomCache.get(key) as THREE.CylinderGeometry | undefined;
  if (!g) {
    g = new THREE.CylinderGeometry(rt, rb, h, seg);
    geomCache.set(key, g);
  }
  return g;
}

function getSphere(r: number, ws = 12, hs = 10): THREE.SphereGeometry {
  const key = `sph:${r.toFixed(3)}:${ws}:${hs}`;
  let g = geomCache.get(key) as THREE.SphereGeometry | undefined;
  if (!g) {
    g = new THREE.SphereGeometry(r, ws, hs);
    geomCache.set(key, g);
  }
  return g;
}

function getCone(r: number, h: number, seg = 10): THREE.ConeGeometry {
  const key = `cone:${r.toFixed(3)}:${h.toFixed(3)}:${seg}`;
  let g = geomCache.get(key) as THREE.ConeGeometry | undefined;
  if (!g) {
    g = new THREE.ConeGeometry(r, h, seg);
    geomCache.set(key, g);
  }
  return g;
}

function getTorus(r: number, tube: number, rs = 8, ts = 16): THREE.TorusGeometry {
  const key = `tor:${r.toFixed(3)}:${tube.toFixed(3)}:${rs}:${ts}`;
  let g = geomCache.get(key) as THREE.TorusGeometry | undefined;
  if (!g) {
    g = new THREE.TorusGeometry(r, tube, rs, ts);
    geomCache.set(key, g);
  }
  return g;
}

function getStdMat(
  color: string | number,
  opts?: {
    roughness?: number;
    metalness?: number;
    emissive?: string | number;
    emissiveIntensity?: number;
    transparent?: boolean;
    opacity?: number;
    flatShading?: boolean;
  }
): THREE.MeshStandardMaterial {
  const cHex = typeof color === 'number' ? color.toString(16) : color;
  const eHex = opts?.emissive !== undefined
    ? typeof opts.emissive === 'number'
      ? opts.emissive.toString(16)
      : opts.emissive
    : 'none';
  const key = `std:${cHex}:${opts?.roughness ?? 0.65}:${opts?.metalness ?? 0.08}:${eHex}:${opts?.emissiveIntensity ?? 0}:${opts?.transparent ? 1 : 0}:${opts?.opacity ?? 1}:${opts?.flatShading ? 1 : 0}`;
  let m = matCache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts?.roughness ?? 0.65,
      metalness: opts?.metalness ?? 0.08,
      emissive: opts?.emissive !== undefined ? new THREE.Color(opts.emissive) : undefined,
      emissiveIntensity: opts?.emissiveIntensity ?? 0,
      transparent: opts?.transparent ?? false,
      opacity: opts?.opacity ?? 1,
      flatShading: opts?.flatShading ?? false,
    });
    matCache.set(key, m);
  }
  return m;
}

function addPart(
  parent: THREE.Object3D,
  geom: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  opts?: {
    rx?: number;
    ry?: number;
    rz?: number;
    sx?: number;
    sy?: number;
    sz?: number;
    castShadow?: boolean;
    receiveShadow?: boolean;
    name?: string;
  }
): THREE.Mesh {
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(x, y, z);
  if (opts?.rx) mesh.rotation.x = opts.rx;
  if (opts?.ry) mesh.rotation.y = opts.ry;
  if (opts?.rz) mesh.rotation.z = opts.rz;
  if (opts?.sx !== undefined || opts?.sy !== undefined || opts?.sz !== undefined) {
    mesh.scale.set(opts?.sx ?? 1, opts?.sy ?? 1, opts?.sz ?? 1);
  }
  mesh.castShadow = opts?.castShadow ?? true;
  mesh.receiveShadow = opts?.receiveShadow ?? true;
  if (opts?.name) mesh.name = opts.name;
  parent.add(mesh);
  return mesh;
}

function shadeColor(hex: string, factor: number): string {
  const c = new THREE.Color(hex);
  c.multiplyScalar(factor);
  return `#${c.getHexString()}`;
}

function isStateActive(state?: string | Record<string, unknown>, defaultOn = true): boolean {
  if (state === undefined || state === null) return defaultOn;
  if (typeof state === 'string') {
    const s = state.toLowerCase();
    if (s === 'off' || s === 'false' || s === '0' || s === 'closed') return false;
    if (s === 'on' || s === 'true' || s === '1' || s === 'open' || s === 'playing' || s === 'bubbles') return true;
    return defaultOn;
  }
  if ('on' in state) return Boolean(state.on);
  if ('playing' in state) return Boolean(state.playing);
  if ('bubbles' in state) return Boolean(state.bubbles);
  if ('open' in state) return Boolean(state.open);
  if ('active' in state) return Boolean(state.active);
  return defaultOn;
}

function getDiceValue(state?: string | Record<string, unknown>): number {
  if (!state) return 6;
  if (typeof state === 'string') {
    const n = parseInt(state, 10);
    return Number.isFinite(n) && n >= 1 && n <= 6 ? n : 6;
  }
  const v = Number(state.value ?? 6);
  return Number.isFinite(v) && v >= 1 && v <= 6 ? v : 6;
}

// ============================================================================
// Individual Multi-Part Furniture Builders
// ============================================================================

function buildSofa(group: THREE.Group, item: CatalogItem): void {
  const w = item.width;
  const primary = getStdMat(item.primaryColor, { roughness: 0.78 });
  const cushion = getStdMat(shadeColor(item.primaryColor, 1.14), { roughness: 0.82 });
  const accent = getStdMat(item.accentColor, { roughness: 0.4, metalness: 0.35 });
  const wood = getStdMat('#451A03', { roughness: 0.6 });

  // 4 short wooden feet
  const footX = w / 2 - 0.14;
  for (const fx of [-footX, footX]) {
    for (const fz of [-0.34, 0.34]) {
      addPart(group, getCyl(0.045, 0.035, 0.12, 8), wood, fx, 0.06, fz);
    }
  }
  // Base frame
  addPart(group, getBox(w - 0.12, 0.2, 0.84), primary, 0, 0.22, 0);
  // Decorative trim strip
  addPart(group, getBox(w - 0.1, 0.045, 0.86), accent, 0, 0.15, 0);
  // Two plush seat cushions
  const cushCount = Math.max(2, Math.round(w));
  const cushW = (w - 0.38) / cushCount;
  for (let i = 0; i < cushCount; i++) {
    const cx = -((cushCount - 1) * cushW) / 2 + i * cushW;
    addPart(group, getBox(cushW - 0.04, 0.16, 0.62), cushion, cx, 0.39, 0.06);
  }
  // Backrest with tufted look
  addPart(group, getBox(w - 0.14, 0.56, 0.22), primary, 0, 0.6, -0.31);
  // Backrest top piping / pillows
  for (let i = 0; i < cushCount; i++) {
    const cx = -((cushCount - 1) * cushW) / 2 + i * cushW;
    addPart(group, getBox(cushW - 0.06, 0.38, 0.14), cushion, cx, 0.64, -0.19);
  }
  // Rolled armrests
  for (const sx of [-1, 1]) {
    const ax = sx * (w / 2 - 0.13);
    addPart(group, getBox(0.18, 0.42, 0.82), primary, ax, 0.48, 0);
    addPart(group, getCyl(0.095, 0.095, 0.82, 10), cushion, ax, 0.68, 0, { rx: Math.PI / 2 });
    // Accent pillow on one side
    addPart(group, getBox(0.14, 0.24, 0.24), accent, sx * (w / 2 - 0.28), 0.56, -0.08, { rz: sx * 0.22 });
  }
}

function buildChair(group: THREE.Group, item: CatalogItem): void {
  if (item.id === 'pool_lift_chair') {
    buildPoolLiftChair(group, item);
    return;
  }
  const frame = getStdMat(item.primaryColor, { roughness: 0.5 });
  const cushion = getStdMat(item.accentColor, { roughness: 0.8 });
  // 4 legs
  for (const lx of [-0.24, 0.24]) {
    for (const lz of [-0.24, 0.24]) {
      addPart(group, getCyl(0.03, 0.025, 0.44, 8), frame, lx, 0.22, lz);
    }
  }
  // Cross braces
  addPart(group, getBox(0.46, 0.03, 0.03), frame, 0, 0.16, 0);
  addPart(group, getBox(0.03, 0.03, 0.46), frame, 0, 0.16, 0);
  // Seat + cushion
  addPart(group, getBox(0.56, 0.06, 0.56), frame, 0, 0.45, 0);
  addPart(group, getBox(0.48, 0.08, 0.48), cushion, 0, 0.51, 0.02);
  // Backrest posts + curved slat
  addPart(group, getCyl(0.026, 0.026, 0.46, 8), frame, -0.23, 0.68, -0.24);
  addPart(group, getCyl(0.026, 0.026, 0.46, 8), frame, 0.23, 0.68, -0.24);
  addPart(group, getBox(0.52, 0.14, 0.05), frame, 0, 0.84, -0.24);
  addPart(group, getBox(0.42, 0.12, 0.04), cushion, 0, 0.66, -0.24);
}

function buildPoolLiftChair(group: THREE.Group, item: CatalogItem): void {
  const metal = getStdMat(item.accentColor, { roughness: 0.25, metalness: 0.75 });
  const seat = getStdMat(item.primaryColor, { roughness: 0.55 });
  // Deck anchor plate
  addPart(group, getCyl(0.24, 0.26, 0.06, 12), metal, 0, 0.03, -0.22);
  // Vertical hydraulic mast
  addPart(group, getCyl(0.06, 0.07, 1.25, 10), metal, 0, 0.65, -0.22);
  // Swivel arm
  addPart(group, getBox(0.09, 0.09, 0.52), metal, 0, 1.05, 0.02, { rx: 0.35 });
  // Hanging support bar
  addPart(group, getCyl(0.035, 0.035, 0.5, 8), metal, 0, 0.76, 0.18);
  // Molded sling seat & backrest
  addPart(group, getBox(0.52, 0.07, 0.46), seat, 0, 0.48, 0.16);
  addPart(group, getBox(0.5, 0.42, 0.07), seat, 0, 0.7, -0.05);
  // Flip-down armrests
  for (const sx of [-0.26, 0.26]) {
    addPart(group, getBox(0.05, 0.05, 0.38), metal, sx, 0.64, 0.14);
  }
}

function buildStool(group: THREE.Group, item: CatalogItem): void {
  const chrome = getStdMat(item.accentColor, { roughness: 0.2, metalness: 0.85 });
  const seat = getStdMat(item.primaryColor, { roughness: 0.45 });
  const neon = getStdMat(item.primaryColor, {
    emissive: item.primaryColor,
    emissiveIntensity: 0.7,
    roughness: 0.3,
  });
  // Weighted chrome base
  addPart(group, getCyl(0.24, 0.28, 0.05, 16), chrome, 0, 0.025, 0);
  // Central hydraulic post
  addPart(group, getCyl(0.045, 0.05, 0.72, 12), chrome, 0, 0.4, 0);
  // Footrest ring
  addPart(group, getTorus(0.2, 0.02, 8, 18), chrome, 0, 0.28, 0, { rx: Math.PI / 2 });
  // Padded round seat + neon trim ring
  addPart(group, getCyl(0.26, 0.24, 0.14, 16), seat, 0, 0.82, 0);
  addPart(group, getTorus(0.255, 0.022, 8, 18), neon, 0, 0.78, 0, { rx: Math.PI / 2 });
}

function buildBeanbag(group: THREE.Group, item: CatalogItem): void {
  const primary = getStdMat(item.primaryColor, { roughness: 0.9 });
  const accent = getStdMat(item.accentColor, { roughness: 0.85 });
  // Squashed plush body
  addPart(group, getSphere(0.42, 14, 12), primary, 0, 0.26, 0.02, { sx: 1.05, sy: 0.66, sz: 1.05 });
  // Raised back mound
  addPart(group, getSphere(0.32, 12, 10), primary, 0, 0.44, -0.14, { sx: 0.95, sy: 0.9, sz: 0.85 });
  // Soft center dimple cushion
  addPart(group, getCyl(0.24, 0.28, 0.08, 12), accent, 0, 0.4, 0.1);
  // Top tag/tuft
  addPart(group, getCone(0.08, 0.14, 8), accent, 0, 0.72, -0.18);
}

function buildThrone(group: THREE.Group, item: CatalogItem): void {
  const gold = getStdMat(item.primaryColor, { roughness: 0.25, metalness: 0.8 });
  const velvet = getStdMat(item.accentColor, { roughness: 0.82 });
  const gem = getStdMat('#38BDF8', { emissive: '#0EA5E9', emissiveIntensity: 0.8, roughness: 0.15 });
  // Ornate stepped pedestal base
  addPart(group, getBox(0.86, 0.12, 0.86), gold, 0, 0.06, 0);
  addPart(group, getBox(0.76, 0.3, 0.74), gold, 0, 0.27, 0);
  // Velvet seat cushion
  addPart(group, getBox(0.62, 0.14, 0.58), velvet, 0, 0.48, 0.04);
  // High ornate backrest
  addPart(group, getBox(0.72, 1.05, 0.16), gold, 0, 0.96, -0.28);
  addPart(group, getBox(0.54, 0.82, 0.1), velvet, 0, 0.92, -0.2);
  // Crown crest at top
  addPart(group, getCone(0.14, 0.26, 6), gold, 0, 1.58, -0.28);
  addPart(group, getCone(0.09, 0.18, 6), gold, -0.22, 1.54, -0.28);
  addPart(group, getCone(0.09, 0.18, 6), gold, 0.22, 1.54, -0.28);
  addPart(group, getSphere(0.065, 10, 8), gem, 0, 1.44, -0.2);
  // Armrests with lion-style orb finials
  for (const sx of [-0.34, 0.34]) {
    addPart(group, getBox(0.12, 0.34, 0.66), gold, sx, 0.58, 0.02);
    addPart(group, getSphere(0.08, 10, 8), gold, sx, 0.76, 0.34);
  }
}

function buildBench(group: THREE.Group, item: CatalogItem): void {
  const w = item.width;
  const primary = getStdMat(item.primaryColor, { roughness: 0.65 });
  const accent = getStdMat(item.accentColor, { roughness: 0.35, metalness: 0.2 });

  if (item.id === 'bleacher_seat') {
    // 2-tier arena spectator bleacher
    const metal = getStdMat('#64748B', { roughness: 0.35, metalness: 0.65 });
    for (const lx of [-w / 2 + 0.18, 0, w / 2 - 0.18]) {
      addPart(group, getBox(0.08, 0.38, 0.86), metal, lx, 0.19, 0);
      addPart(group, getBox(0.08, 0.32, 0.42), metal, lx, 0.52, -0.22);
    }
    addPart(group, getBox(w - 0.08, 0.08, 0.38), primary, 0, 0.42, 0.22);
    addPart(group, getBox(w - 0.08, 0.08, 0.38), primary, 0, 0.72, -0.22);
    addPart(group, getBox(w - 0.08, 0.03, 0.06), accent, 0, 0.47, 0.38);
    addPart(group, getBox(w - 0.08, 0.03, 0.06), accent, 0, 0.77, -0.06);
    return;
  }

  // Grand marble-framed lobby bench
  for (const lx of [-w / 2 + 0.18, w / 2 - 0.18]) {
    addPart(group, getBox(0.16, 0.42, 0.7), accent, lx, 0.21, 0);
  }
  addPart(group, getBox(w - 0.12, 0.08, 0.72), accent, 0, 0.42, 0);
  // Tufted upholstered cushion
  addPart(group, getBox(w - 0.2, 0.16, 0.66), primary, 0, 0.54, 0);
  // Decorative gold studs
  const gold = getStdMat('#FACC15', { roughness: 0.3, metalness: 0.8 });
  for (let i = -2; i <= 2; i++) {
    addPart(group, getSphere(0.03, 8, 6), gold, i * 0.32, 0.62, 0);
  }
}

function buildTableLow(group: THREE.Group, item: CatalogItem): void {
  const w = item.width;
  const wood = getStdMat(item.primaryColor, { roughness: 0.55 });
  const trim = getStdMat(item.accentColor, { roughness: 0.45 });
  // 4 tapered legs
  for (const lx of [-w / 2 + 0.14, w / 2 - 0.14]) {
    for (const lz of [-0.34, 0.34]) {
      addPart(group, getBox(0.08, 0.44, 0.08), wood, lx, 0.22, lz);
    }
  }
  // Lower magazine shelf
  addPart(group, getBox(w - 0.32, 0.04, 0.62), trim, 0, 0.16, 0);
  // Thick tabletop
  addPart(group, getBox(w - 0.1, 0.08, 0.84), wood, 0, 0.46, 0);
  addPart(group, getBox(w - 0.26, 0.02, 0.68), trim, 0, 0.505, 0);
}

function buildTableRound(group: THREE.Group, item: CatalogItem): void {
  const isGlass = item.id === 'glass_side_table';
  const topMat = isGlass
    ? getStdMat(item.primaryColor, { roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.65 })
    : getStdMat(item.primaryColor, { roughness: 0.75 });
  const baseMat = getStdMat(item.accentColor, { roughness: 0.4, metalness: isGlass ? 0.7 : 0.2 });

  const h = item.height;
  // Pedestal foot + column
  addPart(group, getCyl(0.24, 0.28, 0.05, 16), baseMat, 0, 0.025, 0);
  addPart(group, getCyl(0.05, 0.065, h - 0.1, 12), baseMat, 0, (h - 0.1) / 2 + 0.04, 0);
  // Tabletop
  addPart(group, getCyl(0.45, 0.45, 0.06, 18), topMat, 0, h - 0.03, 0);
  if (!isGlass) {
    // Draped tablecloth skirt + small candle centerpiece
    addPart(group, getCyl(0.44, 0.48, 0.2, 16), topMat, 0, h - 0.14, 0);
    addPart(group, getCyl(0.04, 0.04, 0.14, 8), baseMat, 0, h + 0.07, 0);
    const flame = getStdMat('#FACC15', { emissive: '#F59E0B', emissiveIntensity: 1.2 });
    addPart(group, getSphere(0.035, 8, 8), flame, 0, h + 0.16, 0);
  } else {
    // Chrome rim
    addPart(group, getTorus(0.45, 0.018, 8, 20), baseMat, 0, h - 0.03, 0, { rx: Math.PI / 2 });
  }
}

function buildTableLong(group: THREE.Group, item: CatalogItem): void {
  const w = item.width;
  const cloth = getStdMat(item.primaryColor, { roughness: 0.8 });
  const runner = getStdMat(item.accentColor, { roughness: 0.6 });
  const gold = getStdMat('#FACC15', { roughness: 0.25, metalness: 0.85 });
  // Draped banquet cloth body
  addPart(group, getBox(w - 0.12, 0.76, 0.86), cloth, 0, 0.38, 0);
  // Top surface & decorative runner
  addPart(group, getBox(w - 0.08, 0.08, 0.9), cloth, 0, 0.8, 0);
  addPart(group, getBox(w - 0.06, 0.02, 0.32), runner, 0, 0.845, 0);
  // Gold candelabra & plates
  addPart(group, getCyl(0.04, 0.08, 0.22, 8), gold, 0, 0.95, 0);
  addPart(group, getBox(0.32, 0.03, 0.03), gold, 0, 1.05, 0);
  const plateMat = getStdMat('#F8FAFC', { roughness: 0.2 });
  for (const px of [-w / 3, 0, w / 3]) {
    addPart(group, getCyl(0.11, 0.09, 0.02, 12), plateMat, px, 0.86, 0.28);
    addPart(group, getCyl(0.11, 0.09, 0.02, 12), plateMat, px, 0.86, -0.28);
  }
}

function buildCounter(group: THREE.Group, item: CatalogItem): void {
  const w = item.width;
  const isKitchen = item.id === 'kitchen_pass';
  const body = getStdMat(item.primaryColor, { roughness: isKitchen ? 0.3 : 0.45, metalness: isKitchen ? 0.65 : 0.2 });
  const accent = getStdMat(item.accentColor, {
    emissive: isKitchen ? '#000000' : item.accentColor,
    emissiveIntensity: isKitchen ? 0 : 0.85,
    roughness: 0.3,
  });
  // Main cabinet
  addPart(group, getBox(w - 0.1, 0.96, 0.78), body, 0, 0.48, 0);
  // Overhanging counter top
  addPart(group, getBox(w - 0.04, 0.1, 0.92), getStdMat('#F8FAFC', { roughness: 0.25 }), 0, 1.01, 0.02);
  // Front neon / trim strip
  addPart(group, getBox(w - 0.14, 0.07, 0.05), accent, 0, 0.82, 0.4);
  addPart(group, getBox(w - 0.14, 0.05, 0.05), accent, 0, 0.14, 0.4);

  if (isKitchen) {
    // Serving domes & heat lamp bar
    const steel = getStdMat('#E2E8F0', { roughness: 0.2, metalness: 0.85 });
    for (const dx of [-0.45, 0.45]) {
      addPart(group, getSphere(0.18, 12, 8), steel, dx, 1.08, 0, { sy: 0.6 });
      addPart(group, getSphere(0.03, 8, 6), steel, dx, 1.2, 0);
    }
    // Overhead heat-lamp rail
    addPart(group, getCyl(0.025, 0.025, 0.55, 8), steel, -w / 2 + 0.14, 1.32, -0.2);
    addPart(group, getCyl(0.025, 0.025, 0.55, 8), steel, w / 2 - 0.14, 1.32, -0.2);
    addPart(group, getBox(w - 0.24, 0.06, 0.14), accent, 0, 1.58, -0.2);
  } else {
    // Colorful cocktail bottles & shaker on neon bar
    const bottleColors = ['#EC4899', '#22C55E', '#38BDF8', '#FACC15'];
    bottleColors.forEach((col, i) => {
      const bx = -0.55 + i * 0.36;
      const bMat = getStdMat(col, { roughness: 0.2, transparent: true, opacity: 0.85 });
      addPart(group, getCyl(0.045, 0.05, 0.22, 8), bMat, bx, 1.17, -0.15);
      addPart(group, getCyl(0.018, 0.025, 0.09, 8), bMat, bx, 1.32, -0.15);
    });
  }
}

function buildDesk(group: THREE.Group, item: CatalogItem): void {
  const w = item.width;
  const wood = getStdMat(item.primaryColor, { roughness: 0.48 });
  const gold = getStdMat(item.accentColor, { roughness: 0.25, metalness: 0.82 });
  const marble = getStdMat('#F8FAFC', { roughness: 0.25 });
  const screen = getStdMat('#38BDF8', { emissive: '#0EA5E9', emissiveIntensity: 0.7 });
  // Mahogany desk body with paneled front
  addPart(group, getBox(w - 0.1, 1.0, 0.82), wood, 0, 0.5, 0);
  for (let i = -1; i <= 1; i++) {
    addPart(group, getBox(0.76, 0.62, 0.04), gold, i * 0.9, 0.5, 0.42);
    addPart(group, getBox(0.68, 0.54, 0.05), wood, i * 0.9, 0.5, 0.43);
  }
  // Marble counter top
  addPart(group, getBox(w - 0.04, 0.1, 0.94), marble, 0, 1.05, 0.02);
  // Brass concierge bell
  addPart(group, getCyl(0.09, 0.11, 0.03, 12), getStdMat('#1E293B'), 0.65, 1.115, 0.22);
  addPart(group, getSphere(0.085, 12, 8), gold, 0.65, 1.13, 0.22, { sy: 0.65 });
  addPart(group, getCyl(0.02, 0.02, 0.04, 8), gold, 0.65, 1.2, 0.22);
  // Check-in monitor
  addPart(group, getBox(0.42, 0.3, 0.05), getStdMat('#1E293B'), -0.55, 1.32, -0.05, { ry: 0.2 });
  addPart(group, getBox(0.36, 0.24, 0.02), screen, -0.55, 1.32, -0.02, { ry: 0.2 });
  addPart(group, getCyl(0.04, 0.08, 0.14, 8), getStdMat('#334155'), -0.55, 1.16, -0.05);
  // Guestbook ledger
  addPart(group, getBox(0.34, 0.04, 0.24), getStdMat('#991B1B'), 0.1, 1.12, 0.18);
}

function buildLampFloor(group: THREE.Group, item: CatalogItem, active: boolean): void {
  const pole = getStdMat(item.accentColor, { roughness: 0.35, metalness: 0.6 });
  const shade = getStdMat(item.primaryColor, {
    emissive: active ? item.primaryColor : '#000000',
    emissiveIntensity: active ? 0.95 : 0,
    roughness: 0.4,
  });

  if (item.id === 'chandelier_pillar') {
    // Gilded ballroom crystal torch column
    addPart(group, getCyl(0.24, 0.3, 0.16, 12), pole, 0, 0.08, 0);
    addPart(group, getCyl(0.11, 0.14, 1.45, 10), pole, 0, 0.88, 0);
    addPart(group, getCyl(0.26, 0.14, 0.18, 12), pole, 0, 1.66, 0);
    // Glowing crystal bowl + orbs
    addPart(group, getSphere(0.22, 12, 10), shade, 0, 1.88, 0, { name: 'glow_part' });
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      addPart(group, getSphere(0.075, 8, 8), shade, Math.cos(a) * 0.26, 1.78, Math.sin(a) * 0.26);
    }
  } else if (item.id === 'string_light_post') {
    // Rooftop lantern post with hanging warm lantern
    addPart(group, getBox(0.32, 0.12, 0.32), pole, 0, 0.06, 0);
    addPart(group, getCyl(0.045, 0.055, 1.85, 8), pole, 0, 0.98, 0);
    addPart(group, getBox(0.36, 0.05, 0.05), pole, 0.14, 1.88, 0);
    addPart(group, getCyl(0.12, 0.14, 0.26, 8), shade, 0.28, 1.68, 0, { name: 'glow_part' });
    addPart(group, getCone(0.17, 0.1, 8), pole, 0.28, 1.85, 0);
  } else {
    // Cozy floor lamp with fabric lampshade
    addPart(group, getCyl(0.22, 0.25, 0.06, 14), pole, 0, 0.03, 0);
    addPart(group, getCyl(0.035, 0.04, 1.4, 10), pole, 0, 0.74, 0);
    addPart(group, getCyl(0.16, 0.28, 0.38, 14), shade, 0, 1.56, 0, { name: 'glow_part' });
  }
}

function buildLavaLamp(group: THREE.Group, item: CatalogItem, active: boolean): void {
  const metal = getStdMat('#94A3B8', { roughness: 0.25, metalness: 0.85 });
  const glass = getStdMat(item.accentColor, {
    roughness: 0.15,
    transparent: true,
    opacity: 0.55,
    emissive: active ? item.accentColor : '#000000',
    emissiveIntensity: active ? 0.35 : 0,
  });
  const blobMat = getStdMat(item.primaryColor, {
    emissive: active ? item.primaryColor : '#000000',
    emissiveIntensity: active ? 1.1 : 0,
    roughness: 0.2,
  });
  // Base cone + cap
  addPart(group, getCyl(0.1, 0.2, 0.22, 12), metal, 0, 0.11, 0);
  addPart(group, getCyl(0.11, 0.16, 0.46, 12), glass, 0, 0.44, 0);
  addPart(group, getCone(0.11, 0.16, 12), metal, 0, 0.75, 0);
  // Floating lava blobs (animated)
  const b1 = addPart(group, getSphere(0.065, 10, 8), blobMat, -0.02, 0.36, 0.01, { name: 'lava_blob_1' });
  const b2 = addPart(group, getSphere(0.05, 10, 8), blobMat, 0.03, 0.52, -0.02, { name: 'lava_blob_2' });
  group.userData.animType = active ? 'lava' : undefined;
  group.userData.animTargets = [b1, b2];
}

function buildNeonPillar(group: THREE.Group, item: CatalogItem, active: boolean): void {
  const frame = getStdMat('#0F172A', { roughness: 0.35, metalness: 0.6 });
  const neon1 = getStdMat(item.primaryColor, {
    emissive: active ? item.primaryColor : '#000000',
    emissiveIntensity: active ? 1.35 : 0,
  });
  const neon2 = getStdMat(item.accentColor, {
    emissive: active ? item.accentColor : '#000000',
    emissiveIntensity: active ? 1.35 : 0,
  });
  // Stand + board
  addPart(group, getCyl(0.2, 0.24, 0.08, 12), frame, 0, 0.04, 0);
  addPart(group, getCyl(0.04, 0.04, 0.9, 8), frame, 0, 0.5, 0);
  addPart(group, getBox(0.76, 0.52, 0.1), frame, 0, 1.18, 0);
  // Glowing neon border tubes
  addPart(group, getBox(0.72, 0.045, 0.12), neon1, 0, 1.42, 0);
  addPart(group, getBox(0.72, 0.045, 0.12), neon1, 0, 0.94, 0);
  addPart(group, getBox(0.045, 0.48, 0.12), neon1, -0.34, 1.18, 0);
  addPart(group, getBox(0.045, 0.48, 0.12), neon1, 0.34, 1.18, 0);
  // Stylized glowing inner bars ("OPEN")
  addPart(group, getBox(0.48, 0.1, 0.13), neon2, 0, 1.24, 0);
  addPart(group, getBox(0.32, 0.08, 0.13), neon2, 0, 1.09, 0);
}

function buildDiscoTower(group: THREE.Group, item: CatalogItem, active: boolean): void {
  const stand = getStdMat('#1E293B', { roughness: 0.35, metalness: 0.7 });
  const mirror = getStdMat(item.primaryColor, {
    roughness: 0.12,
    metalness: 0.95,
    emissive: active ? item.accentColor : '#000000',
    emissiveIntensity: active ? 0.5 : 0,
    flatShading: true,
  });
  const glow = getStdMat(item.accentColor, {
    emissive: active ? item.accentColor : '#000000',
    emissiveIntensity: active ? 1.2 : 0,
  });
  // Tripod base + truss pole
  addPart(group, getCyl(0.28, 0.34, 0.1, 12), stand, 0, 0.05, 0);
  addPart(group, getCyl(0.045, 0.055, 1.7, 10), stand, 0, 0.92, 0);
  addPart(group, getTorus(0.22, 0.025, 8, 16), glow, 0, 1.72, 0, { rx: Math.PI / 2 });
  // Spinning disco ball
  const ball = addPart(group, getSphere(0.26, 12, 10), mirror, 0, 2.02, 0, { name: 'disco_ball' });
  group.userData.animType = active ? 'spin' : undefined;
  group.userData.animTargets = [ball];
}

function buildPlantPalm(group: THREE.Group, item: CatalogItem): void {
  const pot = getStdMat(item.accentColor, { roughness: 0.75 });
  const soil = getStdMat('#3F2718', { roughness: 0.95 });
  const trunk = getStdMat('#78350F', { roughness: 0.85 });
  const leaf = getStdMat(item.primaryColor, { roughness: 0.65 });
  const leafLight = getStdMat(shadeColor(item.primaryColor, 1.2), { roughness: 0.65 });
  // Terracotta pot + rim + soil
  addPart(group, getCyl(0.26, 0.2, 0.44, 12), pot, 0, 0.22, 0);
  addPart(group, getCyl(0.29, 0.28, 0.08, 12), pot, 0, 0.44, 0);
  addPart(group, getCyl(0.24, 0.24, 0.04, 12), soil, 0, 0.46, 0);
  // Segmented palm trunk
  addPart(group, getCyl(0.06, 0.08, 0.75, 8), trunk, 0, 0.82, 0);
  // 7 arching palm fronds
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2;
    const mat = i % 2 === 0 ? leaf : leafLight;
    const frond = new THREE.Group();
    frond.position.set(0, 1.2, 0);
    frond.rotation.y = angle;
    addPart(frond, getBox(0.16, 0.035, 0.56), mat, 0, 0.14, 0.26, { rx: -0.45 });
    addPart(frond, getBox(0.12, 0.03, 0.34), mat, 0, 0.18, 0.62, { rx: 0.28 });
    group.add(frond);
  }
}

function buildDuck(group: THREE.Group, item: CatalogItem): void {
  const yellow = getStdMat(item.primaryColor, { roughness: 0.35 });
  const beak = getStdMat(item.accentColor, { roughness: 0.4 });
  const eye = getStdMat('#0F172A', { roughness: 0.2 });

  const duckBody = new THREE.Group();
  // Round floating body
  addPart(duckBody, getSphere(0.36, 14, 12), yellow, 0, 0.34, 0, { sx: 1.0, sy: 0.85, sz: 1.22 });
  // Tail tip
  addPart(duckBody, getCone(0.14, 0.24, 8), yellow, 0, 0.48, -0.42, { rx: -0.85 });
  // Wings
  addPart(duckBody, getSphere(0.18, 10, 8), yellow, -0.34, 0.36, -0.02, { sx: 0.4, sy: 0.75, sz: 1.15 });
  addPart(duckBody, getSphere(0.18, 10, 8), yellow, 0.34, 0.36, -0.02, { sx: 0.4, sy: 0.75, sz: 1.15 });
  // Head
  addPart(duckBody, getSphere(0.24, 14, 12), yellow, 0, 0.74, 0.2);
  // Orange bill
  addPart(duckBody, getBox(0.18, 0.08, 0.2), beak, 0, 0.71, 0.44);
  // Cute eyes
  addPart(duckBody, getSphere(0.038, 8, 8), eye, -0.11, 0.8, 0.38);
  addPart(duckBody, getSphere(0.038, 8, 8), eye, 0.11, 0.8, 0.38);
  group.add(duckBody);

  group.userData.animType = 'bob';
  group.userData.animTargets = [duckBody];
}

function buildTrophy(group: THREE.Group, item: CatalogItem): void {
  const gold = getStdMat(item.primaryColor, { roughness: 0.2, metalness: 0.9 });
  const marble = getStdMat(item.accentColor, { roughness: 0.3 });
  // Marble pedestal
  addPart(group, getBox(0.56, 0.12, 0.56), marble, 0, 0.06, 0);
  addPart(group, getBox(0.44, 0.68, 0.44), marble, 0, 0.46, 0);
  addPart(group, getBox(0.54, 0.1, 0.54), marble, 0, 0.85, 0);
  // Gold plaque
  addPart(group, getBox(0.28, 0.14, 0.03), gold, 0, 0.54, 0.23);
  // Trophy cup
  addPart(group, getCyl(0.14, 0.18, 0.08, 12), gold, 0, 0.94, 0);
  addPart(group, getCyl(0.05, 0.07, 0.22, 10), gold, 0, 1.08, 0);
  addPart(group, getCyl(0.22, 0.1, 0.32, 14), gold, 0, 1.32, 0);
  // Handles
  addPart(group, getTorus(0.1, 0.025, 8, 12), gold, -0.2, 1.32, 0);
  addPart(group, getTorus(0.1, 0.025, 8, 12), gold, 0.2, 1.32, 0);
}

function buildFountain(group: THREE.Group, item: CatalogItem, active: boolean): void {
  const marble = getStdMat(item.primaryColor, { roughness: 0.35 });
  const water = getStdMat(item.accentColor, {
    roughness: 0.15,
    transparent: true,
    opacity: 0.78,
    emissive: '#0284C7',
    emissiveIntensity: 0.25,
  });
  // Outer octagonal basin rim
  addPart(group, getCyl(0.92, 0.96, 0.36, 8), marble, 0, 0.18, 0);
  // Water pool inside
  addPart(group, getCyl(0.8, 0.8, 0.32, 8), water, 0, 0.22, 0);
  // Central column + middle bowl
  addPart(group, getCyl(0.18, 0.24, 0.72, 10), marble, 0, 0.58, 0);
  addPart(group, getCyl(0.52, 0.22, 0.18, 12), marble, 0, 0.96, 0);
  addPart(group, getCyl(0.46, 0.46, 0.06, 12), water, 0, 1.04, 0);
  // Top spout finial
  addPart(group, getCyl(0.09, 0.14, 0.42, 10), marble, 0, 1.24, 0);
  addPart(group, getSphere(0.12, 10, 8), marble, 0, 1.48, 0);
  // Animated water jet plume
  if (active) {
    const jet = addPart(group, getCyl(0.14, 0.05, 0.38, 10), water, 0, 1.66, 0, { name: 'water_jet' });
    group.userData.animType = 'pulse_y';
    group.userData.animTargets = [jet];
  }
}

function buildBookshelf(group: THREE.Group, item: CatalogItem): void {
  const w = item.width;
  const wood = getStdMat(item.primaryColor, { roughness: 0.6 });
  const back = getStdMat(shadeColor(item.primaryColor, 0.75), { roughness: 0.7 });
  // Outer frame
  addPart(group, getBox(w - 0.1, 1.94, 0.08), back, 0, 0.97, -0.26);
  addPart(group, getBox(0.1, 1.96, 0.62), wood, -w / 2 + 0.1, 0.98, 0);
  addPart(group, getBox(0.1, 1.96, 0.62), wood, w / 2 - 0.1, 0.98, 0);
  addPart(group, getBox(w - 0.06, 0.1, 0.66), wood, 0, 1.95, 0);
  // 5 horizontal shelves with colorful books
  const bookPalette = [item.accentColor, '#3B82F6', '#10B981', '#FACC15', '#A855F7', '#F97316', '#EC4899'];
  for (let row = 0; row < 5; row++) {
    const sy = 0.08 + row * 0.38;
    addPart(group, getBox(w - 0.16, 0.06, 0.58), wood, 0, sy, 0);
    if (row < 4) {
      let bx = -w / 2 + 0.24;
      let bi = row * 3;
      while (bx < w / 2 - 0.24) {
        const bw = 0.08 + ((bi * 7) % 3) * 0.03;
        const bh = 0.22 + ((bi * 5) % 4) * 0.025;
        const bMat = getStdMat(bookPalette[bi % bookPalette.length], { roughness: 0.7 });
        addPart(group, getBox(bw, bh, 0.38), bMat, bx + bw / 2, sy + 0.03 + bh / 2, 0.04);
        bx += bw + 0.025;
        bi++;
      }
    }
  }
}

function buildFireplace(group: THREE.Group, item: CatalogItem, active: boolean): void {
  const w = item.width;
  const brick = getStdMat(item.primaryColor, { roughness: 0.85 });
  const mantle = getStdMat('#451A03', { roughness: 0.55 });
  const hearth = getStdMat('#334155', { roughness: 0.8 });
  const log = getStdMat('#5C2D0C', { roughness: 0.9 });
  // Hearth slab
  addPart(group, getBox(w - 0.06, 0.1, 0.88), hearth, 0, 0.05, 0.04);
  // Left & right brick pillars + back + lintel
  addPart(group, getBox(0.46, 1.15, 0.7), brick, -w / 2 + 0.28, 0.66, -0.04);
  addPart(group, getBox(0.46, 1.15, 0.7), brick, w / 2 - 0.28, 0.66, -0.04);
  addPart(group, getBox(w - 0.16, 1.15, 0.18), hearth, 0, 0.66, -0.32);
  addPart(group, getBox(w - 0.1, 0.38, 0.72), brick, 0, 1.18, -0.04);
  // Wooden mantelpiece + chimney breast
  addPart(group, getBox(w - 0.02, 0.12, 0.84), mantle, 0, 1.42, 0);
  addPart(group, getBox(w * 0.62, 0.28, 0.54), brick, 0, 1.6, -0.1);
  // Crossed firewood logs
  addPart(group, getCyl(0.06, 0.06, 0.65, 8), log, 0, 0.18, 0.02, { rz: Math.PI / 2, ry: 0.2 });
  addPart(group, getCyl(0.055, 0.055, 0.6, 8), log, 0, 0.24, -0.02, { rz: Math.PI / 2, ry: -0.25 });
  if (active) {
    const flameOuter = getStdMat(item.accentColor, { emissive: item.accentColor, emissiveIntensity: 1.3 });
    const flameInner = getStdMat('#FEF08A', { emissive: '#FACC15', emissiveIntensity: 1.5 });
    const f1 = addPart(group, getCone(0.22, 0.44, 7), flameOuter, 0, 0.42, 0);
    const f2 = addPart(group, getCone(0.13, 0.32, 7), flameInner, 0.06, 0.38, 0.05);
    group.userData.animType = 'flicker';
    group.userData.animTargets = [f1, f2];
  }
}

function buildBarrier(group: THREE.Group, item: CatalogItem): void {
  const gold = getStdMat(item.primaryColor, { roughness: 0.25, metalness: 0.85 });
  const rope = getStdMat(item.accentColor, { roughness: 0.85 });
  // Two brass stanchion posts
  for (const sx of [-0.38, 0.38]) {
    addPart(group, getCyl(0.13, 0.15, 0.05, 12), gold, sx, 0.025, 0);
    addPart(group, getCyl(0.032, 0.036, 0.86, 10), gold, sx, 0.48, 0);
    addPart(group, getSphere(0.065, 10, 8), gold, sx, 0.94, 0);
  }
  // Draped velvet rope (3 catenary segments)
  addPart(group, getCyl(0.032, 0.032, 0.3, 8), rope, -0.23, 0.72, 0, { rz: 1.15 });
  addPart(group, getCyl(0.032, 0.032, 0.3, 8), rope, 0, 0.64, 0, { rz: Math.PI / 2 });
  addPart(group, getCyl(0.032, 0.032, 0.3, 8), rope, 0.23, 0.72, 0, { rz: -1.15 });
}

function buildTelescope(group: THREE.Group, item: CatalogItem): void {
  const tube = getStdMat(item.primaryColor, { roughness: 0.25, metalness: 0.7 });
  const lens = getStdMat(item.accentColor, { emissive: item.accentColor, emissiveIntensity: 0.4, roughness: 0.1 });
  const tripod = getStdMat('#334155', { roughness: 0.45, metalness: 0.6 });
  // 3 splayed tripod legs
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    addPart(group, getCyl(0.025, 0.03, 1.12, 8), tripod, Math.cos(a) * 0.2, 0.54, Math.sin(a) * 0.2, {
      rx: Math.sin(a) * 0.32,
      rz: -Math.cos(a) * 0.32,
    });
  }
  // Mount head
  addPart(group, getSphere(0.09, 10, 8), tripod, 0, 1.08, 0);
  // Tilted optical tube
  const scope = new THREE.Group();
  scope.position.set(0, 1.2, 0);
  scope.rotation.x = -0.45;
  addPart(scope, getCyl(0.1, 0.075, 0.78, 12), tube, 0, 0, 0, { rx: Math.PI / 2 });
  addPart(scope, getCyl(0.115, 0.115, 0.1, 12), tripod, 0, 0, -0.38, { rx: Math.PI / 2 });
  addPart(scope, getCyl(0.09, 0.09, 0.03, 12), lens, 0, 0, -0.42, { rx: Math.PI / 2 });
  addPart(scope, getCyl(0.04, 0.04, 0.14, 8), tripod, 0, 0, 0.44, { rx: Math.PI / 2 });
  group.add(scope);
}

function buildArcade(group: THREE.Group, item: CatalogItem): void {
  const cab = getStdMat(item.primaryColor, { roughness: 0.45 });
  const trim = getStdMat(item.accentColor, { roughness: 0.35 });
  const screen = getStdMat('#22D3EE', { emissive: '#06B6D4', emissiveIntensity: 0.95, roughness: 0.2 });
  const marquee = getStdMat(item.accentColor, { emissive: item.accentColor, emissiveIntensity: 0.9 });
  // Lower cabinet body
  addPart(group, getBox(0.76, 1.0, 0.74), cab, 0, 0.5, 0);
  // Coin door
  addPart(group, getBox(0.32, 0.34, 0.04), getStdMat('#0F172A'), 0, 0.42, 0.37);
  addPart(group, getBox(0.06, 0.08, 0.05), getStdMat('#EF4444', { emissive: '#EF4444', emissiveIntensity: 0.8 }), -0.07, 0.48, 0.38);
  // Control deck overhang + joystick & buttons
  addPart(group, getBox(0.78, 0.12, 0.32), trim, 0, 1.0, 0.28);
  addPart(group, getCyl(0.018, 0.018, 0.12, 8), getStdMat('#E2E8F0'), -0.18, 1.11, 0.32);
  addPart(group, getSphere(0.045, 8, 8), getStdMat('#EF4444'), -0.18, 1.18, 0.32);
  for (let i = 0; i < 3; i++) {
    addPart(group, getCyl(0.032, 0.032, 0.03, 8), getStdMat(i === 0 ? '#22C55E' : i === 1 ? '#FACC15' : '#EC4899'), 0.04 + i * 0.1, 1.07, 0.32);
  }
  // Upper screen housing + tilted glowing CRT screen
  addPart(group, getBox(0.76, 0.82, 0.58), cab, 0, 1.42, -0.06);
  addPart(group, getBox(0.58, 0.46, 0.04), screen, 0, 1.38, 0.22, { rx: -0.22 });
  // Lit top marquee hood
  addPart(group, getBox(0.78, 0.22, 0.68), cab, 0, 1.84, 0.02);
  addPart(group, getBox(0.68, 0.15, 0.04), marquee, 0, 1.84, 0.36);
}

function buildClawMachine(group: THREE.Group, item: CatalogItem): void {
  const body = getStdMat(item.primaryColor, { roughness: 0.4 });
  const accent = getStdMat(item.accentColor, { emissive: item.accentColor, emissiveIntensity: 0.5 });
  const glass = getStdMat('#E0F2FE', { roughness: 0.1, transparent: true, opacity: 0.35 });
  const metal = getStdMat('#CBD5E1', { roughness: 0.2, metalness: 0.85 });
  // Base cabinet
  addPart(group, getBox(0.84, 0.82, 0.84), body, 0, 0.41, 0);
  // Prize chute & joystick panel
  addPart(group, getBox(0.28, 0.32, 0.06), getStdMat('#0F172A'), -0.2, 0.34, 0.42);
  addPart(group, getBox(0.84, 0.1, 0.18), accent, 0, 0.8, 0.42);
  addPart(group, getSphere(0.045, 8, 8), getStdMat('#FACC15'), 0.16, 0.92, 0.44);
  // Transparent glass display cube + corner pillars
  addPart(group, getBox(0.76, 0.92, 0.76), glass, 0, 1.28, 0, { castShadow: false });
  for (const sx of [-0.38, 0.38]) {
    for (const sz of [-0.38, 0.38]) {
      addPart(group, getBox(0.07, 0.94, 0.07), body, sx, 1.28, sz);
    }
  }
  // Top marquee crown
  addPart(group, getBox(0.86, 0.22, 0.86), body, 0, 1.85, 0);
  addPart(group, getBox(0.74, 0.12, 0.05), accent, 0, 1.85, 0.44);
  // Cute plushies inside!
  const plushColors = ['#FACC15', '#EC4899', '#38BDF8', '#22C55E', '#A855F7'];
  const plushOffsets: [number, number][] = [[-0.18, -0.14], [0.16, -0.12], [0, 0.1], [-0.16, 0.18], [0.18, 0.16]];
  plushOffsets.forEach(([px, pz], idx) => {
    addPart(group, getSphere(0.11, 10, 8), getStdMat(plushColors[idx]), px, 0.94, pz);
  });
  // Hanging metal claw
  const claw = addPart(group, getCyl(0.02, 0.02, 0.36, 8), metal, 0, 1.54, 0);
  addPart(claw, getCone(0.1, 0.14, 4), metal, 0, -0.2, 0, { rx: Math.PI });
  group.userData.animType = 'sway_x';
  group.userData.animTargets = [claw];
}

function buildDJBooth(group: THREE.Group, item: CatalogItem, active: boolean): void {
  const w = item.width;
  const body = getStdMat(item.primaryColor, { roughness: 0.35, metalness: 0.4 });
  const neon = getStdMat(item.accentColor, {
    emissive: item.accentColor,
    emissiveIntensity: active ? 1.25 : 0.3,
  });
  const vinyl = getStdMat('#09090B', { roughness: 0.25, metalness: 0.5 });
  // Sleek booth facade
  addPart(group, getBox(w - 0.1, 1.06, 0.82), body, 0, 0.53, 0);
  // Glowing front EQ visualizer bars
  const eqColors = ['#06B6D4', '#A855F7', '#EC4899', '#22C55E', '#FACC15', '#A855F7', '#06B6D4'];
  const eqBars: THREE.Mesh[] = [];
  eqColors.forEach((col, i) => {
    const bx = -0.66 + i * 0.22;
    const bh = 0.22 + ((i * 3) % 4) * 0.12;
    const bar = addPart(
      group,
      getBox(0.12, bh, 0.05),
      getStdMat(col, { emissive: col, emissiveIntensity: active ? 1.2 : 0.2 }),
      bx,
      0.52,
      0.42
    );
    eqBars.push(bar);
  });
  // Top neon trim
  addPart(group, getBox(w - 0.08, 0.05, 0.86), neon, 0, 1.07, 0);
  // Dual turntables + center mixer
  for (const tx of [-0.52, 0.52]) {
    addPart(group, getBox(0.54, 0.06, 0.46), getStdMat('#334155'), tx, 1.12, 0);
    addPart(group, getCyl(0.18, 0.18, 0.03, 16), vinyl, tx, 1.16, 0);
    addPart(group, getCyl(0.05, 0.05, 0.035, 10), neon, tx, 1.165, 0);
  }
  addPart(group, getBox(0.36, 0.08, 0.42), getStdMat('#1E293B'), 0, 1.13, 0);
  if (active) {
    group.userData.animType = 'eq';
    group.userData.animTargets = eqBars;
  }
}

function buildPiano(group: THREE.Group, item: CatalogItem): void {
  const ebony = getStdMat(item.primaryColor, { roughness: 0.18, metalness: 0.35 });
  const ivory = getStdMat(item.accentColor, { roughness: 0.3 });
  const gold = getStdMat('#FACC15', { roughness: 0.25, metalness: 0.85 });
  // 3 tapered grand piano legs
  const legPos: [number, number][] = [[-0.68, 0.56], [0.68, 0.56], [0, -0.68]];
  for (const [lx, lz] of legPos) {
    addPart(group, getCyl(0.065, 0.045, 0.68, 10), ebony, lx, 0.34, lz);
  }
  // Pedal lyre
  addPart(group, getBox(0.28, 0.54, 0.06), ebony, 0, 0.32, 0.44);
  for (const px of [-0.07, 0, 0.07]) {
    addPart(group, getBox(0.03, 0.03, 0.14), gold, px, 0.06, 0.5);
  }
  // Main soundboard body (stepped grand silhouette)
  addPart(group, getBox(1.52, 0.26, 0.92), ebony, 0, 0.8, 0.22);
  addPart(group, getCyl(0.68, 0.68, 0.26, 16), ebony, -0.1, 0.8, -0.26);
  // Keyboard bed + white & black keys
  addPart(group, getBox(1.38, 0.1, 0.3), ebony, 0, 0.74, 0.72);
  addPart(group, getBox(1.26, 0.04, 0.22), ivory, 0, 0.8, 0.74);
  for (let i = -5; i <= 5; i++) {
    if (i === -2 || i === 2) continue;
    addPart(group, getBox(0.045, 0.04, 0.13), ebony, i * 0.1, 0.83, 0.7);
  }
  // Propped open lid + brass prop stick
  addPart(group, getBox(1.42, 0.05, 1.32), ebony, 0.16, 1.2, -0.06, { rz: -0.42 });
  addPart(group, getCyl(0.018, 0.018, 0.68, 8), gold, 0.62, 1.18, -0.08, { rz: 0.18 });
}

function buildJukebox(group: THREE.Group, item: CatalogItem, active: boolean): void {
  const red = getStdMat(item.primaryColor, { roughness: 0.35 });
  const gold = getStdMat(item.accentColor, { roughness: 0.25, metalness: 0.75 });
  const neonTube = getStdMat('#38BDF8', {
    emissive: '#38BDF8',
    emissiveIntensity: active ? 1.3 : 0.3,
  });
  const warmGlow = getStdMat('#FACC15', {
    emissive: '#F59E0B',
    emissiveIntensity: active ? 1.1 : 0.25,
  });
  // Main retro Wurlitzer cabinet + rounded top arch
  addPart(group, getBox(0.76, 1.36, 0.62), red, 0, 0.68, 0);
  addPart(group, getCyl(0.38, 0.38, 0.62, 16), red, 0, 1.36, 0, { rx: Math.PI / 2 });
  // Glowing neon arch trim
  const arch = addPart(group, getTorus(0.38, 0.04, 8, 18), neonTube, 0, 1.36, 0.31);
  // Chrome speaker grille + warm backlit selector window
  addPart(group, getBox(0.54, 0.56, 0.06), gold, 0, 0.44, 0.31);
  addPart(group, getBox(0.56, 0.36, 0.06), warmGlow, 0, 1.1, 0.31);
  // Side neon pilasters
  for (const sx of [-0.36, 0.36]) {
    addPart(group, getCyl(0.038, 0.038, 1.24, 8), neonTube, sx, 0.72, 0.31);
  }
  if (active) {
    group.userData.animType = 'pulse_emissive';
    group.userData.animTargets = [arch];
  }
}

function buildDice(group: THREE.Group, item: CatalogItem, state?: string | Record<string, unknown>): void {
  const val = getDiceValue(state);
  const cubeMat = getStdMat(item.primaryColor, {
    roughness: 0.2,
    metalness: 0.2,
    emissive: item.primaryColor,
    emissiveIntensity: 0.45,
    transparent: true,
    opacity: 0.9,
  });
  const pipMat = getStdMat(item.accentColor, { emissive: item.accentColor, emissiveIntensity: 0.9 });
  const base = getStdMat('#1E293B', { roughness: 0.3, metalness: 0.7 });
  // Holo projector base
  addPart(group, getCyl(0.28, 0.34, 0.1, 12), base, 0, 0.05, 0);
  // Floating holo-die cube
  const dieGroup = new THREE.Group();
  dieGroup.position.set(0, 0.48, 0);
  addPart(dieGroup, getBox(0.46, 0.46, 0.46), cubeMat, 0, 0, 0);
  // Pips on top face based on value (1..6)
  const pipCoords: Record<number, [number, number][]> = {
    1: [[0, 0]],
    2: [[-0.11, -0.11], [0.11, 0.11]],
    3: [[-0.12, -0.12], [0, 0], [0.12, 0.12]],
    4: [[-0.11, -0.11], [0.11, -0.11], [-0.11, 0.11], [0.11, 0.11]],
    5: [[-0.12, -0.12], [0.12, -0.12], [0, 0], [-0.12, 0.12], [0.12, 0.12]],
    6: [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0], [0.12, 0], [-0.12, 0.12], [0.12, 0.12]],
  };
  for (const [px, pz] of pipCoords[val] ?? pipCoords[6]) {
    addPart(dieGroup, getSphere(0.036, 8, 8), pipMat, px, 0.24, pz);
    addPart(dieGroup, getSphere(0.036, 8, 8), pipMat, px, pz, 0.24);
  }
  group.add(dieGroup);
  group.userData.animType = 'bob';
  group.userData.animTargets = [dieGroup];
}

function buildSpeaker(group: THREE.Group, item: CatalogItem): void {
  const cab = getStdMat(item.primaryColor, { roughness: 0.65 });
  const cone = getStdMat('#09090B', { roughness: 0.5 });
  const ring = getStdMat(item.accentColor, { emissive: item.accentColor, emissiveIntensity: 0.9 });
  // Stacked double subwoofer enclosure
  addPart(group, getBox(0.76, 1.62, 0.64), cab, 0, 0.81, 0);
  // Two large woofer cones + tweeter
  for (const wy of [0.46, 1.12]) {
    addPart(group, getTorus(0.24, 0.032, 8, 18), ring, 0, wy, 0.33);
    addPart(group, getCyl(0.22, 0.14, 0.06, 16), cone, 0, wy, 0.31, { rx: Math.PI / 2 });
    addPart(group, getSphere(0.07, 10, 8), cab, 0, wy, 0.33);
  }
  addPart(group, getTorus(0.09, 0.02, 8, 14), ring, 0, 1.48, 0.33);
}

function buildPodium(group: THREE.Group, item: CatalogItem): void {
  const primary = getStdMat(item.primaryColor, { roughness: 0.45 });
  const accent = getStdMat(item.accentColor, {
    emissive: item.id === 'room_door_sign' ? item.accentColor : '#000000',
    emissiveIntensity: item.id === 'room_door_sign' ? 0.8 : 0,
    roughness: 0.25,
    metalness: 0.7,
  });

  if (item.id === 'room_door_sign') {
    // Suite keycard pillar
    addPart(group, getBox(0.42, 0.1, 0.42), primary, 0, 0.05, 0);
    addPart(group, getBox(0.26, 1.18, 0.24), primary, 0, 0.66, 0);
    addPart(group, getBox(0.2, 0.28, 0.04), accent, 0, 1.05, 0.13);
    addPart(group, getCyl(0.06, 0.06, 0.05, 10), getStdMat('#22C55E', { emissive: '#22C55E', emissiveIntensity: 1 }), 0, 0.78, 0.13, { rx: Math.PI / 2 });
    return;
  }

  // Event host podium with slanted lectern & microphone
  addPart(group, getBox(0.64, 0.1, 0.56), primary, 0, 0.05, 0);
  addPart(group, getBox(0.46, 0.96, 0.4), primary, 0, 0.56, 0);
  addPart(group, getBox(0.5, 0.14, 0.04), accent, 0, 0.74, 0.21);
  // Slanted reading desk
  addPart(group, getBox(0.7, 0.08, 0.52), primary, 0, 1.08, 0.02, { rx: 0.22 });
  // Gooseneck mic
  const mic = getStdMat('#1E293B', { roughness: 0.3, metalness: 0.8 });
  addPart(group, getCyl(0.015, 0.015, 0.24, 8), mic, 0.18, 1.22, -0.06, { rx: -0.3 });
  addPart(group, getSphere(0.038, 8, 8), mic, 0.18, 1.32, -0.1);
}

function buildElevator(group: THREE.Group, item: CatalogItem): void {
  const w = item.width;
  const brass = getStdMat(item.primaryColor, { roughness: 0.25, metalness: 0.85 });
  const door = getStdMat(item.accentColor, { roughness: 0.3, metalness: 0.75 });
  const glow = getStdMat('#FACC15', { emissive: '#F59E0B', emissiveIntensity: 1.1 });
  // Heavy surround frame
  addPart(group, getBox(w - 0.06, 2.26, 0.26), brass, 0, 1.13, -0.26);
  // Recessed sliding twin doors
  addPart(group, getBox((w - 0.38) / 2 - 0.02, 1.88, 0.12), door, -(w - 0.38) / 4 - 0.01, 0.96, -0.16);
  addPart(group, getBox((w - 0.38) / 2 - 0.02, 1.88, 0.12), door, (w - 0.38) / 4 + 0.01, 0.96, -0.16);
  // Brass door trim lines
  addPart(group, getBox(0.04, 1.88, 0.14), brass, 0, 0.96, -0.15);
  // Overhead vintage floor dial indicator
  addPart(group, getCyl(0.22, 0.22, 0.08, 14), brass, 0, 2.08, -0.12, { rx: Math.PI / 2 });
  addPart(group, getCyl(0.16, 0.16, 0.09, 14), glow, 0, 2.08, -0.11, { rx: Math.PI / 2 });
  // Call button panel on right jamb
  addPart(group, getBox(0.12, 0.28, 0.06), brass, w / 2 - 0.16, 1.1, -0.12);
  addPart(group, getSphere(0.028, 8, 8), glow, w / 2 - 0.16, 1.15, -0.09);
}

function buildVending(group: THREE.Group, item: CatalogItem): void {
  const body = getStdMat(item.primaryColor, { roughness: 0.35 });
  const trim = getStdMat(item.accentColor, { roughness: 0.3 });
  const glass = getStdMat('#BAE6FD', { roughness: 0.1, transparent: true, opacity: 0.55, emissive: '#38BDF8', emissiveIntensity: 0.3 });
  // Main cabinet
  addPart(group, getBox(0.84, 1.86, 0.74), body, 0, 0.93, 0);
  // Illuminated front showcase glass
  addPart(group, getBox(0.52, 1.05, 0.06), glass, -0.08, 1.14, 0.36);
  // Rows of colorful cans inside
  const canColors = ['#EF4444', '#22C55E', '#3B82F6', '#FACC15', '#EC4899'];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      const cMat = getStdMat(canColors[(row + col) % canColors.length], { roughness: 0.3 });
      addPart(group, getCyl(0.04, 0.04, 0.14, 8), cMat, -0.22 + col * 0.14, 0.78 + row * 0.24, 0.32);
    }
  }
  // Keypad + coin slot on right
  addPart(group, getBox(0.16, 0.44, 0.06), getStdMat('#0F172A'), 0.28, 1.16, 0.36);
  addPart(group, getBox(0.08, 0.08, 0.07), trim, 0.28, 1.28, 0.37);
  // Bottom pickup flap
  addPart(group, getBox(0.58, 0.26, 0.08), getStdMat('#0F172A'), -0.04, 0.3, 0.36);
}

function buildLuggageCart(group: THREE.Group, item: CatalogItem): void {
  const brass = getStdMat(item.primaryColor, { roughness: 0.22, metalness: 0.88 });
  const carpet = getStdMat('#B91C1C', { roughness: 0.85 });
  const wheel = getStdMat('#0F172A', { roughness: 0.6 });
  // Deck & 4 caster wheels
  addPart(group, getBox(0.82, 0.08, 0.64), brass, 0, 0.16, 0);
  addPart(group, getBox(0.76, 0.03, 0.58), carpet, 0, 0.21, 0);
  for (const wx of [-0.32, 0.32]) {
    for (const wz of [-0.24, 0.24]) {
      addPart(group, getCyl(0.06, 0.06, 0.04, 10), wheel, wx, 0.06, wz, { rx: Math.PI / 2 });
    }
  }
  // Arched birdcage brass frame + top finial
  for (const sx of [-0.36, 0.36]) {
    addPart(group, getCyl(0.026, 0.026, 1.24, 8), brass, sx, 0.82, 0);
  }
  addPart(group, getTorus(0.36, 0.026, 8, 16), brass, 0, 1.44, 0);
  addPart(group, getSphere(0.055, 8, 8), brass, 0, 1.56, 0);
  // Stacked suitcases
  addPart(group, getBox(0.5, 0.22, 0.38), getStdMat(item.accentColor, { roughness: 0.6 }), -0.06, 0.34, 0.02, { ry: 0.1 });
  addPart(group, getBox(0.38, 0.18, 0.3), getStdMat('#1D4ED8', { roughness: 0.5 }), 0.04, 0.54, -0.02, { ry: -0.18 });
  addPart(group, getBox(0.28, 0.14, 0.22), getStdMat('#16A34A', { roughness: 0.5 }), -0.02, 0.7, 0.02, { ry: 0.08 });
}

function buildLounger(group: THREE.Group, item: CatalogItem): void {
  const w = item.width;
  const frame = getStdMat(item.accentColor, { roughness: 0.4 });
  const stripe1 = getStdMat(item.primaryColor, { roughness: 0.75 });
  const stripe2 = getStdMat('#F8FAFC', { roughness: 0.75 });
  // Low white deck frame + legs
  for (const lx of [-w / 2 + 0.18, 0, w / 2 - 0.18]) {
    for (const lz of [-0.32, 0.32]) {
      addPart(group, getCyl(0.03, 0.03, 0.24, 8), frame, lx, 0.12, lz);
    }
  }
  addPart(group, getBox(w - 0.16, 0.07, 0.74), frame, 0, 0.26, 0);
  // Striped flat cushion
  for (let i = 0; i < 4; i++) {
    addPart(group, getBox(0.28, 0.09, 0.66), i % 2 === 0 ? stripe1 : stripe2, -0.1 + i * 0.29, 0.34, 0);
  }
  // Reclined backrest on left side
  addPart(group, getBox(0.68, 0.09, 0.66), stripe1, -0.58, 0.52, 0, { rz: -0.52 });
  // Rolled headrest pillow
  addPart(group, getCyl(0.08, 0.08, 0.56, 10), stripe2, -0.78, 0.7, 0, { rx: Math.PI / 2 });
}

function buildJacuzzi(group: THREE.Group, item: CatalogItem, active: boolean): void {
  const wood = getStdMat(item.accentColor, { roughness: 0.65 });
  const rim = getStdMat('#F8FAFC', { roughness: 0.3 });
  const water = getStdMat(item.primaryColor, {
    roughness: 0.12,
    transparent: true,
    opacity: 0.8,
    emissive: '#0EA5E9',
    emissiveIntensity: 0.35,
  });
  const bubbleMat = getStdMat('#E0F2FE', { emissive: '#BAE6FD', emissiveIntensity: 0.5, transparent: true, opacity: 0.85 });
  // Octagonal cedar wood tub + white acrylic rim
  addPart(group, getCyl(0.95, 0.92, 0.66, 8), wood, 0, 0.33, 0);
  addPart(group, getTorus(0.86, 0.09, 8, 16), rim, 0, 0.66, 0, { rx: Math.PI / 2 });
  // Accessible side transfer step
  addPart(group, getBox(0.64, 0.28, 0.3), wood, 0, 0.14, 0.96);
  // Glowing turquoise water surface
  addPart(group, getCyl(0.82, 0.82, 0.56, 8), water, 0, 0.34, 0);
  // Bubbling foam spheres
  if (active) {
    const bubbles: THREE.Mesh[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r = 0.22 + (i % 3) * 0.18;
      const b = addPart(group, getSphere(0.065 + (i % 2) * 0.025, 8, 8), bubbleMat, Math.cos(a) * r, 0.64, Math.sin(a) * r);
      bubbles.push(b);
    }
    group.userData.animType = 'bubbles';
    group.userData.animTargets = bubbles;
  }
}

function buildWaterTile(group: THREE.Group, item: CatalogItem): void {
  const water = getStdMat(item.primaryColor, {
    roughness: 0.12,
    transparent: true,
    opacity: 0.78,
    emissive: item.primaryColor,
    emissiveIntensity: 0.2,
  });
  const ripple = getStdMat(item.accentColor, { roughness: 0.2, transparent: true, opacity: 0.5 });
  addPart(group, getBox(0.98, 0.06, 0.98), water, 0, 0.03, 0, { castShadow: false });
  addPart(group, getBox(0.62, 0.015, 0.12), ripple, -0.1, 0.065, -0.15, { castShadow: false });
  addPart(group, getBox(0.48, 0.015, 0.1), ripple, 0.14, 0.065, 0.2, { castShadow: false });
}

function buildUmbrella(group: THREE.Group, item: CatalogItem): void {
  const base = getStdMat('#475569', { roughness: 0.5, metalness: 0.5 });
  const pole = getStdMat('#CBD5E1', { roughness: 0.3, metalness: 0.7 });
  const primary = getStdMat(item.primaryColor, { roughness: 0.65 });
  const accent = getStdMat(item.accentColor, { roughness: 0.65 });
  // Weighted stand & pole
  addPart(group, getCyl(0.24, 0.28, 0.08, 12), base, 0, 0.04, 0);
  addPart(group, getCyl(0.035, 0.04, 2.0, 10), pole, 0, 1.04, 0);
  // Alternating striped canopy wedges
  const segs = 8;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const mat = i % 2 === 0 ? primary : accent;
    const wedge = new THREE.Group();
    wedge.position.set(0, 2.06, 0);
    wedge.rotation.y = a;
    addPart(wedge, getBox(0.52, 0.05, 0.78), mat, 0, -0.14, 0.38, { rx: 0.38 });
    group.add(wedge);
  }
  addPart(group, getSphere(0.07, 8, 8), pole, 0, 2.12, 0);
}

function buildRamp(group: THREE.Group, item: CatalogItem): void {
  const w = item.width;
  const deck = getStdMat(item.primaryColor, { roughness: 0.7 });
  const stripe = getStdMat(item.accentColor, { roughness: 0.4, emissive: item.accentColor, emissiveIntensity: 0.2 });
  const rail = getStdMat('#E2E8F0', { roughness: 0.3, metalness: 0.7 });
  // Sloped ramp surface (stepped/angled low-poly wedge)
  addPart(group, getBox(w - 0.06, 0.07, 0.9), deck, 0, 0.11, 0, { rz: 0.11, castShadow: false });
  // Yellow safety edge stripes
  addPart(group, getBox(w - 0.08, 0.03, 0.09), stripe, 0, 0.15, -0.4, { rz: 0.11, castShadow: false });
  addPart(group, getBox(w - 0.08, 0.03, 0.09), stripe, 0, 0.15, 0.4, { rz: 0.11, castShadow: false });
  // Anti-slip yellow ribs
  for (let i = -3; i <= 3; i++) {
    addPart(group, getBox(0.06, 0.02, 0.66), stripe, i * 0.24, 0.155 + i * 0.025, 0, { castShadow: false });
  }
  // Low side curbs
  addPart(group, getBox(w - 0.06, 0.12, 0.05), rail, 0, 0.16, -0.46, { rz: 0.11 });
  addPart(group, getBox(w - 0.06, 0.12, 0.05), rail, 0, 0.16, 0.46, { rz: 0.11 });
}

function buildBoostPad(group: THREE.Group, item: CatalogItem): void {
  const base = getStdMat('#0F172A', { roughness: 0.4, metalness: 0.5 });
  const glow = getStdMat(item.primaryColor, { emissive: item.primaryColor, emissiveIntensity: 1.0 });
  const chevron = getStdMat(item.accentColor, { emissive: item.accentColor, emissiveIntensity: 1.3 });
  addPart(group, getBox(0.94, 0.06, 0.94), base, 0, 0.03, 0, { castShadow: false });
  addPart(group, getBox(0.84, 0.02, 0.84), glow, 0, 0.065, 0, { castShadow: false });
  // 2 glowing chevron arrows
  const chevrons: THREE.Mesh[] = [];
  for (const cz of [-0.18, 0.18]) {
    const c1 = addPart(group, getBox(0.32, 0.025, 0.09), chevron, -0.11, 0.08, cz, { ry: 0.55, castShadow: false });
    const c2 = addPart(group, getBox(0.32, 0.025, 0.09), chevron, 0.11, 0.08, cz, { ry: -0.55, castShadow: false });
    chevrons.push(c1, c2);
  }
  group.userData.animType = 'pulse_emissive';
  group.userData.animTargets = chevrons;
}

function buildChargingDock(group: THREE.Group, item: CatalogItem, active: boolean): void {
  const chassis = getStdMat(item.accentColor, { roughness: 0.35, metalness: 0.6 });
  const neon = getStdMat(item.primaryColor, {
    emissive: active ? item.primaryColor : '#000000',
    emissiveIntensity: active ? 1.2 : 0.15,
  });
  // Floor docking pad + upright station tower
  addPart(group, getBox(0.86, 0.06, 0.86), chassis, 0, 0.03, 0, { castShadow: false });
  addPart(group, getBox(0.56, 1.42, 0.34), chassis, 0, 0.74, -0.2);
  // Glowing battery progress bars
  for (let i = 0; i < 4; i++) {
    addPart(group, getBox(0.34, 0.1, 0.04), neon, 0, 0.58 + i * 0.18, -0.02);
  }
  // Charging cable coil on side
  addPart(group, getTorus(0.11, 0.025, 8, 12), neon, 0.32, 0.78, -0.18, { ry: Math.PI / 2 });
}

function buildRug(group: THREE.Group, item: CatalogItem): void {
  const w = item.width;
  const d = item.depth;
  const primary = getStdMat(item.primaryColor, { roughness: 0.92 });
  const accent = getStdMat(item.accentColor, { roughness: 0.85 });

  if (item.id === 'checkered_finish_mat') {
    const cols = Math.max(4, w * 3);
    const rows = Math.max(2, d * 2);
    const cw = (w - 0.06) / cols;
    const cd = (d - 0.06) / rows;
    for (let ix = 0; ix < cols; ix++) {
      for (let iz = 0; iz < rows; iz++) {
        const mat = (ix + iz) % 2 === 0 ? primary : accent;
        addPart(
          group,
          getBox(cw, 0.035, cd),
          mat,
          -(w - 0.06) / 2 + (ix + 0.5) * cw,
          0.018,
          -(d - 0.06) / 2 + (iz + 0.5) * cd,
          { castShadow: false }
        );
      }
    }
    return;
  }

  if (item.id === 'tactile_guide_strip') {
    addPart(group, getBox(w - 0.06, 0.03, d - 0.06), primary, 0, 0.015, 0, { castShadow: false });
    for (let i = -2; i <= 2; i++) {
      addPart(group, getBox(w - 0.16, 0.02, 0.06), accent, 0, 0.035, i * 0.16, { castShadow: false });
    }
    return;
  }

  // Woven rug or VIP red carpet with gold border trim
  addPart(group, getBox(w - 0.08, 0.03, d - 0.08), accent, 0, 0.015, 0, { castShadow: false });
  addPart(group, getBox(w - 0.22, 0.035, d - 0.22), primary, 0, 0.02, 0, { castShadow: false });
}

function buildArch(group: THREE.Group, item: CatalogItem): void {
  const w = item.width;
  const primary = getStdMat(item.primaryColor, { roughness: 0.4 });
  const accent = getStdMat(item.accentColor, { roughness: 0.35 });
  const dark = getStdMat('#0F172A', { roughness: 0.5 });
  // Twin racing truss towers
  for (const sx of [-w / 2 + 0.14, w / 2 - 0.14]) {
    addPart(group, getBox(0.2, 2.3, 0.22), primary, sx, 1.15, 0);
    addPart(group, getBox(0.28, 0.12, 0.3), dark, sx, 0.06, 0);
  }
  // Overhead checkered banner beam
  addPart(group, getBox(w + 0.12, 0.44, 0.24), primary, 0, 2.22, 0);
  for (let i = -3; i <= 3; i++) {
    addPart(group, getBox(0.22, 0.18, 0.26), i % 2 === 0 ? accent : dark, i * 0.24, 2.22, 0);
  }
}

function buildDiscoTile(group: THREE.Group, item: CatalogItem): void {
  const frame = getStdMat('#0F172A', { roughness: 0.4 });
  const panel = new THREE.MeshStandardMaterial({
    color: item.primaryColor,
    emissive: new THREE.Color(item.primaryColor),
    emissiveIntensity: 0.9,
    roughness: 0.2,
  });
  addPart(group, getBox(0.96, 0.04, 0.96), frame, 0, 0.02, 0, { castShadow: false });
  const lit = addPart(group, getBox(0.84, 0.025, 0.84), panel, 0, 0.045, 0, { castShadow: false });
  group.userData.animType = 'disco_tile';
  group.userData.animTargets = [lit];
}

function buildCosmeticBox(group: THREE.Group, item: CatalogItem): void {
  const boxMat = getStdMat(item.primaryColor, { roughness: 0.3, metalness: 0.4 });
  const ribbon = getStdMat(item.accentColor, { emissive: item.accentColor, emissiveIntensity: 0.45, roughness: 0.25 });
  // Stylized gift / unlock display box with bow
  addPart(group, getBox(0.62, 0.52, 0.62), boxMat, 0, 0.26, 0);
  addPart(group, getBox(0.66, 0.12, 0.66), boxMat, 0, 0.54, 0);
  addPart(group, getBox(0.68, 0.62, 0.1), ribbon, 0, 0.31, 0);
  addPart(group, getBox(0.1, 0.62, 0.68), ribbon, 0, 0.31, 0);
  addPart(group, getTorus(0.1, 0.032, 8, 12), ribbon, -0.09, 0.66, 0, { ry: 0.4 });
  addPart(group, getTorus(0.1, 0.032, 8, 12), ribbon, 0.09, 0.66, 0, { ry: -0.4 });
}

// ============================================================================
// Public Factory API
// ============================================================================

export function createFurnitureMesh(
  item: CatalogItem,
  rotation: number,
  state?: string | Record<string, unknown>
): THREE.Group {
  const group = new THREE.Group();
  group.name = `furni_${item.id}`;
  group.userData.catalogItemId = item.id;
  group.userData.modelType = item.modelType;

  const active = isStateActive(state, true);

  switch (item.modelType) {
    case 'sofa':
      buildSofa(group, item);
      break;
    case 'chair':
      buildChair(group, item);
      break;
    case 'stool':
      buildStool(group, item);
      break;
    case 'beanbag':
      buildBeanbag(group, item);
      break;
    case 'throne':
      buildThrone(group, item);
      break;
    case 'bench':
      buildBench(group, item);
      break;
    case 'table_low':
      buildTableLow(group, item);
      break;
    case 'table_round':
      buildTableRound(group, item);
      break;
    case 'table_long':
      buildTableLong(group, item);
      break;
    case 'counter':
      buildCounter(group, item);
      break;
    case 'desk':
      buildDesk(group, item);
      break;
    case 'lamp_floor':
      buildLampFloor(group, item, active);
      break;
    case 'lava_lamp':
      buildLavaLamp(group, item, active);
      break;
    case 'neon_pillar':
      buildNeonPillar(group, item, active);
      break;
    case 'disco_tower':
      buildDiscoTower(group, item, active);
      break;
    case 'plant_palm':
      buildPlantPalm(group, item);
      break;
    case 'duck':
      buildDuck(group, item);
      break;
    case 'trophy':
      buildTrophy(group, item);
      break;
    case 'fountain':
      buildFountain(group, item, active);
      break;
    case 'bookshelf':
      buildBookshelf(group, item);
      break;
    case 'fireplace':
      buildFireplace(group, item, active);
      break;
    case 'barrier':
      buildBarrier(group, item);
      break;
    case 'telescope':
      buildTelescope(group, item);
      break;
    case 'arcade':
      buildArcade(group, item);
      break;
    case 'claw_machine':
      buildClawMachine(group, item);
      break;
    case 'dj_booth':
      buildDJBooth(group, item, active);
      break;
    case 'piano':
      buildPiano(group, item);
      break;
    case 'jukebox':
      buildJukebox(group, item, active);
      break;
    case 'dice':
      buildDice(group, item, state);
      break;
    case 'speaker':
      buildSpeaker(group, item);
      break;
    case 'podium':
      buildPodium(group, item);
      break;
    case 'elevator':
      buildElevator(group, item);
      break;
    case 'vending':
      buildVending(group, item);
      break;
    case 'luggage_cart':
      buildLuggageCart(group, item);
      break;
    case 'lounger':
      buildLounger(group, item);
      break;
    case 'jacuzzi':
      buildJacuzzi(group, item, active);
      break;
    case 'water_tile':
      buildWaterTile(group, item);
      break;
    case 'umbrella':
      buildUmbrella(group, item);
      break;
    case 'ramp':
      buildRamp(group, item);
      break;
    case 'boost_pad':
      buildBoostPad(group, item);
      break;
    case 'charging_dock':
      buildChargingDock(group, item, active);
      break;
    case 'rug':
      buildRug(group, item);
      break;
    case 'arch':
      buildArch(group, item);
      break;
    case 'disco_tile':
      buildDiscoTile(group, item);
      break;
    case 'cosmetic_box':
    default:
      buildCosmeticBox(group, item);
      break;
  }

  // Rotation4: 0 = +Z (S), 1 = +X (E), 2 = -Z (N), 3 = -X (W)
  const rotNorm = ((rotation % 4) + 4) % 4;
  group.rotation.y = rotNorm * (Math.PI / 2);

  return group;
}

const DISCO_COLORS = [
  new THREE.Color('#EC4899'),
  new THREE.Color('#06B6D4'),
  new THREE.Color('#A855F7'),
  new THREE.Color('#22C55E'),
  new THREE.Color('#FACC15'),
];

/**
 * Updates lightweight procedural animations on animated furniture (disco balls,
 * jacuzzi bubbles, lava lamps, fireplaces, EQ bars, disco tiles, rubber duck).
 */
export function updateFurnitureAnimation(
  group: THREE.Group,
  elapsedTime: number,
  delta: number,
  seedOffset = 0
): void {
  const animType = group.userData.animType as string | undefined;
  if (!animType) return;
  const targets = group.userData.animTargets as THREE.Object3D[] | undefined;
  if (!targets || targets.length === 0) return;

  const t = elapsedTime + seedOffset;

  switch (animType) {
    case 'spin':
      targets[0].rotation.y += delta * 1.4;
      break;
    case 'bob':
      targets[0].position.y = (targets[0].userData.baseY ?? targets[0].position.y) + Math.sin(t * 2.4) * 0.035;
      if (targets[0].userData.baseY === undefined) {
        targets[0].userData.baseY = targets[0].position.y;
      }
      break;
    case 'lava':
      if (targets[0]) targets[0].position.y = 0.42 + Math.sin(t * 1.3) * 0.14;
      if (targets[1]) targets[1].position.y = 0.46 + Math.cos(t * 1.1) * 0.13;
      break;
    case 'flicker':
      targets.forEach((f, idx) => {
        const s = 0.88 + Math.sin(t * 11 + idx * 2.1) * 0.16;
        f.scale.set(1, s, 1);
      });
      break;
    case 'bubbles':
      targets.forEach((b, idx) => {
        const s = 0.65 + 0.45 * Math.abs(Math.sin(t * 3.2 + idx * 0.9));
        b.scale.setScalar(s);
      });
      break;
    case 'pulse_y':
      targets[0].scale.y = 0.85 + Math.sin(t * 6) * 0.18;
      break;
    case 'sway_x':
      targets[0].position.x = Math.sin(t * 1.4) * 0.16;
      break;
    case 'eq':
      targets.forEach((bar, idx) => {
        bar.scale.y = 0.45 + 0.85 * Math.abs(Math.sin(t * 6.5 + idx * 0.8));
      });
      break;
    case 'disco_tile': {
      const mesh = targets[0] as THREE.Mesh;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const idx = Math.floor(t * 1.8) % DISCO_COLORS.length;
      const col = DISCO_COLORS[idx];
      mat.color.copy(col);
      mat.emissive.copy(col);
      mat.emissiveIntensity = 0.75 + 0.35 * Math.sin(t * 5);
      break;
    }
    case 'pulse_emissive': {
      const intensity = 0.7 + 0.5 * Math.sin(t * 4.5);
      targets.forEach((obj) => {
        const mat = (obj as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (mat && 'emissiveIntensity' in mat) {
          mat.emissiveIntensity = intensity;
        }
      });
      break;
    }
  }
}

export function disposeFurnitureCache(): void {
  geomCache.forEach((g) => g.dispose());
  geomCache.clear();
  matCache.forEach((m) => m.dispose());
  matCache.clear();
}
