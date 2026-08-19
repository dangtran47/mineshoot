import { TEAM_BLUE, TEAM_RED } from './protocol';
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

/** CTF: rows per team, each side ranked by the CTF order; teamless rows are dropped. */
export function splitTeams(rows: RankRow[]): { red: RankRow[]; blue: RankRow[] } {
  return {
    red: rankCtf(rows.filter((r) => r.team === TEAM_RED)),
    blue: rankCtf(rows.filter((r) => r.team === TEAM_BLUE)),
  };
}

export function kdRatio(kills: number, deaths: number): number {
  return deaths === 0 ? kills : kills / deaths;
}
