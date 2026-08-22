import type { SpawnPoint } from './types';

/**
 * Pick a spawn far from enemies: rank spawns by distance to the nearest
 * enemy (desc) and choose randomly among the top few so respawns aren't
 * fully predictable.
 */
/**
 * Spawns with nobody within `minDist` of them, so simultaneous (re)spawns —
 * a whole td squad at round start — never stack on the same point. Falls
 * back to the full list rather than returning nothing when everything is
 * taken.
 */
export function unoccupiedSpawns(
  spawns: SpawnPoint[],
  occupied: { x: number; z: number }[],
  minDist = 3,
): SpawnPoint[] {
  const free = spawns.filter((s) => occupied.every((o) => Math.hypot(s.x - o.x, s.z - o.z) >= minDist));
  return free.length > 0 ? free : spawns;
}

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
