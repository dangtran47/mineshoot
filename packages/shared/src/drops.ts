import { GRENADE_DROP_AMOUNT, GRENADE_MAX } from './grenade';
import { GUN_NONE, GUN_TASER, PRIMARY_KINDS, gunSpec } from './guns';
import type { GunKind } from './guns';
import { DROP_KINDS, DROP_MIN_SPACING, MELEE_SWORD, meleeStats } from './melee';
import type { MeleeKind } from './melee';
import { WEAPON_GRENADE, WEAPON_MELEE, WEAPON_PRIMARY, WEAPON_TASER, weaponAllowed } from './protocol';
import type { WeaponMode } from './protocol';
import type { SpawnPoint, World } from './types';
import { columnTop } from './world';
import { isStandable } from './worldgen';
import type { Rect } from './worldgen';

/** Slots a drop can fill. */
export type DropSlot = typeof WEAPON_PRIMARY | typeof WEAPON_MELEE | typeof WEAPON_GRENADE | typeof WEAPON_TASER;
/** What a drop gives: a GunKind (primary), a MeleeKind (melee) or a grenade count (grenade). */
export interface DropKind {
  slot: DropSlot;
  kind: number;
}
/** A weapon lying on the ground (feet position of a player standing on it). */
export interface Drop extends DropKind {
  id: string;
  x: number;
  y: number;
  z: number;
}

/** What a player already holds per slot, for the auto-pickup rule. */
export interface DropHolder {
  gun: number;
  taser: number;
  melee: number;
  grenades: number;
}

/**
 * Walking over a drop only fills an empty slot: an occupied one never
 * auto-swaps — throw the held weapon away (MSG.dropWeapon, G) first. The
 * plain spawn sword counts as an empty melee slot; grenade packs top up
 * until the cap.
 */
export function autoPickUpAllowed(holder: DropHolder, drop: DropKind): boolean {
  if (drop.slot === WEAPON_GRENADE) return holder.grenades < GRENADE_MAX;
  if (drop.slot === WEAPON_PRIMARY) return holder.gun === GUN_NONE;
  if (drop.slot === WEAPON_TASER) return holder.taser === GUN_NONE;
  return holder.melee === MELEE_SWORD;
}

/** Everything that can drop in a room with this weapon rule (uniform pick). */
export function dropPool(mode: WeaponMode): DropKind[] {
  const pool: DropKind[] = [];
  if (weaponAllowed(mode, WEAPON_PRIMARY)) {
    for (const k of PRIMARY_KINDS) pool.push({ slot: WEAPON_PRIMARY, kind: k });
    pool.push({ slot: WEAPON_TASER, kind: GUN_TASER });
    pool.push({ slot: WEAPON_GRENADE, kind: GRENADE_DROP_AMOUNT });
  }
  if (weaponAllowed(mode, WEAPON_MELEE)) for (const k of DROP_KINDS) pool.push({ slot: WEAPON_MELEE, kind: k });
  return pool;
}

/** A random drop for the mode (never the plain sword, never the pistol). */
export function pickDropKind(rng: () => number, mode: WeaponMode = 'all'): DropKind {
  const pool = dropPool(mode);
  return pool[Math.floor(rng() * pool.length)];
}

export function dropName(d: DropKind): string {
  if (d.slot === WEAPON_GRENADE) return `Grenades ×${d.kind}`;
  if (d.slot === WEAPON_PRIMARY || d.slot === WEAPON_TASER) return gunSpec(d.kind as GunKind).name;
  return meleeStats(d.kind as MeleeKind).name;
}

/**
 * A random standable spot (block centre) inside `zone` (the map's drop zone:
 * the arena's central plateau, the CTF ridge) at least DROP_MIN_SPACING from
 * `avoid`; falls back to a spawn point when the random probes keep failing.
 */
export function pickDropSpot(
  world: World,
  rng: () => number,
  avoid: { x: number; z: number }[],
  fallback: SpawnPoint[],
  zone: Rect,
  tries = 24,
): SpawnPoint | null {
  const farEnough = (x: number, z: number): boolean => avoid.every((a) => Math.hypot(a.x - x, a.z - z) >= DROP_MIN_SPACING);
  for (let i = 0; i < tries; i++) {
    const x = zone.minX + Math.floor(rng() * (zone.maxX - zone.minX + 1));
    const z = zone.minZ + Math.floor(rng() * (zone.maxZ - zone.minZ + 1));
    const top = columnTop(world, x, z);
    const y = top + 1;
    if (top < 0 || y + 1 >= world.sy || !isStandable(world, x, y, z)) continue;
    if (!farEnough(x + 0.5, z + 0.5)) continue;
    return { x: x + 0.5, y, z: z + 0.5 };
  }
  const ok = fallback.filter((s) => farEnough(s.x, s.z));
  const pool = ok.length > 0 ? ok : fallback;
  return pool.length > 0 ? pool[Math.floor(rng() * pool.length)] : null;
}
