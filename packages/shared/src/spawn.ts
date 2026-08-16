import type { SpawnPoint } from './types';

/**
 * Pick a spawn far from enemies: rank spawns by distance to the nearest
 * enemy (desc) and choose randomly among the top few so respawns aren't
 * fully predictable.
 */
export function pickSpawn(
  spawns: SpawnPoint[],
  enemies: { x: number; z: number }[],
  rand: () => number,
  topN = 3,
): SpawnPoint {
  if (spawns.length === 0) throw new Error('no spawn points');
  if (enemies.length === 0) return spawns[Math.floor(rand() * spawns.length)];
  const scored = spawns.map((s) => {
    let best = Infinity;
    for (const e of enemies) {
      const d = Math.hypot(s.x - e.x, s.z - e.z);
      if (d < best) best = d;
    }
    return { s, d: best };
  });
  scored.sort((a, b) => b.d - a.d);
  const n = Math.min(topN, scored.length);
  return scored[Math.floor(rand() * n)].s;
}
