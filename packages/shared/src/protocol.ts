import { CTF_RESPAWN_MS, RESPAWN_MS, TRAINING_RESPAWN_MS } from './constants';
import type { Vec3 } from './types';
import type { HitPart } from './hitbox';
import type { SwordPart } from './sword';
import type { KillAwards } from './kills';
import type { AttackKind, MeleeKind } from './melee';
import type { GunKind } from './guns';

/** Weapon slots (the number a pose/message carries). Keys 1..5 map to WEAPONS order. */
export const WEAPON_PISTOL = 0;
export const WEAPON_MELEE = 1;
export const WEAPON_PRIMARY = 2;
export const WEAPON_GRENADE = 3;
/** The taser lives in its own slot (key 5): a picked-up two-charge one-shot-kill sidearm. */
export const WEAPON_TASER = 4;
export type Weapon = typeof WEAPON_PISTOL | typeof WEAPON_MELEE | typeof WEAPON_PRIMARY | typeof WEAPON_GRENADE | typeof WEAPON_TASER;
/** Slots in key order: 1 primary (big gun), 2 pistol, 3 melee, 4 grenade, 5 taser. */
export const WEAPONS: readonly Weapon[] = [WEAPON_PRIMARY, WEAPON_PISTOL, WEAPON_MELEE, WEAPON_GRENADE, WEAPON_TASER];
/** Slots that fire bullets. */
export const GUN_SLOTS: readonly Weapon[] = [WEAPON_PISTOL, WEAPON_PRIMARY, WEAPON_TASER];
export function isWeapon(v: unknown): v is Weapon {
  return v === WEAPON_PISTOL || v === WEAPON_MELEE || v === WEAPON_PRIMARY || v === WEAPON_GRENADE || v === WEAPON_TASER;
}
export function isGunSlot(w: Weapon): boolean {
  return w === WEAPON_PISTOL || w === WEAPON_PRIMARY || w === WEAPON_TASER;
}

export type Phase = 'playing' | 'ended';

/** Which weapons a room allows; chosen at creation. 'all' = every slot; 'sword' = melee only. */
export const WEAPON_MODES = ['all', 'sword'] as const;
export type WeaponMode = (typeof WEAPON_MODES)[number];
export const DEFAULT_WEAPON_MODE: WeaponMode = 'all';
export function weaponAllowed(mode: WeaponMode, w: Weapon): boolean {
  return mode === 'all' || w === WEAPON_MELEE;
}
/** The slot a player starts with (and is forced to) under `mode`: the pistol, or melee in a sword-only room. */
export function defaultWeapon(mode: WeaponMode): Weapon {
  return mode === 'sword' ? WEAPON_MELEE : WEAPON_PISTOL;
}
/** Allowed slots in key order. */
export function allowedWeapons(mode: WeaponMode): Weapon[] {
  return WEAPONS.filter((w) => weaponAllowed(mode, w));
}

/**
 * What kind of room this is; chosen at creation. `match` is the normal
 * deathmatch. `training` is a practice range: bots are passive dummies parked
 * on the central plateau (they never attack, respawn fast) and any melee
 * weapon can be picked directly (MSG.selectMelee) instead of waiting for a drop.
 * `ctf` is capture the flag: two teams on a dedicated long map, see ctf.ts.
 * `td` is team elimination: rounds on a crossroads map, no respawn until the
 * next round, first team to `roundLimit` round wins takes the match, see td.ts.
 */
export const ROOM_MODES = ['match', 'training', 'ctf', 'td'] as const;
export type RoomMode = (typeof ROOM_MODES)[number];
export const DEFAULT_ROOM_MODE: RoomMode = 'match';
export function isRoomMode(v: unknown): v is RoomMode {
  return (ROOM_MODES as readonly unknown[]).includes(v);
}
export function isCtf(mode: RoomMode): boolean {
  return mode === 'ctf';
}
export function isTd(mode: RoomMode): boolean {
  return mode === 'td';
}
/** Modes played red vs. blue (team pick/switch, team spawns, no friendly fire, team results). */
export function isTeamMode(mode: RoomMode): boolean {
  return mode === 'ctf' || mode === 'td';
}
/** Respawn delay for a room mode (server rule; the client uses it for the countdown). Unused in td: the dead wait for the next round. */
export function respawnMsFor(mode: RoomMode): number {
  return mode === 'training' ? TRAINING_RESPAWN_MS : mode === 'ctf' ? CTF_RESPAWN_MS : RESPAWN_MS;
}

/** Teams (capture the flag). TEAM_NONE = no team (deathmatch / training). */
export const TEAM_NONE = 0;
export const TEAM_RED = 1;
export const TEAM_BLUE = 2;
export type Team = typeof TEAM_RED | typeof TEAM_BLUE;
export const TEAMS: readonly Team[] = [TEAM_RED, TEAM_BLUE];
export function isTeam(v: unknown): v is Team {
  return v === TEAM_RED || v === TEAM_BLUE;
}
export function otherTeam(t: Team): Team {
  return t === TEAM_RED ? TEAM_BLUE : TEAM_RED;
}
export function teamName(t: Team): string {
  return t === TEAM_RED ? 'Red' : 'Blue';
}

/** Bot difficulty, chosen at room creation; the numbers behind each level live in bot.ts. */
export const BOT_SKILLS = ['easy', 'normal', 'hard'] as const;
export type BotSkill = (typeof BOT_SKILLS)[number];
export const DEFAULT_BOT_SKILL: BotSkill = 'normal';
export function isBotSkill(v: unknown): v is BotSkill {
  return (BOT_SKILLS as readonly unknown[]).includes(v);
}

/** True when players may switch their melee weapon at will (training rooms with melee allowed). */
export function meleeSelectable(mode: RoomMode, weapons: WeaponMode): boolean {
  return mode === 'training' && weaponAllowed(weapons, WEAPON_MELEE);
}

/**
 * The slot a player holds right after a (re)spawn. Team elimination starts
 * blade-only — the pistol slot is empty until one is lifted off the ground —
 * so td spawns bring the melee out; everywhere else it is defaultWeapon.
 */
export function spawnWeapon(mode: RoomMode, weapons: WeaponMode): Weapon {
  return mode === 'td' ? WEAPON_MELEE : defaultWeapon(weapons);
}

export interface CreateOptions {
  name: string;
  durationMin: number;
  nickname: string;
  /** Number of AI bots to add at creation (0..MAX_BOTS). */
  bots?: number;
  /** Bot difficulty (default 'normal'; see BOT_SKILLS in bot.ts). */
  botSkill?: BotSkill;
  /** Allowed weapons (default 'all'). */
  weapons?: WeaponMode;
  /** Deathmatch, training range, capture the flag or team elimination (default 'match'). */
  mode?: RoomMode;
  /** CTF: captures needed to win (one of CTF_CAPTURE_LIMIT_OPTIONS). */
  captureLimit?: number;
  /** TD: round wins needed to take the match (one of TD_ROUND_LIMIT_OPTIONS). */
  roundLimit?: number;
}
export interface JoinOptions {
  nickname: string;
  /** CTF: team to join (TEAM_NONE / omitted = the server picks the smaller team). */
  team?: number;
}
export interface RoomMetadata {
  name: string;
  durationMin: number;
  /** Server epoch ms when the match ends (lobby display only). */
  endsAt: number;
  bots: number;
  /** Difficulty of the bots (only meaningful when bots > 0). */
  botSkill?: BotSkill;
  weapons: WeaponMode;
  mode: RoomMode;
  /** CTF only: captures needed to win. */
  captureLimit?: number;
  /** TD only: round wins needed to take the match. */
  roundLimit?: number;
  /** Team modes only: [red, blue] head counts (humans + bots), for the lobby list. */
  teams?: [number, number];
}

export interface PoseMsg {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  epoch: number;
  weapon: Weapon;
}
export interface ShootMsg {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  epoch: number;
  /** Which gun slot fired: WEAPON_PISTOL or WEAPON_PRIMARY. */
  weapon: Weapon;
}
/** Grenade throw: the thrower's pose (the grenade leaves the eye along yaw/pitch) and how long LMB was held (0..1 of GRENADE_THROW_CHARGE_MS → throw speed). */
export interface ThrowMsg {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  epoch: number;
  charge: number;
}
export interface SwingMsg {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  epoch: number;
  /** Which attack: light (LMB) or heavy (RMB held, released). A heavy claim is honoured only if a `charge` arrived ≥ MELEE_MIN_CHARGE_FRACTION × chargeMs earlier (damage scales with the hold, full at chargeMs), else it lands as light. */
  attack: AttackKind;
}
/** Sent when the player starts holding RMB with melee (charge begins); payload is the spawn epoch. */
export type ChargeMsg = number;
/** Sent when RMB is released too early for any heavy (no swing); payload is the spawn epoch. */
export type ChargeCancelMsg = number;
/** Sent when the player starts reloading a gun slot (WEAPON_PISTOL / WEAPON_PRIMARY). */
export interface ReloadMsg {
  epoch: number;
  weapon: Weapon;
}
/** Sent once when the player clicks to play; the server spawns them only after this. */
export type ReadyMsg = null;
/** Training rooms only: arm `kind` in `slot` right away (melee kinds → WEAPON_MELEE, PRIMARY_KINDS → WEAPON_PRIMARY); no drop needed. */
export interface SelectWeaponMsg {
  epoch: number;
  slot: Weapon;
  kind: number;
}

/** Throw the held weapon on the ground (G): the primary gun, the taser, or a picked-up blade (back to the sword). The thrown drop expires after DROP_THROWN_LIFETIME_MS. */
export interface DropWeaponMsg {
  epoch: number;
  slot: Weapon;
}

/** CTF: switch (or pick, before playing) a team; payload is the team. */
export type SelectTeamMsg = number;
/** CTF: let go of the carried flag (hand-off); payload is the spawn epoch. */
export type DropFlagMsg = number;

/** TD: a round started or ended; `winner` is TEAM_NONE for a start and for a drawn round. */
export interface RoundEventMsg {
  kind: 'start' | 'end';
  winner: Team | typeof TEAM_NONE;
  round: number;
  roundsRed: number;
  roundsBlue: number;
}

export type FlagEventKind = 'taken' | 'dropped' | 'returned' | 'captured';
/** CTF: something happened to a flag; `team` is the flag's owner. */
export interface FlagEventMsg {
  kind: FlagEventKind;
  team: Team;
  playerId: string;
  playerName: string;
  redScore: number;
  blueScore: number;
}

/** One ray of a shot (a shotgun fires several). */
export interface ShotRay {
  to: Vec3;
  hitPlayerId: string;
  /** Body part hit ('' on a miss). */
  part: HitPart | '';
  /** Damage dealt (0 on a miss). */
  damage: number;
}
export interface ShotMsg {
  shooterId: string;
  gun: GunKind;
  from: Vec3;
  rays: ShotRay[];
}
/** A grenade burst: where, whose, and who it hurt (damage per victim). */
export interface ExplodeMsg {
  ownerId: string;
  x: number;
  y: number;
  z: number;
  victims: { id: string; damage: number }[];
}
/** A melee swing was performed (hit or miss); drives the attacker's animation on other clients. */
export interface SwungMsg {
  attackerId: string;
  attack: AttackKind;
  /** Which melee weapon was swung. */
  melee: MeleeKind;
}
/** A melee swing connected (lethal or not). */
export interface HitMsg {
  attackerId: string;
  victimId: string;
  part: SwordPart;
  damage: number;
  attack: AttackKind;
  melee: MeleeKind;
}
/** A player walked over a drop and now holds it (the drop is gone from the state); `kind` per `slot` (GunKind / MeleeKind / grenade count). */
export interface PickupMsg {
  playerId: string;
  slot: Weapon;
  kind: number;
}
export interface KillMsg extends KillAwards {
  killerId: string;
  killerName: string;
  victimId: string;
  victimName: string;
  weapon: Weapon;
  /** Melee weapon used when `weapon` is the melee slot (MELEE_SWORD for gun kills). */
  melee: MeleeKind;
  /** Gun kind for gun kills (GUN_NONE for melee / grenade kills). */
  gun: GunKind;
  /** The killing blow landed on the head. */
  headshot: boolean;
}

export const MSG = {
  pose: 'pose',
  shoot: 'shoot',
  swing: 'swing',
  charge: 'charge',
  chargeCancel: 'chargeCancel',
  reload: 'reload',
  ready: 'ready',
  selectWeapon: 'selectWeapon',
  dropWeapon: 'dropWeapon',
  throw: 'throw',
  selectTeam: 'selectTeam',
  dropFlag: 'dropFlag',
  ping: 'ping',
  pong: 'pong',
  shot: 'shot',
  swung: 'swung',
  hit: 'hit',
  kill: 'kill',
  pickup: 'pickup',
  explode: 'explode',
  flag: 'flag',
  round: 'round',
} as const;

export const ROOM_NAME = 'arena';
