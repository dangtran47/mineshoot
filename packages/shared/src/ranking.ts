import type { RankRow } from './types';

/** Kills desc, then deaths asc, then name asc. Pure; returns a new array. */
export function rankPlayers(rows: RankRow[]): RankRow[] {
  return [...rows].sort((a, b) => {
    if (b.kills !== a.kills) return b.kills - a.kills;
    if (a.deaths !== b.deaths) return a.deaths - b.deaths;
    return a.name.localeCompare(b.name);
  });
}

/** CTF: captures desc, then kills desc, deaths asc, name asc. Pure; returns a new array. */
export function rankCtf(rows: RankRow[]): RankRow[] {
  return [...rows].sort((a, b) => {
    const ca = a.captures ?? 0;
    const cb = b.captures ?? 0;
    if (cb !== ca) return cb - ca;
    if (b.kills !== a.kills) return b.kills - a.kills;
    if (a.deaths !== b.deaths) return a.deaths - b.deaths;
    return a.name.localeCompare(b.name);
  });
}

export function kdRatio(kills: number, deaths: number): number {
  return deaths === 0 ? kills : kills / deaths;
}
