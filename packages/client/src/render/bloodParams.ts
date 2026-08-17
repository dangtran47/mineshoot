import { MAX_HP } from '@mineshoot/shared';

export const BLOOD_MIN_PARTICLES = 6;
export const BLOOD_MAX_PARTICLES = 28;
/** Lifetime of one blood chunk. */
export const BLOOD_TTL_MS = 650;

/** How many blood chunks a hit sprays: a graze spits a few, a lethal hit a shower. 0 for a miss. */
export function bloodParticleCount(damage: number): number {
  if (damage <= 0) return 0;
  const t = Math.min(1, damage / MAX_HP);
  return Math.round(BLOOD_MIN_PARTICLES + (BLOOD_MAX_PARTICLES - BLOOD_MIN_PARTICLES) * t);
}
