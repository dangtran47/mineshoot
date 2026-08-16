import type { RankRow } from './types';

/** Kills desc, then deaths asc, then name asc. Pure; returns a new array. */
export function rankPlayers(rows: RankRow[]): RankRow[] {
  return [...rows].sort((a, b) => {
    if (b.kills !== a.kills) return b.kills - a.kills;
    if (a.deaths !== b.deaths) return a.deaths - b.deaths;
    return a.name.localeCompare(b.name);
  });
}

export function kdRatio(kills: number, deaths: number): number {
  return deaths === 0 ? kills : kills / deaths;
}
