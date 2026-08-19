import { SWORD_CHARGE_MS, SWORD_COOLDOWN_MS, SWORD_DAMAGE, SWORD_HALF_ANGLE_DEG, SWORD_HEAVY_HALF_ANGLE_DEG, SWORD_RANGE, SWORD_CHARGE_SPEED_SCALE } from './constants';

/*
 * Melee weapon kinds. Slot 2 ("sword") always holds one of these: the plain
 * sword everyone spawns with, or a stronger blade picked up from a drop.
 * Every drop weapon beats the sword somewhere and pays for it elsewhere.
 */

export const MELEE_SWORD = 0;
export const MELEE_AXE = 1;
export const MELEE_KATANA = 2;
export const MELEE_SCYTHE = 3;
export const MELEE_PICKAXE = 4;
export type MeleeKind = typeof MELEE_SWORD | typeof MELEE_AXE | typeof MELEE_KATANA | typeof MELEE_SCYTHE | typeof MELEE_PICKAXE;
export const MELEE_KINDS: readonly MeleeKind[] = [MELEE_SWORD, MELEE_AXE, MELEE_KATANA, MELEE_SCYTHE, MELEE_PICKAXE];
/** Kinds that can drop (everything but the sword). */
export const DROP_KINDS: readonly MeleeKind[] = [MELEE_AXE, MELEE_KATANA, MELEE_SCYTHE, MELEE_PICKAXE];

/** Attack slots every melee weapon has: LMB (tap or hold: light swings) and RMB held then released (the charged heavy). */
export const ATTACK_LIGHT = 0;
export const ATTACK_HEAVY = 1;
export type AttackKind = typeof ATTACK_LIGHT | typeof ATTACK_HEAVY;
export const ATTACK_KINDS: readonly AttackKind[] = [ATTACK_LIGHT, ATTACK_HEAVY];

/** How the swing is animated (both first person and on remote humanoids). `slash` alternates left/right. */
export type SwingAnim = 'slash' | 'overhead';

export interface AttackSpec {
  name: string;
  /** Cone half-angle in the horizontal plane (degrees). */
  halfAngleDeg: number;
  /** Reach from the eye, in blocks. */
  range: number;
  damage: { head: number; body: number };
  /** Hit everyone in the cone instead of only the nearest target. */
  sweep: boolean;
  /** Recovery: no attack of any kind until this long after this one. */
  cooldownMs: number;
  anim: SwingAnim;
  /** Server-side minimum interval after this attack (slack for network jitter). */
  serverMinIntervalMs: number;
}

export interface MeleeStats {
  name: string;
  attacks: Record<AttackKind, AttackSpec>;
  /** Hold RMB at least this long before releasing for the heavy attack. */
  chargeMs: number;
  /** Walk-speed multiplier while charging. */
  chargeSpeedScale: number;
}

const attack = (s: Omit<AttackSpec, 'serverMinIntervalMs'>): AttackSpec => ({ ...s, serverMinIntervalMs: s.cooldownMs - 50 });
type AttackInput = Omit<AttackSpec, 'serverMinIntervalMs'>;
const stats = (s: { name: string; light: AttackInput; heavy: AttackInput; chargeMs: number; chargeSpeedScale: number }): MeleeStats => ({
  name: s.name,
  attacks: { [ATTACK_LIGHT]: attack(s.light), [ATTACK_HEAVY]: attack(s.heavy) },
  chargeMs: s.chargeMs,
  chargeSpeedScale: s.chargeSpeedScale,
});

/*
 * Move-set per weapon: the light swing (LMB, repeats while held, alternating
 * left/right) and the charged heavy (hold RMB, release) that gives each
 * weapon its signature blow.
 */
export const MELEE_STATS: Record<MeleeKind, MeleeStats> = {
  [MELEE_SWORD]: stats({
    name: 'Sword',
    light: { name: 'Slash', halfAngleDeg: SWORD_HALF_ANGLE_DEG, range: SWORD_RANGE, damage: SWORD_DAMAGE.normal, sweep: false, cooldownMs: SWORD_COOLDOWN_MS, anim: 'slash' },
    heavy: { name: 'Overhead', halfAngleDeg: SWORD_HEAVY_HALF_ANGLE_DEG, range: SWORD_RANGE, damage: SWORD_DAMAGE.charged, sweep: true, cooldownMs: SWORD_COOLDOWN_MS, anim: 'overhead' },
    chargeMs: SWORD_CHARGE_MS,
    chargeSpeedScale: SWORD_CHARGE_SPEED_SCALE,
  }),
  // Slow and brutal: every swing cleaves, a charged hit kills anywhere; you crawl while charging.
  [MELEE_AXE]: stats({
    name: 'Battle Axe',
    light: { name: 'Cleave', halfAngleDeg: 30, range: 3.2, damage: { head: 55, body: 40 }, sweep: true, cooldownMs: 800, anim: 'slash' },
    heavy: { name: 'Execute', halfAngleDeg: 24, range: 3.2, damage: { head: 100, body: 100 }, sweep: true, cooldownMs: 800, anim: 'overhead' },
    chargeMs: 1100,
    chargeSpeedScale: 0.55,
  }),
  // Fast and long, but the cone is narrow: you must aim.
  [MELEE_KATANA]: stats({
    name: 'Katana',
    light: { name: 'Slash', halfAngleDeg: 20, range: 3.8, damage: { head: 50, body: 35 }, sweep: false, cooldownMs: 300, anim: 'slash' },
    heavy: { name: 'Iaido', halfAngleDeg: 14, range: 3.8, damage: { head: 100, body: 80 }, sweep: true, cooldownMs: 300, anim: 'slash' },
    chargeMs: 550,
    chargeSpeedScale: 0.85,
  }),
  // Huge arc that sweeps everyone in front of you; each hit is modest.
  [MELEE_SCYTHE]: stats({
    name: 'Scythe',
    light: { name: 'Sweep', halfAngleDeg: 50, range: 3.5, damage: { head: 40, body: 30 }, sweep: true, cooldownMs: 650, anim: 'slash' },
    heavy: { name: 'Reap', halfAngleDeg: 45, range: 3.5, damage: { head: 90, body: 65 }, sweep: true, cooldownMs: 650, anim: 'slash' },
    chargeMs: 900,
    chargeSpeedScale: 0.65,
  }),
  // Head-hunter: light head hits nearly one-shot, body hits are weak; a bit narrow.
  [MELEE_PICKAXE]: stats({
    name: 'Pickaxe',
    light: { name: 'Pick', halfAngleDeg: 24, range: SWORD_RANGE, damage: { head: 80, body: 30 }, sweep: false, cooldownMs: 550, anim: 'slash' },
    heavy: { name: 'Head-hunt', halfAngleDeg: 18, range: SWORD_RANGE, damage: { head: 100, body: 60 }, sweep: true, cooldownMs: 550, anim: 'overhead' },
    chargeMs: 700,
    chargeSpeedScale: 0.75,
  }),
};

export function isAttackKind(v: unknown): v is AttackKind {
  return typeof v === 'number' && (ATTACK_KINDS as readonly number[]).includes(v);
}

export function isMeleeKind(v: unknown): v is MeleeKind {
  return typeof v === 'number' && (MELEE_KINDS as readonly number[]).includes(v);
}

export function meleeStats(kind: MeleeKind): MeleeStats {
  return MELEE_STATS[kind] ?? MELEE_STATS[MELEE_SWORD];
}

/** The spec of one attack of one weapon (unknown attack → the weapon's light attack). */
export function attackSpec(kind: MeleeKind, attack: AttackKind): AttackSpec {
  const a = meleeStats(kind).attacks;
  return a[attack] ?? a[ATTACK_LIGHT];
}

/** Holding a charge this long releases the swing by itself (same grace window for every kind). */
export const MELEE_CHARGE_HOLD_MS = 1200;
export function meleeChargeMaxMs(kind: MeleeKind): number {
  return meleeStats(kind).chargeMs + MELEE_CHARGE_HOLD_MS;
}

/**
 * Letting go of RMB after holding at least this fraction of the weapon's
 * chargeMs still swings the heavy, at damage scaled by `chargeFraction`; a
 * shorter hold is a plain cancel (no swing), so a mis-tap costs nothing.
 */
export const MELEE_MIN_CHARGE_FRACTION = 0.25;

/** How charged a heavy is after holding for `heldMs`: 0..1, 1 = fully charged. */
export function chargeFraction(kind: MeleeKind, heldMs: number): number {
  return Math.min(1, Math.max(0, heldMs / meleeStats(kind).chargeMs));
}

// Weapon drops
/** A new drop appears this long after the previous one (uniform in the range). */
export const DROP_INTERVAL_MIN_MS = 25_000;
export const DROP_INTERVAL_MAX_MS = 45_000;
/** Drops on the ground at once. */
export const DROP_MAX_ACTIVE = 3;
/** Capture the flag: drops come roughly twice as often (the map is bigger and melee matters more for carriers). */
export const CTF_DROP_INTERVAL_MIN_MS = 12_000;
export const CTF_DROP_INTERVAL_MAX_MS = 22_000;
export const CTF_DROP_MAX_ACTIVE = 5;
/** An unclaimed drop vanishes after this long. */
export const DROP_LIFETIME_MS = 60_000;
/** Walk within this horizontal distance (and within a block vertically) to pick a drop up. */
export const DROP_PICKUP_RADIUS = 1.2;
export const DROP_PICKUP_DY = 1.5;
/** New drops keep at least this far from existing ones. */
export const DROP_MIN_SPACING = 4;

/** True if a player with feet at `feet` can pick up a drop lying at `drop`. */
export function canPickUp(feet: { x: number; y: number; z: number }, drop: { x: number; y: number; z: number }): boolean {
  return Math.hypot(feet.x - drop.x, feet.z - drop.z) <= DROP_PICKUP_RADIUS && Math.abs(feet.y - drop.y) <= DROP_PICKUP_DY;
}
