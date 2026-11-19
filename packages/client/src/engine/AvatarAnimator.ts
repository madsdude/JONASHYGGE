import type { EmoteType } from '@handihotel/shared';
import { isWheelchairAid, type AvatarRig } from './AvatarBuilder';

export interface AvatarAnimationState {
  isMoving: boolean;
  speed: number;
  isSitting: boolean;
  emote: EmoteType | null;
  turnDelta: number;
}

interface RestPose {
  bodyY: number;
  bodyZ: number;
  leftArmX: number;
  leftArmY: number;
  leftArmZ: number;
  rightArmX: number;
  rightArmY: number;
  rightArmZ: number;
  leftLegX: number;
  leftLegZ: number;
  rightLegX: number;
  rightLegZ: number;
}

function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export class AvatarAnimator {
  private readonly rig: AvatarRig;
  private readonly rest: RestPose;
  private readonly isWheelchair: boolean;

  private time = 0;
  private movePhase = 0;
  private emoteTime = 0;
  private lastEmote: EmoteType | null = null;
  private smoothedTurn = 0;

  constructor(rig: AvatarRig) {
    this.rig = rig;
    this.isWheelchair = isWheelchairAid(rig.config.mobilityAid);
    this.rest = {
      bodyY: rig.bodyGroup.position.y,
      bodyZ: rig.bodyGroup.position.z,
      leftArmX: rig.leftArm.rotation.x,
      leftArmY: rig.leftArm.rotation.y,
      leftArmZ: rig.leftArm.rotation.z,
      rightArmX: rig.rightArm.rotation.x,
      rightArmY: rig.rightArm.rotation.y,
      rightArmZ: rig.rightArm.rotation.z,
      leftLegX: rig.leftLeg.rotation.x,
      leftLegZ: rig.leftLeg.rotation.z,
      rightLegX: rig.rightLeg.rotation.x,
      rightLegZ: rig.rightLeg.rotation.z,
    };
  }

  public reset(): void {
    this.movePhase = 0;
    this.emoteTime = 0;
    this.lastEmote = null;
    this.smoothedTurn = 0;

    const { rig, rest } = this;
    rig.bodyGroup.position.set(0, rest.bodyY, rest.bodyZ);
    rig.bodyGroup.rotation.set(0, 0, 0);
    rig.mobilityGroup.position.set(0, 0, 0);
    rig.mobilityGroup.rotation.set(0, 0, 0);
    rig.torso.rotation.set(0, 0, 0);
    rig.head.rotation.set(0, 0, 0);
    rig.leftArm.rotation.set(rest.leftArmX, rest.leftArmY, rest.leftArmZ);
    rig.rightArm.rotation.set(rest.rightArmX, rest.rightArmY, rest.rightArmZ);
    rig.leftLeg.rotation.set(rest.leftLegX, 0, rest.leftLegZ);
    rig.rightLeg.rotation.set(rest.rightLegX, 0, rest.rightLegZ);
  }

  public update(rawDt: number, partialState: Partial<AvatarAnimationState> = {}): void {
    const dt = Math.min(Math.max(rawDt, 0), 0.1);
    const state: AvatarAnimationState = {
      isMoving: partialState.isMoving ?? false,
      speed: partialState.speed ?? (partialState.isMoving ? 2.4 : 0),
      isSitting: partialState.isSitting ?? false,
      emote: partialState.emote ?? null,
      turnDelta: partialState.turnDelta ?? 0,
    };

    this.time += dt;

    if (state.emote !== this.lastEmote) {
      this.emoteTime = 0;
      this.lastEmote = state.emote;
    } else if (state.emote) {
      this.emoteTime += dt;
    }

    // Smooth turn lean for wheelchairs & lively motion
    const clampedTurn = Math.max(-1.5, Math.min(1.5, state.turnDelta));
    this.smoothedTurn = damp(this.smoothedTurn, clampedTurn, 10, dt);

    const { rig, rest } = this;
    const aid = rig.config.mobilityAid;

    // Target pose defaults to rest pose
    let bodyY = rest.bodyY;
    let bodyZ = rest.bodyZ;
    let bodyRotX = 0;
    let bodyRotY = 0;
    let bodyRotZ = 0;

    let mobY = 0;
    let mobZ = 0;
    let mobRotX = 0;
    let mobRotZ = 0;

    let torsoRotX = 0;
    let torsoRotY = 0;
    let torsoRotZ = 0;

    let headRotX = 0;
    let headRotY = 0;
    let headRotZ = 0;

    let lArmX = rest.leftArmX;
    let lArmY = rest.leftArmY;
    let lArmZ = rest.leftArmZ;

    let rArmX = rest.rightArmX;
    let rArmY = rest.rightArmY;
    let rArmZ = rest.rightArmZ;

    let lLegX = rest.leftLegX;
    let lLegZ = rest.leftLegZ;
    let rLegX = rest.rightLegX;
    let rLegZ = rest.rightLegZ;

    const sittingActive = state.isSitting || state.emote === 'sit';

    // 1. WHEEL SPINNING (Wheelchairs & Rollator)
    if (rig.wheels.length > 0 && state.isMoving && Math.abs(state.speed) > 0.01) {
      const wheelRadius =
        aid === 'racing_wheelchair'
          ? 0.3
          : aid === 'manual_wheelchair'
            ? 0.28
            : aid === 'power_wheelchair'
              ? 0.16
              : 0.09;
      const spinDelta = (state.speed * dt) / wheelRadius;
      for (const wheel of rig.wheels) {
        wheel.rotation.x += spinDelta;
      }
    }

    // 2. LOCOMOTION / SITTING / IDLE
    if (sittingActive && !this.isWheelchair) {
      // Smoothly fold legs for sitting on furniture
      bodyY = rest.bodyY - 0.26;
      bodyZ = rest.bodyZ + 0.04;
      lLegX = -Math.PI * 0.48;
      rLegX = -Math.PI * 0.48;
      lArmX = -0.35;
      rArmX = -0.35;
      lArmZ = 0.08;
      rArmZ = -0.08;
      // Subtle idle breathing while seated
      headRotX = Math.sin(this.time * 1.8) * 0.03;
      headRotY = Math.sin(this.time * 0.9) * 0.06;
    } else if (state.isMoving) {
      const speedFactor = Math.max(0.7, Math.min(2.2, Math.abs(state.speed) / 2.2));
      this.movePhase += dt * 7.8 * speedFactor;

      if (this.isWheelchair) {
        // Subtle turn banking for wheelchairs
        const bank = -this.smoothedTurn * 0.12;
        bodyRotZ = bank;
        mobRotZ = bank * 0.6;
        bodyY = rest.bodyY + Math.sin(this.movePhase * 2) * 0.008;

        if (aid === 'power_wheelchair') {
          // Relaxed ride with right hand steering joystick
          rArmX = rest.rightArmX - 0.12;
          rArmZ = rest.rightArmZ - this.smoothedTurn * 0.18;
          torsoRotX = 0.05;
          headRotY = this.smoothedTurn * 0.22;
        } else {
          // Manual & racing wheelchair rim-push stroke
          const pushCycle = Math.sin(this.movePhase * 0.85);
          const forwardReach = Math.max(0, pushCycle);
          const pushAmp = aid === 'racing_wheelchair' ? 0.62 : 0.48;
          lArmX = rest.leftArmX + pushCycle * pushAmp;
          rArmX = rest.rightArmX + pushCycle * pushAmp;
          torsoRotX = 0.08 + forwardReach * 0.12;
          headRotX = -forwardReach * 0.06;
        }
      } else if (aid === 'forearm_crutches' || aid === 'underarm_crutches') {
        // Authentic crutch swing gait: crutches plant forward while legs step through
        const swing = Math.sin(this.movePhase * 0.85);
        const lift = Math.max(0, Math.cos(this.movePhase * 0.85));
        lArmX = -0.22 + swing * 0.42;
        rArmX = -0.22 - swing * 0.42;
        lLegX = -swing * 0.45;
        rLegX = swing * 0.45;
        bodyY = rest.bodyY + lift * 0.045;
        torsoRotX = 0.08;
        headRotX = -0.04 + lift * 0.04;
      } else if (aid === 'rollator_walker') {
        // Hands steady on handlebars, smooth walking stride behind rollator
        const stride = Math.sin(this.movePhase);
        lLegX = stride * 0.48;
        rLegX = -stride * 0.48;
        lArmX = rest.leftArmX + Math.sin(this.movePhase * 2) * 0.03;
        rArmX = rest.rightArmX + Math.sin(this.movePhase * 2) * 0.03;
        bodyY = rest.bodyY + Math.abs(Math.sin(this.movePhase)) * 0.03;
        torsoRotX = 0.08;
      } else {
        // Standard walking gait (also prosthetic_leg, prosthetic_arm, guide_cane)
        const stride = Math.sin(this.movePhase);
        const bounce = Math.abs(Math.cos(this.movePhase));

        lLegX = stride * 0.62;
        rLegX = -stride * 0.62;
        lArmX = -stride * 0.52;

        if (aid === 'guide_cane') {
          // Right hand sweeps guide cane left & right rhythmically
          rArmX = -0.35;
          rArmY = Math.sin(this.movePhase * 0.9) * 0.35;
          rArmZ = -0.1 + Math.sin(this.movePhase * 0.9) * 0.16;
        } else {
          rArmX = stride * 0.52;
        }

        bodyY = rest.bodyY + bounce * 0.05;
        torsoRotY = stride * 0.1;
        torsoRotX = 0.06;
        headRotY = -stride * 0.05;
        headRotX = bounce * 0.04;
      }
    } else {
      // Gentle living idle breathing & subtle head motion
      const breathe = Math.sin(this.time * 2.1);
      bodyY = rest.bodyY + breathe * 0.012;
      headRotX = breathe * 0.025;
      headRotY = Math.sin(this.time * 0.85) * 0.07;

      if (!this.isWheelchair && aid !== 'rollator_walker') {
        lArmZ = rest.leftArmZ + 0.03 + breathe * 0.02;
        rArmZ = rest.rightArmZ - 0.03 - breathe * 0.02;
      }
    }

    // 3. EXPRESSIVE EMOTES (layered cleanly over base pose)
    if (state.emote && state.emote !== 'sit') {
      const t = this.emoteTime;

      switch (state.emote) {
        case 'wave': {
          // Energetic right arm wave! (rightArm is at -X, so -Z lifts arm up/out)
          rArmX = -0.25;
          rArmZ = -2.45 + Math.sin(t * 11) * 0.42;
          headRotZ = 0.14 + Math.sin(t * 5.5) * 0.06;
          torsoRotZ = 0.06;
          break;
        }

        case 'dance': {
          // Funky rhythmic groove + alternating arm pumps + joyful head bob + periodic spin
          const beat = t * 7.2;
          const groove = Math.sin(beat);
          const doubleBeat = Math.abs(Math.sin(beat));

          bodyY = rest.bodyY + doubleBeat * 0.09;
          torsoRotY = groove * 0.3;
          torsoRotZ = Math.cos(beat) * 0.12;
          headRotZ = -Math.cos(beat) * 0.18;
          headRotX = doubleBeat * 0.12;

          lArmX = -0.75 + Math.sin(beat) * 0.75;
          rArmX = -0.75 - Math.sin(beat) * 0.75;
          lArmZ = 0.65 + Math.cos(beat) * 0.35;
          rArmZ = -0.65 - Math.cos(beat) * 0.35;

          if (!this.isWheelchair && !sittingActive) {
            lLegX = Math.sin(beat) * 0.35;
            rLegX = -Math.sin(beat) * 0.35;
            bodyRotY = Math.sin(t * 1.8) * 0.45;
          } else if (this.isWheelchair) {
            // Fun chair groove wiggle
            bodyRotY = Math.sin(beat * 0.5) * 0.22;
            mobRotZ = Math.sin(beat) * 0.06;
          }
          break;
        }

        case 'laugh': {
          // Joyful belly-laugh bounce & head tilt back
          const giggle = Math.sin(t * 15);
          bodyY = rest.bodyY + Math.abs(giggle) * 0.06;
          headRotX = -0.22 + giggle * 0.09;
          torsoRotX = -0.08 + giggle * 0.05;
          lArmX = -0.65 + giggle * 0.12;
          rArmX = -0.65 - giggle * 0.12;
          lArmZ = 0.35;
          rArmZ = -0.35;
          break;
        }

        case 'cheer': {
          // Both arms raised high in celebratory V pumping!
          const pump = Math.sin(t * 10);
          lArmX = -0.2;
          rArmX = -0.2;
          lArmZ = 2.6 + pump * 0.22;
          rArmZ = -2.6 - pump * 0.22;
          bodyY = rest.bodyY + Math.max(0, pump) * (this.isWheelchair ? 0.04 : 0.14);
          headRotX = -0.14;
          break;
        }

        case 'clap': {
          // Rhythmic hands clapping together in front of chest
          const clapCycle = Math.abs(Math.sin(t * 9.5));
          lArmX = -1.25;
          rArmX = -1.25;
          lArmY = -0.45 + clapCycle * 0.32;
          rArmY = 0.45 - clapCycle * 0.32;
          lArmZ = -0.22 + clapCycle * 0.18;
          rArmZ = 0.22 - clapCycle * 0.18;
          headRotX = Math.sin(t * 9.5) * 0.05;
          break;
        }

        case 'facepalm': {
          // Right hand up to forehead + slow head shake
          rArmX = -2.15;
          rArmY = 0.35;
          rArmZ = 0.25;
          headRotX = 0.22;
          headRotY = Math.sin(t * 4.5) * 0.22;
          torsoRotX = 0.1;
          break;
        }

        case 'wheelie': {
          if (this.isWheelchair) {
            // Epic wheelchair wheelie! Pitch back onto rear wheels with balance wobble
            const pitch = -0.46 + Math.sin(t * 5.2) * 0.05;
            mobRotX = pitch;
            bodyRotX = pitch;
            // Lift slightly so rear wheels stay planted on floor
            mobY = 0.06;
            bodyY = rest.bodyY + 0.06;
            mobZ = -0.04;
            bodyZ = rest.bodyZ - 0.04;
            // Arms raised triumphantly!
            lArmZ = 2.1 + Math.sin(t * 8) * 0.2;
            rArmZ = -2.1 - Math.sin(t * 8) * 0.2;
            lArmX = -0.3;
            rArmX = -0.3;
            headRotX = 0.22;
          } else {
            // Celebratory hop & 360 spin for standing / crutch / rollator avatars!
            const hop = Math.abs(Math.sin(t * 6));
            bodyY = rest.bodyY + hop * 0.24;
            bodyRotY = (t * Math.PI * 2.2) % (Math.PI * 2);
            lArmZ = 2.3;
            rArmZ = -2.3;
            lLegX = -hop * 0.35;
            rLegX = -hop * 0.35;
          }
          break;
        }
      }
    }

    // 4. SMOOTHLY APPLY TARGETS
    const rate = 14;
    rig.bodyGroup.position.y = damp(rig.bodyGroup.position.y, bodyY, rate, dt);
    rig.bodyGroup.position.z = damp(rig.bodyGroup.position.z, bodyZ, rate, dt);
    rig.bodyGroup.rotation.x = damp(rig.bodyGroup.rotation.x, bodyRotX, rate, dt);
    rig.bodyGroup.rotation.z = damp(rig.bodyGroup.rotation.z, bodyRotZ, rate, dt);

    // Handle full spin cleanly for wheelie emote on standing avatars
    if (state.emote === 'wheelie' && !this.isWheelchair) {
      rig.bodyGroup.rotation.y = bodyRotY;
    } else {
      rig.bodyGroup.rotation.y = damp(rig.bodyGroup.rotation.y, bodyRotY, rate, dt);
    }

    rig.mobilityGroup.position.y = damp(rig.mobilityGroup.position.y, mobY, rate, dt);
    rig.mobilityGroup.position.z = damp(rig.mobilityGroup.position.z, mobZ, rate, dt);
    rig.mobilityGroup.rotation.x = damp(rig.mobilityGroup.rotation.x, mobRotX, rate, dt);
    rig.mobilityGroup.rotation.z = damp(rig.mobilityGroup.rotation.z, mobRotZ, rate, dt);

    rig.torso.rotation.x = damp(rig.torso.rotation.x, torsoRotX, rate, dt);
    rig.torso.rotation.y = damp(rig.torso.rotation.y, torsoRotY, rate, dt);
    rig.torso.rotation.z = damp(rig.torso.rotation.z, torsoRotZ, rate, dt);

    rig.head.rotation.x = damp(rig.head.rotation.x, headRotX, rate, dt);
    rig.head.rotation.y = damp(rig.head.rotation.y, headRotY, rate, dt);
    rig.head.rotation.z = damp(rig.head.rotation.z, headRotZ, rate, dt);

    rig.leftArm.rotation.x = damp(rig.leftArm.rotation.x, lArmX, rate, dt);
    rig.leftArm.rotation.y = damp(rig.leftArm.rotation.y, lArmY, rate, dt);
    rig.leftArm.rotation.z = damp(rig.leftArm.rotation.z, lArmZ, rate, dt);

    rig.rightArm.rotation.x = damp(rig.rightArm.rotation.x, rArmX, rate, dt);
    rig.rightArm.rotation.y = damp(rig.rightArm.rotation.y, rArmY, rate, dt);
    rig.rightArm.rotation.z = damp(rig.rightArm.rotation.z, rArmZ, rate, dt);

    rig.leftLeg.rotation.x = damp(rig.leftLeg.rotation.x, lLegX, rate, dt);
    rig.leftLeg.rotation.z = damp(rig.leftLeg.rotation.z, lLegZ, rate, dt);
    rig.rightLeg.rotation.x = damp(rig.rightLeg.rotation.x, rLegX, rate, dt);
    rig.rightLeg.rotation.z = damp(rig.rightLeg.rotation.z, rLegZ, rate, dt);
  }
}
