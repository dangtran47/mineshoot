import { CTF_BASE_ZONE_RADIUS, CTF_TEAM_SPAWN_COUNT } from './constants';
import { TEAM_BLUE, TEAM_NONE, TEAM_RED } from './protocol';
import type { Team } from './protocol';
import type { SpawnPoint, Vec3 } from './types';

/**
 * Capture the flag rules, shared by server and client. Two teams, one flag
 * each at its base. Touch the enemy flag to carry it; bring it into your own
 * base zone while your own flag is home to score. A carrier who dies drops
 * the flag where they stood: teammates pick it up and carry on, the owning
 * team touches it to send it home, and nobody touching it for FLAG_RETURN_MS
 * sends it home too. Carriers are slower, melee-only and visible to everyone.
 */

export type FlagStatus = 'home' | 'carried' | 'dropped';

/** One flag. While carried, x/y/z follow the carrier (the server keeps them updated). */
export interface FlagState {
  team: Team;
  status: FlagStatus;
  x: number;
  y: number;
  z: number;
  /** Player id while carried, '' otherwise. */
  carrierId: string;
}

export type FlagTouch = 'take' | 'pickup' | 'return';

/** The `n` spawn points nearest a base: that team respawns only there. */
export function teamSpawns(spawns: SpawnPoint[], base: { x: number; z: number }, n = CTF_TEAM_SPAWN_COUNT): SpawnPoint[] {
  return [...spawns].sort((a, b) => Math.hypot(a.x - base.x, a.z - base.z) - Math.hypot(b.x - base.x, b.z - base.z)).slice(0, n);
}

/**
 * What happens when `toucher` (alive, within pickup range) touches `flag`:
 * an enemy takes it from its stand or picks it up from the ground, the
 * owning team returns a dropped one, nothing else does anything.
 */
export function flagTouch(flag: FlagState, toucher: { team: Team }): FlagTouch | null {
  if (flag.status === 'carried') return null;
  if (flag.team !== toucher.team) return flag.status === 'home' ? 'take' : 'pickup';
  return flag.status === 'dropped' ? 'return' : null;
}

/** The flag `playerId` carries, if any. */
export function carriedFlag(flags: readonly FlagState[], playerId: string): FlagState | null {
  return flags.find((f) => f.status === 'carried' && f.carrierId === playerId) ?? null;
}

/**
 * True when `player` carries the enemy flag, their own flag is home, and they
 * stand within CTF_BASE_ZONE_RADIUS (horizontally) of their own flag stand.
 */
export function canScore(
  player: { id: string; team: Team; x: number; z: number },
  flags: readonly FlagState[],
  bases: Record<Team, { x: number; z: number }>,
): boolean {
  const carried = carriedFlag(flags, player.id);
  if (!carried || carried.team === player.team) return false;
  const own = flags.find((f) => f.team === player.team);
  if (!own || own.status !== 'home') return false;
  const base = bases[player.team];
  return Math.hypot(player.x - base.x, player.z - base.z) <= CTF_BASE_ZONE_RADIUS;
}

/** The smaller team; a tie is decided by `rng`. */
export function pickTeam(counts: Record<Team, number>, rng: () => number): Team {
  if (counts[TEAM_RED] !== counts[TEAM_BLUE]) return counts[TEAM_RED] < counts[TEAM_BLUE] ? TEAM_RED : TEAM_BLUE;
  return rng() < 0.5 ? TEAM_RED : TEAM_BLUE;
}

/**
 * Bots keep the teams even: when they differ by two or more and the bigger
 * team has a bot, name one bot to move over. Humans are never moved.
 */
export function botRebalance(counts: Record<Team, number>, botsByTeam: Record<Team, string[]>): { id: string; to: Team } | null {
  const diff = counts[TEAM_RED] - counts[TEAM_BLUE];
  if (Math.abs(diff) < 2) return null;
  const from: Team = diff > 0 ? TEAM_RED : TEAM_BLUE;
  const to: Team = diff > 0 ? TEAM_BLUE : TEAM_RED;
  const bot = botsByTeam[from][0];
  return bot ? { id: bot, to } : null;
}

/** Winner by score; TEAM_NONE on a tie. */
export function matchWinner(redScore: number, blueScore: number): Team | typeof TEAM_NONE {
  if (redScore === blueScore) return TEAM_NONE;
  return redScore > blueScore ? TEAM_RED : TEAM_BLUE;
}

/** A bot chases the enemy carrying its own flag only when they are this close; otherwise it keeps attacking. */
export const BOT_CHASE_RADIUS = 20;

/**
 * Where a CTF bot wants to be. Bots play offence: go get the enemy flag and
 * run it home. On the way they still do the sensible thing — return the own
 * flag if it lies closer than the enemy flag, chase the enemy carrying the
 * own flag when they are near, and escort a teammate who has the enemy flag
 * (flag positions follow carriers).
 */
export function botCtfGoal(
  team: Team,
  botId: string,
  self: { x: number; z: number },
  flags: readonly FlagState[],
  bases: Record<Team, Vec3>,
): Vec3 | null {
  if (carriedFlag(flags, botId)) return bases[team];
  const own = flags.find((f) => f.team === team);
  const enemy = flags.find((f) => f.team !== team);
  if (!enemy) return null;
  const at = (f: FlagState): Vec3 => ({ x: f.x, y: f.y, z: f.z });
  const dist = (f: FlagState): number => Math.hypot(f.x - self.x, f.z - self.z);
  if (own && own.status === 'dropped' && dist(own) < dist(enemy)) return at(own);
  if (own && own.status === 'carried' && dist(own) <= BOT_CHASE_RADIUS) return at(own);
  return at(enemy);
}
