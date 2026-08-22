import type { DropKind } from './drops';
import { GUN_MACHINEGUN, GUN_RIFLE, GUN_SHOTGUN, GUN_SMG, GUN_SNIPER } from './guns';
import { DROP_KINDS } from './melee';
import { TEAM_BLUE, TEAM_NONE, TEAM_RED, WEAPON_MELEE, WEAPON_PRIMARY } from './protocol';
import type { Team, WeaponMode } from './protocol';
import type { SpawnPoint, Vec3 } from './types';

/*
 * Team elimination ("td") rules, shared by server and client. Two teams on a
 * crossroads map, played in rounds: everyone spawns at their own end with the
 * default loadout, better weapons lie at fixed spots on the ground (the same
 * spots and kinds every round), and the dead stay dead until the round ends.
 * Wiping the enemy team wins the round; the first team to the room's
 * `roundLimit` round wins takes the match. Rounds have no clock.
 */

/** One team's head counts for the round rule: fighters left alive, fighters spawned into this round, members ready at all. */
export interface RoundSide {
  alive: number;
  inRound: number;
  ready: number;
}

/**
 * Who won the round: the team whose fighters survive when the other side's
 * are wiped, TEAM_NONE for a draw (no point, the round still advances), null
 * while the round continues. Rules beyond the plain wipe: a team with nobody
 * ready at all freezes the round (a half-empty room waits instead of looping
 * instant rounds), and a team whose ready players are all *waiting outside*
 * the round (joined mid-round past the grace) draws it rather than handing
 * the enemy a point for a round never fought — the restart spawns them in.
 */
export function roundWinner(red: RoundSide, blue: RoundSide): Team | typeof TEAM_NONE | null {
  if (red.ready === 0 || blue.ready === 0) return null;
  const redOut = red.inRound === 0 || red.alive === 0;
  const blueOut = blue.inRound === 0 || blue.alive === 0;
  if (redOut && blueOut) return TEAM_NONE;
  if (blueOut) return blue.inRound === 0 ? TEAM_NONE : TEAM_RED;
  if (redOut) return red.inRound === 0 ? TEAM_NONE : TEAM_BLUE;
  return null;
}

/**
 * A team's spawn pool on the crossroads map: every spawn point on its own
 * half (north/south of `sz / 2`, the side its base is on). A whole squad
 * respawns at once, so the pool is the entire half rather than the N points
 * nearest the base as in ctf — `teamSpawns(…, n)` with n above the per-side
 * count would spill over into the enemy end.
 */
export function tdTeamSpawns(spawns: readonly SpawnPoint[], base: { x: number; z: number }, sz: number): SpawnPoint[] {
  const north = base.z < sz / 2;
  return spawns.filter((s) => s.z < sz / 2 === north);
}

/**
 * The weapons laid on the ground, in weapon-spot order (worldgen's 10 north
 * spots west→east, then their 10 south mirrors): the fixed north row runs
 * sniper, shotgun, SMG, rifle, M249 twice over — one full set per spawn
 * strip, two of every gun — and the south row is its exact reverse, so each
 * team reads the same order left-to-right from its own side. Sword-only
 * rooms cycle the four blades across the row instead. No taser and no
 * grenade packs.
 */
export function tdWeaponLoadout(weapons: WeaponMode): DropKind[] {
  const set = [GUN_SNIPER, GUN_SHOTGUN, GUN_SMG, GUN_RIFLE, GUN_MACHINEGUN];
  const guns = [...set, ...set];
  const row: readonly number[] =
    weapons === 'sword' ? guns.map((_, i) => DROP_KINDS[i % DROP_KINDS.length]) : guns;
  const slot = weapons === 'sword' ? WEAPON_MELEE : WEAPON_PRIMARY;
  return [...row, ...[...row].reverse()].map((kind) => ({ slot, kind }));
}

/**
 * Where a td bot wants to be: the nearest weapon on the ground while unarmed
 * (`armed` = holding a primary, or a sword-only room where the spawn blade is
 * fine), else the nearest known enemy, else the crossroads at the map centre.
 */
export function botTdGoal(
  self: { x: number; z: number },
  view: { enemies: readonly Vec3[]; drops: readonly Vec3[]; armed: boolean; center: Vec3 },
): Vec3 | null {
  const nearest = (points: readonly Vec3[]): Vec3 | null => {
    let best: Vec3 | null = null;
    let bestDist = Infinity;
    for (const p of points) {
      const d = Math.hypot(p.x - self.x, p.z - self.z);
      if (d < bestDist) {
        best = p;
        bestDist = d;
      }
    }
    return best;
  };
  if (!view.armed) {
    const drop = nearest(view.drops);
    if (drop) return drop;
  }
  return nearest(view.enemies) ?? view.center;
}
