import * as THREE from 'three';
import type {
  Accessory,
  AvatarConfig,
  BodyType,
  Expression,
  HairStyle,
  MobilityAid,
  ShirtStyle,
} from '@handihotel/shared';

export interface AvatarRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  head: THREE.Group;
  torso: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  mobilityGroup: THREE.Group;
  wheels: THREE.Object3D[];
  crutches: THREE.Object3D[];
  config: AvatarConfig;
  dispose: () => void;
}

interface BodyProportions {
  heightScale: number;
  torsoWidth: number;
  torsoDepth: number;
  torsoHeight: number;
  headRadius: number;
  armRadius: number;
  armLength: number;
  legRadius: number;
  legLength: number;
  shoulderOffset: number;
  hipOffset: number;
}

const BODY_PROPORTIONS: Record<BodyType, BodyProportions> = {
  slim: {
    heightScale: 1.0,
    torsoWidth: 0.34,
    torsoDepth: 0.21,
    torsoHeight: 0.48,
    headRadius: 0.23,
    armRadius: 0.062,
    armLength: 0.42,
    legRadius: 0.072,
    legLength: 0.44,
    shoulderOffset: 0.225,
    hipOffset: 0.095,
  },
  standard: {
    heightScale: 1.0,
    torsoWidth: 0.4,
    torsoDepth: 0.24,
    torsoHeight: 0.48,
    headRadius: 0.24,
    armRadius: 0.07,
    armLength: 0.43,
    legRadius: 0.082,
    legLength: 0.44,
    shoulderOffset: 0.26,
    hipOffset: 0.11,
  },
  broad: {
    heightScale: 1.03,
    torsoWidth: 0.48,
    torsoDepth: 0.28,
    torsoHeight: 0.5,
    headRadius: 0.245,
    armRadius: 0.084,
    armLength: 0.45,
    legRadius: 0.094,
    legLength: 0.45,
    shoulderOffset: 0.305,
    hipOffset: 0.125,
  },
  petite: {
    heightScale: 0.88,
    torsoWidth: 0.35,
    torsoDepth: 0.21,
    torsoHeight: 0.43,
    headRadius: 0.235,
    armRadius: 0.064,
    armLength: 0.38,
    legRadius: 0.074,
    legLength: 0.39,
    shoulderOffset: 0.23,
    hipOffset: 0.095,
  },
  tall: {
    heightScale: 1.12,
    torsoWidth: 0.39,
    torsoDepth: 0.23,
    torsoHeight: 0.53,
    headRadius: 0.24,
    armRadius: 0.07,
    armLength: 0.48,
    legRadius: 0.082,
    legLength: 0.52,
    shoulderOffset: 0.255,
    hipOffset: 0.11,
  },
};

export function isWheelchairAid(aid: MobilityAid): boolean {
  return (
    aid === 'manual_wheelchair' ||
    aid === 'racing_wheelchair' ||
    aid === 'power_wheelchair'
  );
}

function makeMat(
  color: string | number,
  opts: {
    roughness?: number;
    metalness?: number;
    emissive?: string | number;
    emissiveIntensity?: number;
    transparent?: boolean;
    opacity?: number;
    side?: THREE.Side;
    map?: THREE.Texture | null;
  } = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: opts.roughness ?? 0.65,
    metalness: opts.metalness ?? 0.05,
    emissive: opts.emissive !== undefined ? new THREE.Color(opts.emissive) : new THREE.Color(0x000000),
    emissiveIntensity: opts.emissiveIntensity ?? 0,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    map: opts.map ?? null,
  });
}

function darkenColor(hex: string, factor = 0.72): string {
  const c = new THREE.Color(hex);
  c.multiplyScalar(factor);
  return `#${c.getHexString()}`;
}

function lightenColor(hex: string, factor = 0.25): string {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color(0xffffff), factor);
  return `#${c.getHexString()}`;
}

function enableShadows(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

function createFaceTexture(expression: Expression, skinTone: string): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Transparent background so head sphere skin shows seamlessly
  ctx.clearRect(0, 0, 256, 256);

  const eyeY = 112;
  const leftEyeX = 88;
  const rightEyeX = 168;
  const browY = 82;

  // Soft rosy blush cheeks
  const drawBlush = (alpha = 0.28) => {
    ctx.save();
    ctx.fillStyle = `rgba(255, 110, 128, ${alpha})`;
    ctx.beginPath();
    ctx.ellipse(62, 144, 20, 12, 0, 0, Math.PI * 2);
    ctx.ellipse(194, 144, 20, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  // Standard glossy cartoon eye
  const drawOpenEye = (
    cx: number,
    cy: number,
    rx = 16,
    ry = 20,
    pupilOffsetX = 0,
    pupilOffsetY = 0,
    halfLid = false,
  ) => {
    ctx.save();
    // White sclera
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    // Dark iris/pupil
    ctx.fillStyle = '#1E1B24';
    ctx.beginPath();
    ctx.ellipse(cx + pupilOffsetX, cy + pupilOffsetY, rx * 0.65, ry * 0.68, 0, 0, Math.PI * 2);
    ctx.fill();

    // Bright catchlights
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(cx + pupilOffsetX - rx * 0.24, cy + pupilOffsetY - ry * 0.28, rx * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + pupilOffsetX + rx * 0.22, cy + pupilOffsetY + ry * 0.22, rx * 0.11, 0, Math.PI * 2);
    ctx.fill();

    if (halfLid) {
      ctx.fillStyle = skinTone;
      ctx.fillRect(cx - rx - 3, cy - ry - 3, rx * 2 + 6, ry * 0.85);
      ctx.strokeStyle = '#1E1B24';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cx - rx - 2, cy - ry * 0.15);
      ctx.lineTo(cx + rx + 2, cy - ry * 0.15);
      ctx.stroke();
    } else {
      ctx.strokeStyle = '#1E1B24';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  };

  // Subtle cute nose dot/curve
  const drawNose = () => {
    ctx.save();
    ctx.strokeStyle = 'rgba(80, 45, 30, 0.35)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(128, 138, 7, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.restore();
  };

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (expression) {
    case 'happy': {
      drawBlush(0.28);
      drawOpenEye(leftEyeX, eyeY, 16, 19);
      drawOpenEye(rightEyeX, eyeY, 16, 19);
      // Friendly arched brows
      ctx.strokeStyle = '#2A1E1B';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(leftEyeX, browY + 12, 20, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(rightEyeX, browY + 12, 20, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      drawNose();
      // Warm wide smile
      ctx.strokeStyle = '#2A1E1B';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(128, 152, 28, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      break;
    }

    case 'cheeky': {
      drawBlush(0.32);
      drawOpenEye(leftEyeX, eyeY, 16, 18, 4, 0);
      drawOpenEye(rightEyeX, eyeY, 16, 18, 4, 0);
      // Asymmetric mischievous brows
      ctx.strokeStyle = '#2A1E1B';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(leftEyeX - 18, browY + 6);
      ctx.quadraticCurveTo(leftEyeX, browY - 4, leftEyeX + 18, browY + 4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(rightEyeX - 18, browY + 2);
      ctx.quadraticCurveTo(rightEyeX, browY - 12, rightEyeX + 18, browY - 4);
      ctx.stroke();
      drawNose();
      // Sly smirk + tiny cheeky tongue
      ctx.strokeStyle = '#2A1E1B';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(100, 166);
      ctx.quadraticCurveTo(132, 182, 160, 156);
      ctx.stroke();
      ctx.fillStyle = '#F43F5E';
      ctx.beginPath();
      ctx.ellipse(142, 174, 10, 12, 0.25, 0, Math.PI);
      ctx.fill();
      ctx.strokeStyle = '#2A1E1B';
      ctx.lineWidth = 3;
      ctx.stroke();
      break;
    }

    case 'cool': {
      drawOpenEye(leftEyeX, eyeY, 17, 17, 2, 1, true);
      drawOpenEye(rightEyeX, eyeY, 17, 17, 2, 1, true);
      // Confident flat brows
      ctx.strokeStyle = '#2A1E1B';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(leftEyeX - 20, browY + 4);
      ctx.lineTo(leftEyeX + 18, browY + 6);
      ctx.moveTo(rightEyeX - 18, browY + 6);
      ctx.lineTo(rightEyeX + 20, browY + 2);
      ctx.stroke();
      drawNose();
      // Cool asymmetric grin
      ctx.strokeStyle = '#2A1E1B';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(104, 168);
      ctx.quadraticCurveTo(134, 176, 158, 160);
      ctx.stroke();
      break;
    }

    case 'surprised': {
      drawBlush(0.22);
      drawOpenEye(leftEyeX, eyeY, 20, 24, 0, 0);
      drawOpenEye(rightEyeX, eyeY, 20, 24, 0, 0);
      // High raised brows
      ctx.strokeStyle = '#2A1E1B';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(leftEyeX, browY + 4, 20, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(rightEyeX, browY + 4, 20, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      drawNose();
      // Open "O" mouth
      ctx.fillStyle = '#3B1822';
      ctx.beginPath();
      ctx.ellipse(128, 172, 14, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#2A1E1B';
      ctx.lineWidth = 5;
      ctx.stroke();
      break;
    }

    case 'laughing': {
      drawBlush(0.4);
      // Joyful curved ^ ^ eyes
      ctx.strokeStyle = '#1E1B24';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(leftEyeX, eyeY + 8, 18, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(rightEyeX, eyeY + 8, 18, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      // Happy high brows
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(leftEyeX, browY + 12, 18, Math.PI * 1.2, Math.PI * 1.8);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(rightEyeX, browY + 12, 18, Math.PI * 1.2, Math.PI * 1.8);
      ctx.stroke();
      drawNose();
      // Big laughing open mouth with teeth & tongue
      ctx.fillStyle = '#3B1822';
      ctx.beginPath();
      ctx.arc(128, 154, 30, 0.05 * Math.PI, 0.95 * Math.PI);
      ctx.closePath();
      ctx.fill();
      // Upper teeth
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(102, 154, 52, 10);
      // Pink tongue
      ctx.fillStyle = '#F43F5E';
      ctx.beginPath();
      ctx.ellipse(128, 178, 16, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1E1B24';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(128, 154, 30, 0.05 * Math.PI, 0.95 * Math.PI);
      ctx.closePath();
      ctx.stroke();
      break;
    }

    case 'wink': {
      drawBlush(0.32);
      drawOpenEye(leftEyeX, eyeY, 16, 19);
      // Playful wink on right eye
      ctx.strokeStyle = '#1E1B24';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(rightEyeX - 18, eyeY - 6);
      ctx.lineTo(rightEyeX + 12, eyeY + 2);
      ctx.lineTo(rightEyeX - 16, eyeY + 12);
      ctx.stroke();
      // Brows
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(leftEyeX, browY + 10, 19, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(rightEyeX, browY + 16, 18, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      drawNose();
      // Upbeat smile
      ctx.beginPath();
      ctx.arc(128, 154, 26, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      break;
    }

    case 'focused': {
      drawOpenEye(leftEyeX, eyeY + 2, 15, 16, 0, 0);
      drawOpenEye(rightEyeX, eyeY + 2, 15, 16, 0, 0);
      // Determined angled brows
      ctx.strokeStyle = '#2A1E1B';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(leftEyeX - 20, browY);
      ctx.lineTo(leftEyeX + 18, browY + 12);
      ctx.moveTo(rightEyeX + 20, browY);
      ctx.lineTo(rightEyeX - 18, browY + 12);
      ctx.stroke();
      drawNose();
      // Determined slight smirk
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(106, 168);
      ctx.quadraticCurveTo(128, 164, 150, 168);
      ctx.stroke();
      break;
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createJerseyNumberTexture(shirtColor: string): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, 128, 128);
  const c = new THREE.Color(shirtColor);
  const luminance = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  const textColor = luminance > 0.6 ? '#0F172A' : '#FFFFFF';

  ctx.fillStyle = textColor;
  ctx.font = 'bold 74px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('07', 64, 68);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function buildHair(style: HairStyle, hairColor: string, headRadius: number): THREE.Group {
  const group = new THREE.Group();
  const hairMat = makeMat(hairColor, { roughness: 0.72, metalness: 0.05 });
  const highlightMat = makeMat(lightenColor(hairColor, 0.15), { roughness: 0.65 });
  const r = headRadius;

  // Helper for a base skullcap covering the top & back of the head
  const addSkullCap = (scaleY = 1.04) => {
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(r * 1.05, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.58),
      hairMat,
    );
    cap.scale.set(1.02, scaleY, 1.04);
    cap.position.y = r * 0.06;
    group.add(cap);

    const backCap = new THREE.Mesh(
      new THREE.SphereGeometry(r * 1.04, 16, 12, Math.PI * 0.65, Math.PI * 1.7, 0.2, Math.PI * 0.68),
      hairMat,
    );
    backCap.rotation.y = Math.PI * 0.5;
    group.add(backCap);
  };

  switch (style) {
    case 'spiky': {
      addSkullCap(1.02);
      const spikePositions: [number, number, number, number, number, number][] = [
        [0, r * 1.12, r * 0.18, 0.25, 0, 0.12],
        [-0.09, r * 1.08, r * 0.05, 0.05, 0.35, 0.11],
        [0.09, r * 1.08, r * 0.05, 0.05, -0.35, 0.11],
        [0, r * 1.06, -r * 0.25, -0.35, 0, 0.11],
        [-0.14, r * 0.92, -r * 0.12, -0.15, 0.65, 0.095],
        [0.14, r * 0.92, -r * 0.12, -0.15, -0.65, 0.095],
        [0, r * 0.95, r * 0.48, 0.58, 0, 0.09],
        [-0.11, r * 0.95, r * 0.36, 0.45, 0.3, 0.085],
        [0.11, r * 0.95, r * 0.36, 0.45, -0.3, 0.085],
      ];
      for (const [x, y, z, rx, rz, rad] of spikePositions) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(rad, r * 0.95, 7), hairMat);
        spike.position.set(x, y, z);
        spike.rotation.set(rx, 0, rz);
        group.add(spike);
      }
      break;
    }

    case 'bob': {
      addSkullCap(1.06);
      // Curved side curtains framing the face
      for (const side of [-1, 1]) {
        const flap = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.26, r * 0.72, 6, 10), hairMat);
        flap.position.set(side * r * 0.92, -r * 0.18, -r * 0.02);
        flap.rotation.z = side * -0.12;
        group.add(flap);
      }
      // Full rounded back bob
      const backBob = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.03, r * 1.08, r * 1.05, 16, 1, false, Math.PI * 0.45, Math.PI * 1.1), hairMat);
      backBob.position.set(0, -r * 0.15, -r * 0.04);
      group.add(backBob);
      // Cute front bangs
      const bangs = new THREE.Mesh(new THREE.BoxGeometry(r * 1.5, r * 0.34, r * 0.3), hairMat);
      bangs.position.set(0, r * 0.62, r * 0.85);
      bangs.rotation.x = -0.18;
      group.add(bangs);
      break;
    }

    case 'afro': {
      const mainPuff = new THREE.Mesh(new THREE.SphereGeometry(r * 1.38, 18, 16), hairMat);
      mainPuff.position.set(0, r * 0.36, -r * 0.12);
      group.add(mainPuff);
      const puffOffsets: [number, number, number, number][] = [
        [-r * 0.85, r * 0.42, 0.02, 0.56],
        [r * 0.85, r * 0.42, 0.02, 0.56],
        [0, r * 1.05, -0.04, 0.62],
        [-r * 0.58, r * 0.92, -0.08, 0.52],
        [r * 0.58, r * 0.92, -0.08, 0.52],
        [0, r * 0.4, -r * 0.95, 0.62],
        [-r * 0.68, r * 0.05, -r * 0.55, 0.5],
        [r * 0.68, r * 0.05, -r * 0.55, 0.5],
        [0, r * 0.84, r * 0.62, 0.46],
      ];
      for (const [x, y, z, scale] of puffOffsets) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(r * scale, 12, 10), hairMat);
        puff.position.set(x, y, z);
        group.add(puff);
      }
      break;
    }

    case 'mohawk': {
      // Close buzz base
      const buzz = new THREE.Mesh(
        new THREE.SphereGeometry(r * 1.02, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.52),
        makeMat(darkenColor(hairColor, 0.65), { roughness: 0.9 }),
      );
      buzz.position.y = r * 0.03;
      group.add(buzz);

      // Bold central fin ridge of 6 tall sculpted segments
      for (let i = 0; i < 6; i++) {
        const t = i / 5;
        const angle = -0.55 + t * 1.55;
        const finHeight = r * (0.95 - Math.abs(t - 0.35) * 0.35);
        const fin = new THREE.Mesh(new THREE.BoxGeometry(r * 0.22, finHeight, r * 0.34), i % 2 === 0 ? hairMat : highlightMat);
        fin.position.set(0, Math.cos(angle) * (r * 1.15), -Math.sin(angle) * (r * 1.15) + r * 0.25);
        fin.rotation.x = -angle;
        group.add(fin);
      }
      break;
    }

    case 'long': {
      addSkullCap(1.06);
      // Long cascading back hair
      const backFlow = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.82, r * 1.45, 8, 14), hairMat);
      backFlow.scale.set(1.18, 1, 0.46);
      backFlow.position.set(0, -r * 0.72, -r * 0.68);
      backFlow.rotation.x = 0.12;
      group.add(backFlow);
      // Side locks
      for (const side of [-1, 1]) {
        const lock = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.24, r * 1.35, 6, 10), hairMat);
        lock.position.set(side * r * 0.88, -r * 0.52, -r * 0.04);
        lock.rotation.z = side * -0.06;
        group.add(lock);
      }
      // Swept side bangs
      const sweep = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.18, r * 0.9, 6, 10), highlightMat);
      sweep.position.set(r * 0.15, r * 0.68, r * 0.82);
      sweep.rotation.z = 1.25;
      sweep.rotation.x = -0.2;
      group.add(sweep);
      break;
    }

    case 'ponytail': {
      addSkullCap(1.04);
      // Hair tie ring
      const tie = new THREE.Mesh(
        new THREE.TorusGeometry(r * 0.22, r * 0.06, 8, 16),
        makeMat('#F43F5E', { roughness: 0.4 }),
      );
      tie.position.set(0, r * 0.45, -r * 1.05);
      tie.rotation.x = 0.35;
      group.add(tie);
      // Flowing curved ponytail
      const upperTail = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.24, r * 0.55, 6, 10), hairMat);
      upperTail.position.set(0, r * 0.32, -r * 1.32);
      upperTail.rotation.x = 0.7;
      group.add(upperTail);
      const lowerTail = new THREE.Mesh(new THREE.ConeGeometry(r * 0.28, r * 1.1, 10), hairMat);
      lowerTail.position.set(0, -r * 0.35, -r * 1.52);
      lowerTail.rotation.x = Math.PI + 0.15;
      group.add(lowerTail);
      break;
    }

    case 'bun': {
      addSkullCap(1.03);
      // Decorative hair band
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(r * 0.34, r * 0.055, 8, 16),
        makeMat('#FACC15', { roughness: 0.4 }),
      );
      band.position.set(0, r * 1.02, -r * 0.12);
      band.rotation.x = Math.PI / 2;
      group.add(band);
      // Plump top bun
      const bun = new THREE.Mesh(new THREE.SphereGeometry(r * 0.46, 14, 12), hairMat);
      bun.position.set(0, r * 1.28, -r * 0.12);
      bun.scale.set(1.05, 0.88, 1.05);
      group.add(bun);
      break;
    }

    case 'curly': {
      addSkullCap(1.04);
      const curlCoords: [number, number, number, number][] = [
        [0, r * 1.02, r * 0.32, 0.34],
        [-r * 0.52, r * 0.92, r * 0.42, 0.32],
        [r * 0.52, r * 0.92, r * 0.42, 0.32],
        [-r * 0.92, r * 0.5, r * 0.12, 0.34],
        [r * 0.92, r * 0.5, r * 0.12, 0.34],
        [-r * 0.96, r * 0.02, -r * 0.08, 0.32],
        [r * 0.96, r * 0.02, -r * 0.08, 0.32],
        [-r * 0.55, r * 0.95, -r * 0.35, 0.36],
        [r * 0.55, r * 0.95, -r * 0.35, 0.36],
        [0, r * 1.08, -r * 0.25, 0.38],
        [-r * 0.65, r * 0.42, -r * 0.78, 0.36],
        [r * 0.65, r * 0.42, -r * 0.78, 0.36],
        [0, r * 0.48, -r * 0.92, 0.38],
        [0, -r * 0.05, -r * 0.92, 0.34],
      ];
      for (const [x, y, z, scale] of curlCoords) {
        const curl = new THREE.Mesh(new THREE.SphereGeometry(r * scale, 10, 10), hairMat);
        curl.position.set(x, y, z);
        group.add(curl);
      }
      break;
    }

    case 'buzz': {
      const buzzCap = new THREE.Mesh(
        new THREE.SphereGeometry(r * 1.035, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.54),
        makeMat(hairColor, { roughness: 0.92 }),
      );
      buzzCap.position.y = r * 0.03;
      group.add(buzzCap);
      const buzzBack = new THREE.Mesh(
        new THREE.SphereGeometry(r * 1.03, 16, 12, Math.PI * 0.72, Math.PI * 1.56, 0.25, Math.PI * 0.52),
        makeMat(hairColor, { roughness: 0.92 }),
      );
      buzzBack.rotation.y = Math.PI * 0.5;
      group.add(buzzBack);
      break;
    }

    case 'pompadour': {
      addSkullCap(1.0);
      // Dramatic sweeping front wave
      const wave = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.42, r * 0.85, 8, 12), hairMat);
      wave.position.set(0, r * 1.04, r * 0.38);
      wave.rotation.x = 1.25;
      wave.scale.set(1.15, 1.0, 0.85);
      group.add(wave);
      const frontCurl = new THREE.Mesh(new THREE.SphereGeometry(r * 0.44, 14, 12), highlightMat);
      frontCurl.position.set(0, r * 0.98, r * 0.82);
      frontCurl.scale.set(1.1, 0.82, 0.9);
      group.add(frontCurl);
      break;
    }
  }

  return group;
}

function buildShirtDetails(
  torso: THREE.Group,
  style: ShirtStyle,
  shirtColor: string,
  skinTone: string,
  p: BodyProportions,
): void {
  const shirtMat = makeMat(shirtColor, { roughness: 0.7 });
  const darkShirtMat = makeMat(darkenColor(shirtColor, 0.72), { roughness: 0.75 });
  const lightTrimMat = makeMat('#F8FAFC', { roughness: 0.55 });
  const darkTrimMat = makeMat('#1E293B', { roughness: 0.6 });

  const w = p.torsoWidth;
  const h = p.torsoHeight;
  const d = p.torsoDepth;

  // Main rounded torso core
  const torsoMesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d, 2, 2, 2),
    shirtMat,
  );
  // Subtle rounded edges via bevelled shoulder/chest cap
  torsoMesh.position.y = h * 0.5;
  torso.add(torsoMesh);

  const shoulderRound = new THREE.Mesh(
    new THREE.CapsuleGeometry(d * 0.5, w - d * 0.3, 6, 12),
    shirtMat,
  );
  shoulderRound.rotation.z = Math.PI / 2;
  shoulderRound.position.y = h * 0.92;
  torso.add(shoulderRound);

  switch (style) {
    case 'tshirt': {
      const collar = new THREE.Mesh(
        new THREE.TorusGeometry(0.095, 0.02, 8, 16),
        darkShirtMat,
      );
      collar.rotation.x = Math.PI / 2;
      collar.position.y = h + 0.01;
      torso.add(collar);
      break;
    }

    case 'hoodie': {
      // Resting hood behind neck
      const hood = new THREE.Mesh(
        new THREE.TorusGeometry(0.145, 0.055, 8, 16, Math.PI * 1.4),
        darkShirtMat,
      );
      hood.position.set(0, h + 0.01, -d * 0.25);
      hood.rotation.x = Math.PI * 0.42;
      hood.rotation.z = Math.PI * 0.8;
      torso.add(hood);

      // Front kangaroo pocket
      const pocket = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.64, h * 0.28, 0.03),
        darkShirtMat,
      );
      pocket.position.set(0, h * 0.22, d * 0.5 + 0.012);
      torso.add(pocket);

      // Drawstrings
      for (const side of [-1, 1]) {
        const stringMesh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.008, 0.008, h * 0.34, 6),
          lightTrimMat,
        );
        stringMesh.position.set(side * 0.045, h * 0.78, d * 0.5 + 0.014);
        torso.add(stringMesh);
      }
      break;
    }

    case 'jacket': {
      // Inner contrast tee visible down front
      const innerTee = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.32, h * 0.94, 0.025),
        lightTrimMat,
      );
      innerTee.position.set(0, h * 0.5, d * 0.5 + 0.006);
      torso.add(innerTee);

      // Left & right jacket lapels
      for (const side of [-1, 1]) {
        const lapel = new THREE.Mesh(
          new THREE.BoxGeometry(w * 0.14, h * 0.48, 0.028),
          darkShirtMat,
        );
        lapel.position.set(side * w * 0.18, h * 0.72, d * 0.5 + 0.014);
        lapel.rotation.z = side * 0.18;
        torso.add(lapel);
      }

      // Ribbed bottom hem
      const hem = new THREE.Mesh(
        new THREE.BoxGeometry(w * 1.03, 0.055, d * 1.04),
        darkTrimMat,
      );
      hem.position.y = 0.03;
      torso.add(hem);
      break;
    }

    case 'jersey': {
      // Sporty V-neck trim & horizontal chest stripe
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(w * 1.02, 0.06, d * 1.03),
        lightTrimMat,
      );
      stripe.position.y = h * 0.82;
      torso.add(stripe);

      // Jersey number plate on front & back
      const numTex = createJerseyNumberTexture(shirtColor);
      if (numTex) {
        const numMat = new THREE.MeshBasicMaterial({ map: numTex, transparent: true });
        const frontNum = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.18), numMat);
        frontNum.position.set(0, h * 0.48, d * 0.5 + 0.008);
        torso.add(frontNum);

        const backNum = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), numMat);
        backNum.position.set(0, h * 0.5, -d * 0.5 - 0.008);
        backNum.rotation.y = Math.PI;
        torso.add(backNum);
      }
      break;
    }

    case 'suit': {
      // Crisp white dress shirt V-front
      const shirtFront = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.26, h * 0.62, 0.02),
        lightTrimMat,
      );
      shirtFront.position.set(0, h * 0.68, d * 0.5 + 0.005);
      torso.add(shirtFront);

      // Classic bowtie / necktie
      const tieMat = makeMat('#EF4444', { roughness: 0.45 });
      const knot = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.025), tieMat);
      knot.position.set(0, h * 0.92, d * 0.5 + 0.018);
      torso.add(knot);

      for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.06, 4), tieMat);
        wing.position.set(side * 0.045, h * 0.92, d * 0.5 + 0.018);
        wing.rotation.z = side * (Math.PI / 2);
        torso.add(wing);
      }

      // Tailored lapels + brass buttons
      const goldMat = makeMat('#FACC15', { roughness: 0.25, metalness: 0.75 });
      for (let i = 0; i < 2; i++) {
        const btn = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), goldMat);
        btn.position.set(0, h * (0.28 + i * 0.16), d * 0.5 + 0.015);
        torso.add(btn);
      }
      break;
    }

    case 'sweater': {
      // Cozy ribbed turtleneck collar
      const turtleneck = new THREE.Mesh(
        new THREE.CylinderGeometry(0.095, 0.105, 0.075, 14),
        darkShirtMat,
      );
      turtleneck.position.y = h + 0.03;
      torso.add(turtleneck);

      // Accent knit chest band
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(w * 1.02, 0.08, d * 1.03),
        makeMat(lightenColor(shirtColor, 0.4), { roughness: 0.85 }),
      );
      band.position.y = h * 0.62;
      torso.add(band);
      break;
    }

    case 'tank': {
      // Exposed skin scoop collar
      const skinScoop = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.09, 0.03, 12),
        makeMat(skinTone, { roughness: 0.65 }),
      );
      skinScoop.position.set(0, h + 0.005, 0.02);
      torso.add(skinScoop);
      break;
    }

    case 'robe': {
      // Plush shawl collar + tied waist belt
      const collarMat = makeMat(lightenColor(shirtColor, 0.35), { roughness: 0.85 });
      for (const side of [-1, 1]) {
        const shawl = new THREE.Mesh(
          new THREE.BoxGeometry(0.07, h * 0.55, 0.035),
          collarMat,
        );
        shawl.position.set(side * 0.075, h * 0.72, d * 0.5 + 0.012);
        shawl.rotation.z = side * 0.22;
        torso.add(shawl);
      }
      const belt = new THREE.Mesh(
        new THREE.BoxGeometry(w * 1.06, 0.06, d * 1.08),
        collarMat,
      );
      belt.position.y = h * 0.26;
      torso.add(belt);
      const sash = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.03), collarMat);
      sash.position.set(0.05, h * 0.14, d * 0.5 + 0.02);
      sash.rotation.z = -0.15;
      torso.add(sash);
      break;
    }
  }
}

function buildAccessory(
  accessory: Accessory,
  accessoryColor: string,
  head: THREE.Group,
  torso: THREE.Group,
  p: BodyProportions,
): void {
  if (accessory === 'none') return;

  const r = p.headRadius;
  const accentMat = makeMat(accessoryColor, { roughness: 0.4, metalness: 0.25 });

  switch (accessory) {
    case 'sunglasses': {
      const frameMat = makeMat(accessoryColor, { roughness: 0.3, metalness: 0.3 });
      const lensMat = makeMat('#0F172A', { roughness: 0.1, metalness: 0.85 });
      const glasses = new THREE.Group();
      glasses.position.set(0, 0.02, r * 0.96);

      for (const side of [-1, 1]) {
        const lens = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.075, 0.025), lensMat);
        lens.position.set(side * 0.078, 0, 0);
        glasses.add(lens);

        const rim = new THREE.Mesh(new THREE.BoxGeometry(0.128, 0.088, 0.018), frameMat);
        rim.position.set(side * 0.078, 0, -0.005);
        glasses.add(rim);

        const temple = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.02, r * 1.1), frameMat);
        temple.position.set(side * 0.142, 0.01, -r * 0.52);
        glasses.add(temple);
      }

      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.02), frameMat);
      bridge.position.set(0, 0.015, 0);
      glasses.add(bridge);
      head.add(glasses);
      break;
    }

    case 'crown': {
      const goldMat = makeMat('#FACC15', { roughness: 0.2, metalness: 0.85 });
      const velvetMat = makeMat('#DC2626', { roughness: 0.8 });
      const crown = new THREE.Group();
      crown.position.set(0, r * 1.05, 0);

      const baseRing = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.72, r * 0.64, 0.08, 16),
        goldMat,
      );
      crown.add(baseRing);

      const innerCap = new THREE.Mesh(
        new THREE.SphereGeometry(r * 0.56, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
        velvetMat,
      );
      innerCap.position.y = 0.02;
      crown.add(innerCap);

      const gemColors = ['#EF4444', '#0EA5E9', '#22C55E', '#A855F7', '#F97316'];
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const px = Math.sin(angle) * r * 0.66;
        const pz = Math.cos(angle) * r * 0.66;
        const peak = new THREE.Mesh(new THREE.ConeGeometry(0.042, 0.11, 5), goldMat);
        peak.position.set(px, 0.085, pz);
        crown.add(peak);

        const gem = new THREE.Mesh(
          new THREE.SphereGeometry(0.02, 8, 8),
          makeMat(gemColors[i], { roughness: 0.15, metalness: 0.3, emissive: gemColors[i], emissiveIntensity: 0.2 }),
        );
        gem.position.set(px * 1.06, 0.0, pz * 1.06);
        crown.add(gem);
      }
      head.add(crown);
      break;
    }

    case 'headphones': {
      const bandMat = makeMat('#1E293B', { roughness: 0.4, metalness: 0.3 });
      const padMat = makeMat('#334155', { roughness: 0.85 });
      const glowMat = makeMat(accessoryColor, {
        roughness: 0.25,
        metalness: 0.4,
        emissive: accessoryColor,
        emissiveIntensity: 0.45,
      });

      const arch = new THREE.Mesh(
        new THREE.TorusGeometry(r * 1.12, 0.026, 8, 22, Math.PI),
        bandMat,
      );
      arch.position.y = 0.02;
      head.add(arch);

      for (const side of [-1, 1]) {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.055, 16), accentMat);
        cup.rotation.z = Math.PI / 2;
        cup.position.set(side * (r * 1.08), 0.0, 0);
        head.add(cup);

        const cushion = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.022, 8, 16), padMat);
        cushion.rotation.y = Math.PI / 2;
        cushion.position.set(side * (r * 1.01), 0.0, 0);
        head.add(cushion);

        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.01, 6, 16), glowMat);
        ring.rotation.y = Math.PI / 2;
        ring.position.set(side * (r * 1.12), 0.0, 0);
        head.add(ring);
      }
      break;
    }

    case 'scarf': {
      const scarfMat = makeMat(accessoryColor, { roughness: 0.85 });
      const stripeMat = makeMat(lightenColor(accessoryColor, 0.45), { roughness: 0.85 });

      const wrap = new THREE.Mesh(
        new THREE.TorusGeometry(0.14, 0.048, 10, 18),
        scarfMat,
      );
      wrap.rotation.x = Math.PI / 2;
      wrap.position.y = p.torsoHeight + 0.02;
      torso.add(wrap);

      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.26, 0.032), scarfMat);
      tail.position.set(0.075, p.torsoHeight - 0.11, p.torsoDepth * 0.5 + 0.032);
      tail.rotation.z = -0.14;
      torso.add(tail);

      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.035, 0.034), stripeMat);
      stripe.position.set(0.085, p.torsoHeight - 0.19, p.torsoDepth * 0.5 + 0.033);
      stripe.rotation.z = -0.14;
      torso.add(stripe);
      break;
    }

    case 'cape': {
      const capeMat = makeMat(accessoryColor, { roughness: 0.72, side: THREE.DoubleSide });
      const claspMat = makeMat('#FACC15', { roughness: 0.25, metalness: 0.8 });

      const collar = new THREE.Mesh(
        new THREE.TorusGeometry(0.135, 0.022, 8, 16),
        claspMat,
      );
      collar.rotation.x = Math.PI / 2;
      collar.position.y = p.torsoHeight + 0.015;
      torso.add(collar);

      // Flowing multi-segment cape
      const upperCape = new THREE.Mesh(
        new THREE.BoxGeometry(p.torsoWidth * 1.15, p.torsoHeight * 0.85, 0.024),
        capeMat,
      );
      upperCape.position.set(0, p.torsoHeight * 0.55, -p.torsoDepth * 0.5 - 0.055);
      upperCape.rotation.x = 0.14;
      torso.add(upperCape);

      const lowerCape = new THREE.Mesh(
        new THREE.BoxGeometry(p.torsoWidth * 1.38, p.torsoHeight * 0.75, 0.022),
        capeMat,
      );
      lowerCape.position.set(0, p.torsoHeight * 0.02, -p.torsoDepth * 0.5 - 0.12);
      lowerCape.rotation.x = 0.22;
      torso.add(lowerCape);
      break;
    }

    case 'top_hat': {
      const hatMat = makeMat('#18181B', { roughness: 0.55 });
      const ribbonMat = makeMat(accessoryColor, { roughness: 0.35 });
      const hat = new THREE.Group();
      hat.position.set(0, r * 1.0, 0);

      const brim = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.12, r * 1.12, 0.026, 20), hatMat);
      hat.add(brim);

      const crownMesh = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.74, r * 0.64, 0.28, 18), hatMat);
      crownMesh.position.y = 0.15;
      hat.add(crownMesh);

      const ribbon = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.68, r * 0.66, 0.055, 18), ribbonMat);
      ribbon.position.y = 0.045;
      hat.add(ribbon);
      head.add(hat);
      break;
    }

    case 'party_hat': {
      const hatMat = makeMat(accessoryColor, { roughness: 0.5 });
      const pomMat = makeMat('#FACC15', { roughness: 0.8 });
      const hat = new THREE.Group();
      hat.position.set(0.03, r * 1.02, 0.02);
      hat.rotation.z = -0.15;

      const cone = new THREE.Mesh(new THREE.ConeGeometry(r * 0.58, 0.34, 16), hatMat);
      cone.position.y = 0.16;
      hat.add(cone);

      const trim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.56, 0.024, 8, 16), pomMat);
      trim.rotation.x = Math.PI / 2;
      hat.add(trim);

      const pom = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), pomMat);
      pom.position.y = 0.34;
      hat.add(pom);
      head.add(hat);
      break;
    }

    case 'backpack': {
      const packMat = makeMat(accessoryColor, { roughness: 0.65 });
      const pocketMat = makeMat(darkenColor(accessoryColor, 0.75), { roughness: 0.7 });
      const strapMat = makeMat('#334155', { roughness: 0.8 });

      const pack = new THREE.Group();
      pack.position.set(0, p.torsoHeight * 0.52, -p.torsoDepth * 0.5 - 0.1);

      const mainBag = new THREE.Mesh(new THREE.BoxGeometry(p.torsoWidth * 0.78, p.torsoHeight * 0.76, 0.16), packMat);
      pack.add(mainBag);

      const topDome = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.075, p.torsoWidth * 0.5, 6, 10),
        packMat,
      );
      topDome.rotation.z = Math.PI / 2;
      topDome.position.y = p.torsoHeight * 0.36;
      pack.add(topDome);

      const frontPocket = new THREE.Mesh(
        new THREE.BoxGeometry(p.torsoWidth * 0.58, p.torsoHeight * 0.34, 0.05),
        pocketMat,
      );
      frontPocket.position.set(0, -p.torsoHeight * 0.14, -0.09);
      pack.add(frontPocket);

      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 12, Math.PI), strapMat);
      handle.position.y = p.torsoHeight * 0.44;
      pack.add(handle);

      // Shoulder straps wrapping torso
      for (const side of [-1, 1]) {
        const strap = new THREE.Mesh(
          new THREE.BoxGeometry(0.04, p.torsoHeight * 0.82, p.torsoDepth + 0.04),
          strapMat,
        );
        strap.position.set(side * p.torsoWidth * 0.32, p.torsoHeight * 0.52, 0);
        torso.add(strap);
      }

      torso.add(pack);
      break;
    }
  }
}

function buildSpokedWheel(
  radius: number,
  tireThickness: number,
  rimColor: string,
  withPushRim: boolean,
  spokeCount = 8,
): THREE.Group {
  const wheelGroup = new THREE.Group();
  const tireMat = makeMat('#18181B', { roughness: 0.85, metalness: 0.05 });
  const rimMat = makeMat(rimColor, { roughness: 0.3, metalness: 0.65 });
  const chromeMat = makeMat('#E2E8F0', { roughness: 0.2, metalness: 0.85 });

  // Outer rubber tire
  const tire = new THREE.Mesh(new THREE.TorusGeometry(radius, tireThickness, 10, 24), tireMat);
  tire.rotation.y = Math.PI / 2;
  wheelGroup.add(tire);

  // Colored inner rim
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(radius - tireThickness * 0.9, tireThickness * 0.55, 8, 22),
    rimMat,
  );
  rim.rotation.y = Math.PI / 2;
  wheelGroup.add(rim);

  // Center hub
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.05, 12), chromeMat);
  hub.rotation.z = Math.PI / 2;
  wheelGroup.add(hub);

  // Spokes
  for (let i = 0; i < spokeCount; i++) {
    const angle = (i / spokeCount) * Math.PI;
    const spoke = new THREE.Mesh(
      new THREE.CylinderGeometry(0.007, 0.007, (radius - tireThickness) * 2, 6),
      chromeMat,
    );
    spoke.rotation.x = angle;
    wheelGroup.add(spoke);
  }

  // Silver push-rim for manual/racing wheelchairs
  if (withPushRim) {
    const pushRim = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 0.84, 0.011, 6, 22),
      chromeMat,
    );
    pushRim.rotation.y = Math.PI / 2;
    pushRim.position.x = 0.028;
    wheelGroup.add(pushRim);
  }

  return wheelGroup;
}

function buildSmallWheel(radius: number, width: number, hubColor: string): THREE.Group {
  const group = new THREE.Group();
  const tireMat = makeMat('#18181B', { roughness: 0.85 });
  const hubMat = makeMat(hubColor, { roughness: 0.35, metalness: 0.5 });

  const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 16), tireMat);
  tire.rotation.z = Math.PI / 2;
  group.add(tire);

  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.52, radius * 0.52, width + 0.008, 12),
    hubMat,
  );
  hub.rotation.z = Math.PI / 2;
  group.add(hub);

  return group;
}

function buildManualWheelchair(
  color: string,
  mobilityGroup: THREE.Group,
  wheels: THREE.Object3D[],
): void {
  const frameMat = makeMat(color, { roughness: 0.3, metalness: 0.65 });
  const cushionMat = makeMat('#1E293B', { roughness: 0.85 });
  const chromeMat = makeMat('#CBD5E1', { roughness: 0.25, metalness: 0.8 });

  // Cushioned seat & backrest
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.44), cushionMat);
  seat.position.set(0, 0.42, 0.02);
  mobilityGroup.add(seat);

  const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.06), cushionMat);
  backrest.position.set(0, 0.68, -0.2);
  mobilityGroup.add(backrest);

  // Side frames, armrests, push handles, footrests
  for (const side of [-1, 1]) {
    // Vertical back post + push handle
    const backPost = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.62, 8), frameMat);
    backPost.position.set(side * 0.24, 0.68, -0.22);
    mobilityGroup.add(backPost);

    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.14, 8), cushionMat);
    handle.rotation.x = Math.PI / 2;
    handle.position.set(side * 0.24, 0.98, -0.28);
    mobilityGroup.add(handle);

    // Lower horizontal rail
    const lowerRail = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.48, 8), frameMat);
    lowerRail.rotation.x = Math.PI / 2;
    lowerRail.position.set(side * 0.24, 0.38, 0.02);
    mobilityGroup.add(lowerRail);

    // Armrest
    const armPad = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.36), cushionMat);
    armPad.position.set(side * 0.25, 0.64, -0.02);
    mobilityGroup.add(armPad);

    const armFrontPost = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.26, 8), frameMat);
    armFrontPost.position.set(side * 0.24, 0.51, 0.14);
    mobilityGroup.add(armFrontPost);

    // Front leg drop tube + footrest plate
    const legTube = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.34, 8), chromeMat);
    legTube.position.set(side * 0.2, 0.24, 0.28);
    legTube.rotation.x = 0.28;
    mobilityGroup.add(legTube);

    const footplate = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.16), cushionMat);
    footplate.position.set(side * 0.13, 0.11, 0.36);
    mobilityGroup.add(footplate);

    // Large spoked rear wheel
    const rearWheel = buildSpokedWheel(0.3, 0.024, color, true, 8);
    rearWheel.position.set(side * 0.3, 0.32, -0.08);
    if (side === -1) {
      // Mirror push-rim to outer side
      rearWheel.scale.x = -1;
    }
    mobilityGroup.add(rearWheel);
    wheels.push(rearWheel);

    // Small front caster wheel
    const caster = buildSmallWheel(0.085, 0.035, color);
    caster.position.set(side * 0.22, 0.085, 0.24);
    mobilityGroup.add(caster);
    wheels.push(caster);
  }

  // Cross-brace under seat
  const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.44, 8), chromeMat);
  brace.rotation.z = Math.PI / 2;
  brace.position.set(0, 0.28, -0.04);
  mobilityGroup.add(brace);
}

function buildRacingWheelchair(
  color: string,
  mobilityGroup: THREE.Group,
  wheels: THREE.Object3D[],
): void {
  const frameMat = makeMat(color, { roughness: 0.2, metalness: 0.75 });
  const carbonMat = makeMat('#111827', { roughness: 0.4, metalness: 0.35 });
  const neonMat = makeMat(lightenColor(color, 0.35), {
    roughness: 0.2,
    metalness: 0.4,
    emissive: color,
    emissiveIntensity: 0.45,
  });
  const chromeMat = makeMat('#E2E8F0', { roughness: 0.15, metalness: 0.9 });

  // Low-slung bucket racing seat
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.055, 0.44), carbonMat);
  seat.position.set(0, 0.34, 0.0);
  seat.rotation.x = -0.08;
  mobilityGroup.add(seat);

  const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.32, 0.055), carbonMat);
  backrest.position.set(0, 0.52, -0.2);
  backrest.rotation.x = -0.15;
  mobilityGroup.add(backrest);

  // Aerodynamic long front boom to single front racing wheel
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.72, 10), frameMat);
  boom.rotation.x = Math.PI / 2 - 0.12;
  boom.position.set(0, 0.26, 0.34);
  mobilityGroup.add(boom);

  // Front fork + sleek front racing wheel
  const frontFork = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.16, 0.04), frameMat);
  frontFork.position.set(0, 0.24, 0.62);
  frontFork.rotation.x = -0.25;
  mobilityGroup.add(frontFork);

  const frontWheel = buildSpokedWheel(0.18, 0.018, color, false, 6);
  frontWheel.position.set(0, 0.19, 0.65);
  mobilityGroup.add(frontWheel);
  wheels.push(frontWheel);

  // Twin turbo exhaust pipes at the rear!
  for (const side of [-1, 1]) {
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.036, 0.26, 10), chromeMat);
    exhaust.rotation.x = Math.PI / 2 - 0.22;
    exhaust.position.set(side * 0.12, 0.34, -0.32);
    mobilityGroup.add(exhaust);

    const flameTip = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 8), neonMat);
    flameTip.position.set(side * 0.12, 0.36, -0.45);
    mobilityGroup.add(flameTip);
  }

  // Racing number plate on rear
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.02), makeMat('#F8FAFC', { roughness: 0.4 }));
  plate.position.set(0, 0.56, -0.24);
  mobilityGroup.add(plate);

  // Cambered large rear racing wheels (±10 deg camber)
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.64, 10), frameMat);
  axle.rotation.z = Math.PI / 2;
  axle.position.set(0, 0.33, -0.06);
  mobilityGroup.add(axle);

  for (const side of [-1, 1]) {
    const camberHolder = new THREE.Group();
    camberHolder.position.set(side * 0.34, 0.33, -0.06);
    camberHolder.rotation.z = side * 0.18;

    const rearWheel = buildSpokedWheel(0.32, 0.02, color, true, 10);
    if (side === -1) rearWheel.scale.x = -1;
    camberHolder.add(rearWheel);
    mobilityGroup.add(camberHolder);
    wheels.push(rearWheel);
  }
}

function buildPowerWheelchair(
  color: string,
  mobilityGroup: THREE.Group,
  wheels: THREE.Object3D[],
): void {
  const bodyMat = makeMat(color, { roughness: 0.3, metalness: 0.5 });
  const baseMat = makeMat('#1E293B', { roughness: 0.6, metalness: 0.3 });
  const plushMat = makeMat('#334155', { roughness: 0.85 });
  const headlightMat = makeMat('#E0F2FE', {
    roughness: 0.1,
    emissive: '#38BDF8',
    emissiveIntensity: 1.2,
  });
  const taillightMat = makeMat('#EF4444', {
    roughness: 0.2,
    emissive: '#EF4444',
    emissiveIntensity: 0.9,
  });

  // Motorized battery chassis base
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.58), baseMat);
  chassis.position.set(0, 0.22, 0.0);
  mobilityGroup.add(chassis);

  const shroud = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.12, 0.5), bodyMat);
  shroud.position.set(0, 0.32, -0.02);
  mobilityGroup.add(shroud);

  // Glowing LED headlights & taillights
  for (const side of [-1, 1]) {
    const headlight = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.03, 10), headlightMat);
    headlight.rotation.x = Math.PI / 2;
    headlight.position.set(side * 0.17, 0.26, 0.295);
    mobilityGroup.add(headlight);

    const taillight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.035, 0.02), taillightMat);
    taillight.position.set(side * 0.16, 0.26, -0.295);
    mobilityGroup.add(taillight);
  }

  // Captain's plush seat, high backrest, headrest
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.08, 0.46), plushMat);
  seat.position.set(0, 0.44, 0.02);
  mobilityGroup.add(seat);

  const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.52, 0.09), plushMat);
  backrest.position.set(0, 0.72, -0.2);
  mobilityGroup.add(backrest);

  const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.08), plushMat);
  headrest.position.set(0, 1.06, -0.21);
  mobilityGroup.add(headrest);

  // Wide armrests + right-side joystick controller
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.05, 0.4), plushMat);
    arm.position.set(side * 0.27, 0.66, 0.0);
    mobilityGroup.add(arm);

    const support = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.06), baseMat);
    support.position.set(side * 0.26, 0.54, -0.1);
    mobilityGroup.add(support);
  }

  // Right-side joystick box & stick (on +X or -X depending on rightArm; rightArm is at -X when facing +Z)
  const joyBox = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.055, 0.12), baseMat);
  joyBox.position.set(-0.27, 0.68, 0.24);
  mobilityGroup.add(joyBox);

  const joyStick = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.07, 8), makeMat('#94A3B8'));
  joyStick.position.set(-0.27, 0.73, 0.25);
  mobilityGroup.add(joyStick);

  const joyKnob = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 10), bodyMat);
  joyKnob.position.set(-0.27, 0.77, 0.25);
  mobilityGroup.add(joyKnob);

  // Footrest platform
  const footrest = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.03, 0.18), baseMat);
  footrest.position.set(0, 0.14, 0.36);
  mobilityGroup.add(footrest);

  // 4 chunky motorized wheels
  for (const side of [-1, 1]) {
    const driveWheel = buildSmallWheel(0.16, 0.09, color);
    driveWheel.position.set(side * 0.28, 0.16, -0.06);
    mobilityGroup.add(driveWheel);
    wheels.push(driveWheel);

    const frontWheel = buildSmallWheel(0.11, 0.065, color);
    frontWheel.position.set(side * 0.24, 0.11, 0.24);
    mobilityGroup.add(frontWheel);
    wheels.push(frontWheel);
  }
}

function buildRollatorWalker(
  color: string,
  mobilityGroup: THREE.Group,
  wheels: THREE.Object3D[],
): void {
  const frameMat = makeMat(color, { roughness: 0.3, metalness: 0.65 });
  const darkMat = makeMat('#1E293B', { roughness: 0.75 });
  const wireMat = makeMat('#CBD5E1', { roughness: 0.35, metalness: 0.7 });

  const zCenter = 0.42;

  // 4 legs + handlebars + brake levers + 4 wheels
  for (const side of [-1, 1]) {
    const x = side * 0.27;

    // Front angled leg
    const frontLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.74, 8), frameMat);
    frontLeg.position.set(x, 0.44, zCenter + 0.12);
    frontLeg.rotation.x = 0.12;
    mobilityGroup.add(frontLeg);

    // Rear vertical leg up to handlebar
    const rearLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.82, 8), frameMat);
    rearLeg.position.set(x, 0.48, zCenter - 0.12);
    mobilityGroup.add(rearLeg);

    // Side cross rail
    const sideRail = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.3, 8), frameMat);
    sideRail.rotation.x = Math.PI / 2;
    sideRail.position.set(x, 0.5, zCenter);
    mobilityGroup.add(sideRail);

    // Ergonomic grip handle
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.14, 8), darkMat);
    grip.rotation.x = Math.PI / 2;
    grip.position.set(x, 0.89, zCenter - 0.17);
    mobilityGroup.add(grip);

    // Brake lever
    const brake = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, 0.1), darkMat);
    brake.position.set(x, 0.84, zCenter - 0.17);
    mobilityGroup.add(brake);

    // Front & rear wheels
    const frontWheel = buildSmallWheel(0.08, 0.032, color);
    frontWheel.position.set(x, 0.08, zCenter + 0.17);
    mobilityGroup.add(frontWheel);
    wheels.push(frontWheel);

    const rearWheel = buildSmallWheel(0.08, 0.032, color);
    rearWheel.position.set(x, 0.08, zCenter - 0.12);
    mobilityGroup.add(rearWheel);
    wheels.push(rearWheel);
  }

  // Padded resting seat
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.04, 0.24), darkMat);
  seat.position.set(0, 0.52, zCenter);
  mobilityGroup.add(seat);

  // Curved backrest bar
  const backrest = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.52, 8), darkMat);
  backrest.rotation.z = Math.PI / 2;
  backrest.position.set(0, 0.72, zCenter + 0.15);
  mobilityGroup.add(backrest);

  // Front basket
  const basket = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.16), wireMat);
  basket.position.set(0, 0.36, zCenter + 0.08);
  mobilityGroup.add(basket);
}

function buildForearmCrutch(color: string, armLength: number): THREE.Group {
  const crutch = new THREE.Group();
  const shaftMat = makeMat(color, { roughness: 0.3, metalness: 0.65 });
  const gripMat = makeMat('#1E293B', { roughness: 0.85 });
  const tipMat = makeMat('#0F172A', { roughness: 0.9 });

  // Handgrip at hand position (y = -armLength)
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.12, 8), gripMat);
  grip.rotation.x = Math.PI / 2;
  grip.position.set(0, -armLength, 0.04);
  crutch.add(grip);

  // Lower shaft down to ground
  const lowerLen = 0.62;
  const lowerShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.012, lowerLen, 8), shaftMat);
  lowerShaft.position.set(0, -armLength - lowerLen * 0.5, 0.08);
  crutch.add(lowerShaft);

  // Rubber ferrule tip
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.045, 8), tipMat);
  tip.position.set(0, -armLength - lowerLen, 0.08);
  crutch.add(tip);

  // Upper angled forearm shaft + open U-cuff
  const upperShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.24, 8), shaftMat);
  upperShaft.position.set(0, -armLength + 0.11, 0.04);
  upperShaft.rotation.x = -0.3;
  crutch.add(upperShaft);

  const cuff = new THREE.Mesh(
    new THREE.TorusGeometry(0.068, 0.016, 8, 14, Math.PI * 1.35),
    gripMat,
  );
  cuff.position.set(0, -armLength + 0.21, 0.0);
  cuff.rotation.x = Math.PI / 2;
  cuff.rotation.z = Math.PI * 0.82;
  crutch.add(cuff);

  return crutch;
}

function buildUnderarmCrutch(color: string, armLength: number): THREE.Group {
  const crutch = new THREE.Group();
  const railMat = makeMat(color, { roughness: 0.45, metalness: 0.35 });
  const padMat = makeMat('#475569', { roughness: 0.85 });
  const tipMat = makeMat('#0F172A', { roughness: 0.9 });

  // Padded axillary underarm rest
  const topPad = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.14, 6, 10), padMat);
  topPad.rotation.x = Math.PI / 2;
  topPad.position.set(0, -0.02, 0.02);
  crutch.add(topPad);

  // Double upper rails
  for (const dz of [-0.045, 0.045]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, armLength + 0.05, 8), railMat);
    rail.position.set(0, -armLength * 0.5 - 0.02, 0.02 + dz);
    crutch.add(rail);
  }

  // Handgrip
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.11, 8), padMat);
  grip.rotation.x = Math.PI / 2;
  grip.position.set(0, -armLength, 0.02);
  crutch.add(grip);

  // Lower telescoping shaft
  const lowerLen = 0.62;
  const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.012, lowerLen, 8), railMat);
  lower.position.set(0, -armLength - lowerLen * 0.5, 0.02);
  crutch.add(lower);

  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.045, 8), tipMat);
  tip.position.set(0, -armLength - lowerLen, 0.02);
  crutch.add(tip);

  return crutch;
}

function buildGuideCane(color: string, armLength: number): THREE.Group {
  const cane = new THREE.Group();
  const whiteMat = makeMat('#F8FAFC', { roughness: 0.35 });
  const redMat = makeMat('#EF4444', { roughness: 0.35 });
  const gripMat = makeMat(color, { roughness: 0.6 });

  // Angled forward-downward cane from right hand
  const holder = new THREE.Group();
  holder.position.set(0, -armLength, 0.02);
  holder.rotation.x = -0.78;
  holder.rotation.z = 0.08;

  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.14, 8), gripMat);
  grip.position.y = -0.05;
  holder.add(grip);

  const whiteShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.01, 0.58, 8), whiteMat);
  whiteShaft.position.y = -0.4;
  holder.add(whiteShaft);

  const redBand = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.01, 0.2, 8), redMat);
  redBand.position.y = -0.78;
  holder.add(redBand);

  const rollerTip = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 10), whiteMat);
  rollerTip.position.y = -0.9;
  holder.add(rollerTip);

  cane.add(holder);
  return cane;
}

function buildProstheticLeg(color: string, p: BodyProportions): THREE.Group {
  const leg = new THREE.Group();
  const socketMat = makeMat(color, { roughness: 0.3, metalness: 0.65 });
  const carbonMat = makeMat('#18181B', { roughness: 0.35, metalness: 0.55 });
  const glowMat = makeMat(lightenColor(color, 0.3), {
    roughness: 0.2,
    emissive: color,
    emissiveIntensity: 0.4,
  });

  // Upper thigh sleeve/socket
  const socket = new THREE.Mesh(
    new THREE.CylinderGeometry(p.legRadius * 0.98, p.legRadius * 0.78, p.legLength * 0.46, 12),
    socketMat,
  );
  socket.position.y = -p.legLength * 0.23;
  leg.add(socket);

  // Mechanical knee ring
  const kneeRing = new THREE.Mesh(new THREE.TorusGeometry(p.legRadius * 0.65, 0.014, 8, 14), glowMat);
  kneeRing.rotation.x = Math.PI / 2;
  kneeRing.position.y = -p.legLength * 0.46;
  leg.add(kneeRing);

  // Sleek J-curve carbon-fiber running blade
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -p.legLength * 0.46, 0),
    new THREE.Vector3(0, -p.legLength * 0.72, -0.075),
    new THREE.Vector3(0, -p.legLength * 0.98, -0.025),
    new THREE.Vector3(0, -p.legLength * 1.06, 0.085),
  ]);
  const bladeGeo = new THREE.TubeGeometry(curve, 16, 0.022, 8, false);
  const blade = new THREE.Mesh(bladeGeo, carbonMat);
  blade.scale.set(1.4, 1, 0.75);
  leg.add(blade);

  // Grippy rubber blade sole
  const sole = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.022, 0.1), socketMat);
  sole.position.set(0, -p.legLength * 1.06, 0.06);
  leg.add(sole);

  return leg;
}

function buildProstheticArm(color: string, p: BodyProportions): THREE.Group {
  const arm = new THREE.Group();
  const chromeMat = makeMat('#E2E8F0', { roughness: 0.2, metalness: 0.85 });
  const accentMat = makeMat(color, { roughness: 0.3, metalness: 0.65 });
  const glowMat = makeMat(color, {
    roughness: 0.2,
    emissive: color,
    emissiveIntensity: 0.75,
  });

  // Bionic shoulder cap
  const shoulder = new THREE.Mesh(new THREE.SphereGeometry(p.armRadius * 1.15, 12, 10), accentMat);
  shoulder.position.y = -0.02;
  arm.add(shoulder);

  // Upper bionic arm
  const upper = new THREE.Mesh(
    new THREE.CylinderGeometry(p.armRadius * 0.88, p.armRadius * 0.78, p.armLength * 0.46, 12),
    chromeMat,
  );
  upper.position.y = -p.armLength * 0.26;
  arm.add(upper);

  // Glowing elbow joint ring
  const elbow = new THREE.Mesh(new THREE.TorusGeometry(p.armRadius * 0.85, 0.014, 8, 16), glowMat);
  elbow.rotation.x = Math.PI / 2;
  elbow.position.y = -p.armLength * 0.5;
  arm.add(elbow);

  // Forearm housing
  const forearm = new THREE.Mesh(
    new THREE.CylinderGeometry(p.armRadius * 0.86, p.armRadius * 0.7, p.armLength * 0.42, 12),
    accentMat,
  );
  forearm.position.y = -p.armLength * 0.72;
  arm.add(forearm);

  // Glowing wrist ring
  const wrist = new THREE.Mesh(new THREE.TorusGeometry(p.armRadius * 0.72, 0.011, 8, 14), glowMat);
  wrist.rotation.x = Math.PI / 2;
  wrist.position.y = -p.armLength * 0.92;
  arm.add(wrist);

  // Articulated bionic hand
  const hand = new THREE.Mesh(new THREE.SphereGeometry(p.armRadius * 0.92, 10, 10), chromeMat);
  hand.position.y = -p.armLength * 1.02;
  arm.add(hand);

  return arm;
}

export function buildAvatarRig(config: AvatarConfig): AvatarRig {
  const p = BODY_PROPORTIONS[config.bodyType] ?? BODY_PROPORTIONS.standard;

  const root = new THREE.Group();
  root.name = 'AvatarRoot';

  const bodyGroup = new THREE.Group();
  bodyGroup.name = 'BodyGroup';
  root.add(bodyGroup);

  const mobilityGroup = new THREE.Group();
  mobilityGroup.name = 'MobilityGroup';
  root.add(mobilityGroup);

  const wheels: THREE.Object3D[] = [];
  const crutches: THREE.Object3D[] = [];

  const skinMat = makeMat(config.skinTone, { roughness: 0.68, metalness: 0.02 });
  const shirtMat = makeMat(config.shirtColor, { roughness: 0.7 });
  const pantsMat = makeMat(config.pantsColor, { roughness: 0.75 });
  const shoeMat = makeMat(config.shoeColor, { roughness: 0.55 });
  const soleMat = makeMat('#F8FAFC', { roughness: 0.6 });

  const footHeight = 0.08;
  const hipY = p.legLength + footHeight;

  // --- TORSO ---
  const torso = new THREE.Group();
  torso.name = 'Torso';
  torso.position.y = hipY;
  buildShirtDetails(torso, config.shirtStyle, config.shirtColor, config.skinTone, p);

  // Subtle waist/pelvis block connecting torso to legs
  const pelvis = new THREE.Mesh(
    new THREE.BoxGeometry(p.torsoWidth * 0.94, 0.1, p.torsoDepth * 0.94),
    pantsMat,
  );
  pelvis.position.y = -0.02;
  torso.add(pelvis);

  // Neck
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.068, 0.075, 0.09, 12),
    skinMat,
  );
  neck.position.y = p.torsoHeight + 0.035;
  torso.add(neck);
  bodyGroup.add(torso);

  // --- HEAD ---
  const head = new THREE.Group();
  head.name = 'Head';
  head.position.y = hipY + p.torsoHeight + p.headRadius + 0.04;

  const headSphere = new THREE.Mesh(new THREE.SphereGeometry(p.headRadius, 22, 18), skinMat);
  headSphere.scale.set(1.0, 1.04, 0.98);
  head.add(headSphere);

  // Cute ears
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(p.headRadius * 0.22, 10, 10), skinMat);
    ear.position.set(side * p.headRadius * 0.96, -0.01, -0.01);
    ear.scale.set(0.6, 1.0, 0.7);
    head.add(ear);
  }

  // Crisp 2D CanvasTexture face curved smoothly onto front of head
  const faceTex = createFaceTexture(config.expression, config.skinTone);
  if (faceTex) {
    const faceGeo = new THREE.SphereGeometry(
      p.headRadius * 1.015,
      18,
      16,
      Math.PI * 0.18,
      Math.PI * 0.64,
      Math.PI * 0.22,
      Math.PI * 0.56,
    );
    const faceMat = new THREE.MeshBasicMaterial({
      map: faceTex,
      transparent: true,
      depthWrite: false,
    });
    const faceMesh = new THREE.Mesh(faceGeo, faceMat);
    // SphereGeometry phi=0 starts at +X; rotateY(-PI/2) centers phi=PI/2 onto +Z
    faceMesh.rotation.y = 0;
    // Actually in Three.js SphereGeometry: x = -r*cos(phi)*sin(theta), z = r*sin(phi)*sin(theta)
    // So phi = PI/2 is directly at +Z!
    faceMesh.scale.set(1.0, 1.04, 0.99);
    head.add(faceMesh);
  }

  // Hair
  const hairGroup = buildHair(config.hairStyle, config.hairColor, p.headRadius);
  head.add(hairGroup);

  bodyGroup.add(head);

  // --- ARMS (left = +X, right = -X when facing +Z) ---
  const buildStandardArm = (): THREE.Group => {
    const arm = new THREE.Group();
    const isShortSleeve = config.shirtStyle === 'tshirt' || config.shirtStyle === 'jersey';
    const isSleeveless = config.shirtStyle === 'tank';

    if (isSleeveless) {
      const fullArm = new THREE.Mesh(
        new THREE.CapsuleGeometry(p.armRadius, p.armLength - p.armRadius * 2, 6, 10),
        skinMat,
      );
      fullArm.position.y = -p.armLength * 0.5;
      arm.add(fullArm);
    } else if (isShortSleeve) {
      const sleeve = new THREE.Mesh(
        new THREE.CapsuleGeometry(p.armRadius * 1.12, p.armLength * 0.3, 6, 10),
        shirtMat,
      );
      sleeve.position.y = -p.armLength * 0.2;
      arm.add(sleeve);

      const lower = new THREE.Mesh(
        new THREE.CapsuleGeometry(p.armRadius * 0.92, p.armLength * 0.52, 6, 10),
        skinMat,
      );
      lower.position.y = -p.armLength * 0.64;
      arm.add(lower);
    } else {
      const longSleeve = new THREE.Mesh(
        new THREE.CapsuleGeometry(p.armRadius * 1.08, p.armLength * 0.72, 6, 10),
        shirtMat,
      );
      longSleeve.position.y = -p.armLength * 0.44;
      arm.add(longSleeve);
    }

    const hand = new THREE.Mesh(new THREE.SphereGeometry(p.armRadius * 0.95, 10, 10), skinMat);
    hand.position.y = -p.armLength;
    arm.add(hand);

    return arm;
  };

  const leftArm = buildStandardArm();
  leftArm.name = 'LeftArm';
  leftArm.position.set(p.shoulderOffset, hipY + p.torsoHeight - 0.05, 0);
  bodyGroup.add(leftArm);

  const rightArm =
    config.mobilityAid === 'prosthetic_arm'
      ? buildProstheticArm(config.mobilityAidColor, p)
      : buildStandardArm();
  rightArm.name = 'RightArm';
  rightArm.position.set(-p.shoulderOffset, hipY + p.torsoHeight - 0.05, 0);
  bodyGroup.add(rightArm);

  // --- LEGS (left = +X, right = -X when facing +Z) ---
  const buildStandardLeg = (): THREE.Group => {
    const leg = new THREE.Group();
    const legMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(p.legRadius, p.legLength - p.legRadius * 1.6, 6, 10),
      pantsMat,
    );
    legMesh.position.y = -p.legLength * 0.5;
    leg.add(legMesh);

    // Stylized sneaker / shoe
    const shoeUpper = new THREE.Mesh(
      new THREE.BoxGeometry(p.legRadius * 2.1, footHeight * 0.75, 0.21),
      shoeMat,
    );
    shoeUpper.position.set(0, -p.legLength - footHeight * 0.25, 0.045);
    leg.add(shoeUpper);

    const shoeSole = new THREE.Mesh(
      new THREE.BoxGeometry(p.legRadius * 2.18, footHeight * 0.35, 0.22),
      soleMat,
    );
    shoeSole.position.set(0, -p.legLength - footHeight * 0.78, 0.045);
    leg.add(shoeSole);

    return leg;
  };

  const leftLeg = buildStandardLeg();
  leftLeg.name = 'LeftLeg';
  leftLeg.position.set(p.hipOffset, hipY, 0);
  bodyGroup.add(leftLeg);

  const rightLeg =
    config.mobilityAid === 'prosthetic_leg'
      ? buildProstheticLeg(config.mobilityAidColor, p)
      : buildStandardLeg();
  rightLeg.name = 'RightLeg';
  rightLeg.position.set(-p.hipOffset, hipY, 0);
  bodyGroup.add(rightLeg);

  // --- ACCESSORIES ---
  buildAccessory(config.accessory, config.accessoryColor, head, torso, p);

  // --- MOBILITY AIDS ---
  switch (config.mobilityAid) {
    case 'manual_wheelchair': {
      buildManualWheelchair(config.mobilityAidColor, mobilityGroup, wheels);
      // Seat avatar cleanly in manual wheelchair
      bodyGroup.position.set(0, 0.48 - hipY, 0.0);
      leftLeg.rotation.x = -Math.PI * 0.44;
      rightLeg.rotation.x = -Math.PI * 0.44;
      leftArm.rotation.x = -0.35;
      rightArm.rotation.x = -0.35;
      leftArm.rotation.z = 0.14;
      rightArm.rotation.z = -0.14;
      break;
    }

    case 'racing_wheelchair': {
      buildRacingWheelchair(config.mobilityAidColor, mobilityGroup, wheels);
      // Low aerodynamic seated pose
      bodyGroup.position.set(0, 0.4 - hipY, 0.02);
      leftLeg.rotation.x = -Math.PI * 0.48;
      rightLeg.rotation.x = -Math.PI * 0.48;
      leftArm.rotation.x = -0.45;
      rightArm.rotation.x = -0.45;
      leftArm.rotation.z = 0.18;
      rightArm.rotation.z = -0.18;
      break;
    }

    case 'power_wheelchair': {
      buildPowerWheelchair(config.mobilityAidColor, mobilityGroup, wheels);
      // Relaxed upright Captain's chair pose, right hand near joystick
      bodyGroup.position.set(0, 0.51 - hipY, 0.0);
      leftLeg.rotation.x = -Math.PI * 0.46;
      rightLeg.rotation.x = -Math.PI * 0.46;
      leftArm.rotation.x = -0.42;
      rightArm.rotation.x = -0.62;
      leftArm.rotation.z = 0.1;
      rightArm.rotation.z = -0.06;
      break;
    }

    case 'forearm_crutches': {
      const leftCrutch = buildForearmCrutch(config.mobilityAidColor, p.armLength);
      leftCrutch.position.x = 0.03;
      leftArm.add(leftCrutch);
      crutches.push(leftCrutch);

      const rightCrutch = buildForearmCrutch(config.mobilityAidColor, p.armLength);
      rightCrutch.position.x = -0.03;
      rightArm.add(rightCrutch);
      crutches.push(rightCrutch);

      leftArm.rotation.z = 0.12;
      rightArm.rotation.z = -0.12;
      break;
    }

    case 'underarm_crutches': {
      const leftCrutch = buildUnderarmCrutch(config.mobilityAidColor, p.armLength);
      leftCrutch.position.x = 0.04;
      leftArm.add(leftCrutch);
      crutches.push(leftCrutch);

      const rightCrutch = buildUnderarmCrutch(config.mobilityAidColor, p.armLength);
      rightCrutch.position.x = -0.04;
      rightArm.add(rightCrutch);
      crutches.push(rightCrutch);

      leftArm.rotation.z = 0.1;
      rightArm.rotation.z = -0.1;
      break;
    }

    case 'guide_cane': {
      const cane = buildGuideCane(config.mobilityAidColor, p.armLength);
      rightArm.add(cane);
      crutches.push(cane);
      rightArm.rotation.x = -0.35;
      break;
    }

    case 'rollator_walker': {
      buildRollatorWalker(config.mobilityAidColor, mobilityGroup, wheels);
      // Hands reaching forward to rollator handlebars
      leftArm.rotation.x = -0.78;
      rightArm.rotation.x = -0.78;
      leftArm.rotation.z = 0.04;
      rightArm.rotation.z = -0.04;
      break;
    }

    case 'prosthetic_leg':
    case 'prosthetic_arm':
    case 'none':
    default:
      break;
  }

  // Apply tasteful overall body height scaling to non-wheelchair rigs
  if (!isWheelchairAid(config.mobilityAid)) {
    bodyGroup.scale.setScalar(p.heightScale);
  } else {
    bodyGroup.scale.set(
      p.heightScale > 1 ? 1.02 : p.heightScale < 1 ? 0.94 : 1.0,
      p.heightScale > 1 ? 1.04 : p.heightScale < 1 ? 0.94 : 1.0,
      p.heightScale > 1 ? 1.02 : p.heightScale < 1 ? 0.94 : 1.0,
    );
  }

  enableShadows(root);

  const dispose = () => {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();

    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        if (mesh.geometry) geometries.add(mesh.geometry);
        const matList = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of matList) {
          if (!mat) continue;
          materials.add(mat);
          const stdMat = mat as THREE.MeshStandardMaterial;
          if (stdMat.map) textures.add(stdMat.map);
        }
      }
    });

    textures.forEach((t) => t.dispose());
    materials.forEach((m) => m.dispose());
    geometries.forEach((g) => g.dispose());
  };

  return {
    root,
    bodyGroup,
    head,
    torso,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    mobilityGroup,
    wheels,
    crutches,
    config,
    dispose,
  };
}
