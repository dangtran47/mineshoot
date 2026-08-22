import { GUN_MACHINEGUN, GUN_NONE, GUN_PISTOL, GUN_RIFLE, GUN_SHOTGUN, GUN_SMG, GUN_SNIPER, GUN_TASER } from './guns';
import type { GunKind, GunSpec } from './guns';

/**
 * One shot's camera kick, in degrees. Positive pitch is up; positive yaw
 * turns left (mouse-right decreases yaw), so a "right drift" is negative.
 */
export interface RecoilKick {
  pitchDeg: number;
  yawDeg: number;
}

const NO_KICK: RecoilKick = { pitchDeg: 0, yawDeg: 0 };

/**
 * Fixed per-gun spray patterns, indexed by shot number within a burst and
 * clamped to the last entry. Deterministic on purpose: the pattern is the
 * thing players learn to pull against (CS-style spray control). The kick is
 * applied client-side to the camera, so it moves the real bullet path; the
 * un-compensated part recovers after the burst (see the client controller).
 */
export const RECOIL_PATTERNS: Record<GunKind, readonly RecoilKick[]> = {
  [GUN_NONE]: [NO_KICK],
  [GUN_PISTOL]: [{ pitchDeg: 1.0, yawDeg: 0 }],
  // The masterable S-curve: straight up, drift right, cross back left.
  [GUN_RIFLE]: [
    { pitchDeg: 1.3, yawDeg: 0 },
    { pitchDeg: 1.3, yawDeg: 0 },
    { pitchDeg: 1.3, yawDeg: 0 },
    { pitchDeg: 1.3, yawDeg: 0 },
    { pitchDeg: 1.1, yawDeg: -0.2 },
    { pitchDeg: 1.1, yawDeg: -0.35 },
    { pitchDeg: 1.1, yawDeg: -0.45 },
    { pitchDeg: 1.1, yawDeg: -0.5 },
    { pitchDeg: 1.0, yawDeg: 0.3 },
    { pitchDeg: 1.0, yawDeg: 0.45 },
    { pitchDeg: 1.0, yawDeg: 0.55 },
    { pitchDeg: 1.0, yawDeg: 0.6 },
  ],
  // Softer, faster: a gentle right-then-left zigzag.
  [GUN_SMG]: [
    { pitchDeg: 0.7, yawDeg: 0 },
    { pitchDeg: 0.7, yawDeg: 0 },
    { pitchDeg: 0.7, yawDeg: -0.15 },
    { pitchDeg: 0.7, yawDeg: -0.25 },
    { pitchDeg: 0.7, yawDeg: -0.3 },
    { pitchDeg: 0.7, yawDeg: -0.15 },
    { pitchDeg: 0.7, yawDeg: 0.15 },
    { pitchDeg: 0.7, yawDeg: 0.25 },
    { pitchDeg: 0.7, yawDeg: 0.3 },
    { pitchDeg: 0.7, yawDeg: 0.3 },
  ],
  [GUN_SHOTGUN]: [{ pitchDeg: 3.0, yawDeg: 0 }],
  [GUN_SNIPER]: [{ pitchDeg: 4.0, yawDeg: 0 }],
  [GUN_TASER]: [NO_KICK],
  // Belt-fed climb: harsh first shots, then a long left-right wander that never settles.
  [GUN_MACHINEGUN]: [
    { pitchDeg: 1.2, yawDeg: 0 },
    { pitchDeg: 1.2, yawDeg: 0 },
    { pitchDeg: 1.2, yawDeg: 0 },
    { pitchDeg: 1.0, yawDeg: -0.3 },
    { pitchDeg: 1.0, yawDeg: -0.45 },
    { pitchDeg: 0.9, yawDeg: -0.55 },
    { pitchDeg: 0.9, yawDeg: -0.3 },
    { pitchDeg: 0.9, yawDeg: 0.3 },
    { pitchDeg: 0.9, yawDeg: 0.55 },
    { pitchDeg: 0.8, yawDeg: 0.65 },
    { pitchDeg: 0.8, yawDeg: 0.3 },
    { pitchDeg: 0.8, yawDeg: -0.35 },
    { pitchDeg: 0.8, yawDeg: -0.65 },
    { pitchDeg: 0.8, yawDeg: 0.65 },
  ],
};

/** The kick for shot `shotIndex` (0-based) of a burst; unknown kinds don't kick. */
export function recoilKick(kind: GunKind, shotIndex: number): RecoilKick {
  const pattern = RECOIL_PATTERNS[kind];
  if (!pattern) return NO_KICK;
  return pattern[Math.min(Math.max(0, shotIndex), pattern.length - 1)];
}

/**
 * A pause this long without firing ends the burst: the pattern index resets
 * and the un-compensated offset starts recovering. Two cooldowns keeps a
 * held-trigger auto gun in one burst; the 300 ms floor keeps fast guns from
 * resetting between deliberate taps. Single-shot guns have single-entry
 * patterns — no burst to protect — so their aim settles right after the floor
 * instead of waiting out two long cooldowns.
 */
export function recoilResetMs(spec: GunSpec): number {
  if (!spec.auto) return 300;
  return Math.max(300, spec.cooldownMs * 2);
}

/**
 * How long one kick takes to reach full deflection: heavy single-shot kicks
 * ramp the camera up as a short continuous motion instead of snapping in one
 * frame; fast guns stay instant so the spray pattern reads crisply. Always
 * shorter than the 300 ms reset floor, so recovery never starts mid-kick.
 */
export function recoilKickMs(kind: GunKind): number {
  if (kind === GUN_SNIPER) return 120;
  if (kind === GUN_SHOTGUN) return 70;
  return 0;
}

/** How fast the un-compensated recoil offset settles back to the original aim. */
export const RECOIL_RECOVER_DEG_PER_S = 25;
