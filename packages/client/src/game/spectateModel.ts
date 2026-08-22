import { GUN_NONE, TEAM_NONE, WEAPONS, WEAPON_GRENADE, WEAPON_MELEE, WEAPON_PISTOL, WEAPON_PRIMARY, WEAPON_TASER, gunSpec, isGunSlot } from '@mineshoot/shared';
import type { GunKind, MeleeKind, Weapon } from '@mineshoot/shared';

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

/** The watched player as the HUD reads them; a `NetPlayer` fits structurally. */
export interface SpectateePlayer {
  hp: number;
  alive: boolean;
  shielded: boolean;
  weapon: number;
  melee: number;
  pistol: number;
  gun: number;
  taser: number;
  grenades: number;
  /** Rounds in the held gun slot: server-synced, because nobody can predict somebody else's magazine. */
  ammo: number;
  reloading: boolean;
}

/** What the health / weapon / ammo / slot panels show while spectating. */
export interface SpectateLoadout {
  weapon: Weapon;
  melee: MeleeKind;
  gun: GunKind;
  grenades: number;
  hp: number;
  shielded: boolean;
  ammo: number;
  mag: number;
  reloading: boolean;
  perShell: boolean;
  usable: Record<number, boolean>;
}

/** The gun in `slot` for the watched player (GUN_NONE for melee / grenades / an empty slot). */
function gunIn(p: SpectateePlayer, slot: Weapon): GunKind {
  if (slot === WEAPON_PRIMARY) return p.gun as GunKind;
  if (slot === WEAPON_PISTOL) return p.pistol as GunKind;
  if (slot === WEAPON_TASER) return p.taser as GunKind;
  return GUN_NONE;
}

/**
 * Everything the HUD panels need about the player we are watching, taken from
 * the room state rather than from our own (dead) weapon state — a spectator
 * used to read their own corpse's health, weapon and magazine. `allowed` is
 * the room's weapon rule, so a slot greys out exactly as it does for its owner.
 * The flag-carrier melee lock is not mirrored (it is not in the schema).
 */
export function spectateLoadout(p: SpectateePlayer, allowed: readonly Weapon[]): SpectateLoadout {
  const weapon = p.weapon as Weapon;
  const spec = isGunSlot(weapon) ? gunSpec(gunIn(p, weapon)) : null;
  const usable: Record<number, boolean> = {};
  for (const w of WEAPONS) {
    const loaded = w === WEAPON_MELEE ? true : w === WEAPON_GRENADE ? p.grenades > 0 : gunIn(p, w) !== GUN_NONE;
    usable[w] = allowed.includes(w) && loaded;
  }
  return {
    weapon,
    melee: p.melee as MeleeKind,
    gun: p.gun as GunKind,
    grenades: p.grenades,
    hp: p.hp,
    shielded: p.alive && p.shielded,
    ammo: spec ? p.ammo : 0,
    mag: spec ? spec.magSize : 0,
    reloading: p.reloading,
    perShell: spec ? spec.perShell : false,
    usable,
  };
}
