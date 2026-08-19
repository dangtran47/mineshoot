import { MELEE_SWORD, WEAPON_SWORD, meleeStats } from '@mineshoot/shared';
import type { MeleeKind, SwingAnim, Weapon } from '@mineshoot/shared';

/*
 * Pure, time-driven pose for a remote humanoid's weapon arm. Everything here is
 * plain numbers so it can be unit-tested without three.js; `Humanoid` applies
 * the result to meshes each frame.
 *
 * Arm pitch is rotation.x of the shoulder pivot: 0 = hanging down, +π/2 = level
 * forward, larger = raised over the shoulder. (The humanoid faces local -z, and a
 * positive x-rotation swings the hanging arm toward -z.)
 */

/** Gun: arm level, aiming forward. */
export const GUN_IDLE_PITCH = Math.PI / 2;
/** Sword: arm reaching forward, a bit below level (guard stance). */
export const SWORD_IDLE_PITCH = 1.0;
/**
 * Sword: wrist bend at rest (radians, about the humanoid's local x) lifting
 * the blade up off the arm line so it stands in front of the body instead of
 * pointing at the ground. Straightens out for wind-ups and swings so chops
 * follow the arm.
 */
export const SWORD_IDLE_TILT = 1.0;
/** Charging: wound back over the shoulder. */
export const CHARGE_PITCH = Math.PI / 2 + 1.1;
/** End of a light swing (down-forward). */
export const SWING_END_PITCH = 0.2;
/** End of a charged swing (follows through further). */
export const HEAVY_SWING_END_PITCH = -0.35;
/** Where a light swing starts (a shorter wind-up than a full charge). */
export const LIGHT_SWING_START_PITCH = Math.PI / 2 + 0.5;
export const SWING_MS = 200;
/** A horizontal slash rolls the shoulder from one side to the other (rotation.z, radians). */
export const SLASH_ROLL = 0.9;
/** A slash is swung a bit above level, arcing down slightly. */
export const SLASH_PITCH = Math.PI / 2 + 0.25;
export const SHOT_KICK_MS = 90;
export const MUZZLE_FLASH_MS = 70;
/** Reloading: gun lowered, hands busy. */
export const RELOAD_PITCH = 0.9;
const RELOAD_BOB = 0.12;
const RELOAD_BOB_HZ = 3;
const SHOT_KICK_PITCH = 0.3;

export interface ArmPose {
  /** rotation.x of the weapon-arm shoulder pivot. */
  armPitch: number;
  /** rotation.z of the shoulder pivot: sideways sweep of a slash (0 = straight). */
  armRoll: number;
  /** Wrist bend lifting the melee prop off the arm line (0 = prop straight along the arm). */
  bladeTilt: number;
  /** 0..1 emissive intensity of the blade (charge build-up / heavy swing). */
  swordGlow: number;
  /** 0..1 recoil kick applied to the gun prop. */
  gunKick: number;
  muzzleFlash: boolean;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

export class HumanoidAnim {
  private weapon: Weapon = 0;
  private chargeMs = meleeStats(MELEE_SWORD).chargeMs;
  private chargeSince = -1;
  private reloading = false;
  private swingAt = -1;
  private swingAnim: SwingAnim = 'overhead';
  private swingHeavy = false;
  /** Which way the next slash goes (+1 / -1); flips every slash. */
  private slashSide = 1;
  private shotAt = -1;

  setWeapon(w: Weapon): void {
    this.weapon = w;
  }

  /** The held melee weapon decides how fast the charge glow fills. */
  setMelee(kind: MeleeKind): void {
    this.chargeMs = meleeStats(kind).chargeMs;
  }

  setCharging(on: boolean, now: number): void {
    if (on && this.chargeSince < 0) this.chargeSince = now;
    if (!on) this.chargeSince = -1;
  }

  setReloading(on: boolean): void {
    this.reloading = on;
  }

  /** A melee attack was performed: `anim` decides the motion, `heavy` the wind-up start and glow. */
  swing(now: number, anim: SwingAnim, heavy: boolean): void {
    this.swingAt = now;
    this.swingAnim = anim;
    this.swingHeavy = heavy;
    if (anim === 'slash') this.slashSide = -this.slashSide;
    this.chargeSince = -1;
  }

  shot(now: number): void {
    this.shotAt = now;
  }

  pose(now: number): ArmPose {
    const idle = this.weapon === WEAPON_SWORD ? SWORD_IDLE_PITCH : GUN_IDLE_PITCH;
    const tilt = this.weapon === WEAPON_SWORD ? SWORD_IDLE_TILT : 0;
    const out: ArmPose = { armPitch: idle, armRoll: 0, bladeTilt: tilt, swordGlow: 0, gunKick: 0, muzzleFlash: false };

    // Swing wins over everything: it is the moment that matters to the victim.
    if (this.swingAt >= 0 && now - this.swingAt < SWING_MS) {
      const t = easeOut(clamp01((now - this.swingAt) / SWING_MS));
      out.swordGlow = this.swingHeavy ? 1 - t : 0;
      out.bladeTilt = 0;
      if (this.swingAnim === 'slash') {
        out.armPitch = lerp(SLASH_PITCH, SLASH_PITCH - 0.4, t);
        out.armRoll = this.slashSide * lerp(SLASH_ROLL, -SLASH_ROLL, t);
      } else {
        const from = this.swingHeavy ? CHARGE_PITCH : LIGHT_SWING_START_PITCH;
        const to = this.swingHeavy ? HEAVY_SWING_END_PITCH : SWING_END_PITCH;
        out.armPitch = lerp(from, to, t);
      }
      return out;
    }

    if (this.chargeSince >= 0 && this.weapon === WEAPON_SWORD) {
      const t = clamp01((now - this.chargeSince) / this.chargeMs);
      out.armPitch = lerp(SWORD_IDLE_PITCH, CHARGE_PITCH, easeOut(t));
      out.bladeTilt = lerp(SWORD_IDLE_TILT, 0, easeOut(t));
      out.swordGlow = t;
      return out;
    }

    if (this.weapon !== WEAPON_SWORD) {
      if (this.shotAt >= 0 && now - this.shotAt < SHOT_KICK_MS) {
        const t = clamp01((now - this.shotAt) / SHOT_KICK_MS);
        out.gunKick = 1 - t;
        out.muzzleFlash = now - this.shotAt <= MUZZLE_FLASH_MS;
        out.armPitch = GUN_IDLE_PITCH + SHOT_KICK_PITCH * (1 - t);
        return out;
      }
      if (this.reloading) {
        out.armPitch = RELOAD_PITCH + Math.sin((now / 1000) * RELOAD_BOB_HZ * Math.PI * 2) * RELOAD_BOB;
        return out;
      }
    }
    return out;
  }
}
