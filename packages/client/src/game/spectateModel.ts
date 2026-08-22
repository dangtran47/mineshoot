import { TEAM_NONE } from '@mineshoot/shared';

/**
 * Pure spectate logic: who a dead player may watch, and how the target moves on.
 * Kept free of DOM and three.js so it can be unit tested (the client vitest
 * environment is 'node'); the current target itself lives in `screens/game.ts`.
 *
 * Spectating is client-only — every pose is already broadcast to everyone, so
 * watching costs no message and gives away nothing the nametags don't.
 */

/** How long the death overlay owns the screen before the camera moves on. */
export const SPECTATE_DELAY_MS = 1500;

/** One player as the spectate rules see them. */
export interface SpectateCandidate {
  id: string;
  alive: boolean;
  team: number;
}

/**
 * Everyone the dead player may watch: alive, not themselves, and in a team mode
 * only their own side (nobody, if they have no team yet). Sorted by id so
 * next/previous keeps the same order while players die and respawn.
 */
export function eligibleTargets(players: SpectateCandidate[], meId: string, teamMode: boolean, myTeam: number): string[] {
  if (teamMode && myTeam === TEAM_NONE) return [];
  return players
    .filter((p) => p.id !== meId && p.alive && (!teamMode || p.team === myTeam))
    .map((p) => p.id)
    .sort();
}

/** Step to the next (`dir` 1) or previous (`dir` -1) target, wrapping around. */
export function cycleTarget(eligible: string[], current: string | null, dir: 1 | -1): string | null {
  if (eligible.length === 0) return null;
  const at = current === null ? -1 : eligible.indexOf(current);
  if (at < 0) return dir === 1 ? eligible[0] : eligible[eligible.length - 1];
  return eligible[(at + dir + eligible.length) % eligible.length];
}

/**
 * Keep watching the same player while they stay eligible; when they die or leave,
 * move to the first one left. Null means nobody is watchable — back to the death cam.
 */
export function retainTarget(eligible: string[], current: string | null): string | null {
  if (current !== null && eligible.includes(current)) return current;
  return eligible.length > 0 ? eligible[0] : null;
}

/** True once the death overlay has had its moment (`diedAt` 0 = never spawned). */
export function spectateReady(diedAt: number, now: number): boolean {
  return diedAt > 0 && now - diedAt >= SPECTATE_DELAY_MS;
}
