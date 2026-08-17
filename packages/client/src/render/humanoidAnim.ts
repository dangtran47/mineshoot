import { SWORD_CHARGE_MS, WEAPON_SWORD } from '@mineshoot/shared';
import type { Weapon } from '@mineshoot/shared';

/*
 * Pure, time-driven pose for a remote humanoid's weapon arm. Everything here is
 * plain numbers so it can be unit-tested without three.js; `Humanoid` applies
 * the result to meshes each frame.
 *
 * Arm pitch is rotation.x of the shoulder pivot: 0 = hanging down, -π/2 = level
 * forward, more negative = raised over the shoulder.
 */

/** Gun: arm level, aiming forward. */
export const GUN_IDLE_PITCH = -Math.PI / 2;
/** Sword: held low and forward so the long blade reads at a distance. */
export const SWORD_IDLE_PITCH = -0.7;
/** Charging: wound back over the shoulder. */
export const CHARGE_PITCH = -Math.PI / 2 - 1.1;
/** End of a light swing (down-forward). */
export const SWING_END_PITCH = -0.2;
/** End of a charged swing (follows through further). */
export const HEAVY_SWING_END_PITCH = 0.35;
/** Where a light swing starts (a shorter wind-up than a full charge). */
export const LIGHT_SWING_START_PITCH = -Math.PI / 2 - 0.5;
export const SWING_MS = 200;
export const SHOT_KICK_MS = 90;
export const MUZZLE_FLASH_MS = 70;
/** Reloading: gun lowered, hands busy. */
export const RELOAD_PITCH = -0.9;
const RELOAD_BOB = 0.12;
const RELOAD_BOB_HZ = 3;
const SHOT_KICK_PITCH = 0.3;

export interface ArmPose {
  /** rotation.x of the weapon-arm shoulder pivot. */
  armPitch: number;
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
  private chargeSince = -1;
  private reloading = false;
  private swingAt = -1;
  private swingCharged = false;
  private shotAt = -1;

  setWeapon(w: Weapon): void {
    this.weapon = w;
  }

  setCharging(on: boolean, now: number): void {
    if (on && this.chargeSince < 0) this.chargeSince = now;
    if (!on) this.chargeSince = -1;
  }

  setReloading(on: boolean): void {
    this.reloading = on;
  }

  swing(now: number, charged: boolean): void {
    this.swingAt = now;
    this.swingCharged = charged;
    this.chargeSince = -1;
  }

  shot(now: number): void {
    this.shotAt = now;
  }

  pose(now: number): ArmPose {
    const idle = this.weapon === WEAPON_SWORD ? SWORD_IDLE_PITCH : GUN_IDLE_PITCH;
    const out: ArmPose = { armPitch: idle, swordGlow: 0, gunKick: 0, muzzleFlash: false };

    // Swing wins over everything: it is the moment that matters to the victim.
    if (this.swingAt >= 0 && now - this.swingAt < SWING_MS) {
      const t = easeOut(clamp01((now - this.swingAt) / SWING_MS));
      const from = this.swingCharged ? CHARGE_PITCH : LIGHT_SWING_START_PITCH;
      const to = this.swingCharged ? HEAVY_SWING_END_PITCH : SWING_END_PITCH;
      out.armPitch = lerp(from, to, t);
      out.swordGlow = this.swingCharged ? 1 - t : 0;
      return out;
    }

    if (this.chargeSince >= 0 && this.weapon === WEAPON_SWORD) {
      const t = clamp01((now - this.chargeSince) / SWORD_CHARGE_MS);
      out.armPitch = lerp(SWORD_IDLE_PITCH, CHARGE_PITCH, easeOut(t));
      out.swordGlow = t;
      return out;
    }

    if (this.weapon !== WEAPON_SWORD) {
      if (this.shotAt >= 0 && now - this.shotAt < SHOT_KICK_MS) {
        const t = clamp01((now - this.shotAt) / SHOT_KICK_MS);
        out.gunKick = 1 - t;
        out.muzzleFlash = now - this.shotAt <= MUZZLE_FLASH_MS;
        out.armPitch = GUN_IDLE_PITCH - SHOT_KICK_PITCH * (1 - t);
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
