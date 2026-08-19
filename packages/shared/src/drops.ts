import { DROP_KINDS, DROP_MIN_SPACING } from './melee';
import type { MeleeKind } from './melee';
import type { SpawnPoint, World } from './types';
import { columnTop } from './world';
import { isStandable } from './worldgen';
import type { Rect } from './worldgen';

/** A melee weapon lying on the ground (feet position of a player standing on it). */
export interface Drop {
  id: string;
  kind: MeleeKind;
  x: number;
  y: number;
  z: number;
}

/** A random drop kind (never the plain sword). */
export function pickDropKind(rng: () => number): MeleeKind {
  return DROP_KINDS[Math.floor(rng() * DROP_KINDS.length)];
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
