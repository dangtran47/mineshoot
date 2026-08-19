import { CTF_RESPAWN_MS, RESPAWN_MS, TRAINING_RESPAWN_MS } from './constants';
import type { Vec3 } from './types';
import type { HitPart } from './hitbox';
import type { SwordPart } from './sword';
import type { KillAwards } from './kills';
import type { AttackKind, MeleeKind } from './melee';

export const WEAPON_GUN = 0;
export const WEAPON_SWORD = 1;
export type Weapon = typeof WEAPON_GUN | typeof WEAPON_SWORD;

export type Phase = 'playing' | 'ended';

/** Which weapons a room allows; chosen at creation. */
export const WEAPON_MODES = ['all', 'gun', 'sword'] as const;
export type WeaponMode = (typeof WEAPON_MODES)[number];
export const DEFAULT_WEAPON_MODE: WeaponMode = 'all';
export function weaponAllowed(mode: WeaponMode, w: Weapon): boolean {
  return mode === 'all' || (mode === 'gun' ? w === WEAPON_GUN : w === WEAPON_SWORD);
}
/** The weapon a player starts with (and is forced to) under `mode`. */
export function defaultWeapon(mode: WeaponMode): Weapon {
  return mode === 'sword' ? WEAPON_SWORD : WEAPON_GUN;
}
export function allowedWeapons(mode: WeaponMode): Weapon[] {
  return mode === 'all' ? [WEAPON_GUN, WEAPON_SWORD] : [defaultWeapon(mode)];
}

/**
 * What kind of room this is; chosen at creation. `match` is the normal
 * deathmatch. `training` is a practice range: bots are passive dummies parked
 * on the central plateau (they never attack, respawn fast) and any melee
 * weapon can be picked directly (MSG.selectMelee) instead of waiting for a drop.
 * `ctf` is capture the flag: two teams on a dedicated long map, see ctf.ts.
 */
export const ROOM_MODES = ['match', 'training', 'ctf'] as const;
export type RoomMode = (typeof ROOM_MODES)[number];
export const DEFAULT_ROOM_MODE: RoomMode = 'match';
export function isRoomMode(v: unknown): v is RoomMode {
  return (ROOM_MODES as readonly unknown[]).includes(v);
}
export function isCtf(mode: RoomMode): boolean {
  return mode === 'ctf';
}
/** Respawn delay for a room mode (server rule; the client uses it for the countdown). */
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
  return mode === 'training' && weaponAllowed(weapons, WEAPON_SWORD);
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
  /** Deathmatch, training range or capture the flag (default 'match'). */
  mode?: RoomMode;
  /** CTF: captures needed to win (one of CTF_CAPTURE_LIMIT_OPTIONS). */
  captureLimit?: number;
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
  /** CTF only: [red, blue] head counts (humans + bots), for the lobby list. */
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
}
export interface SwingMsg extends ShootMsg {
  /** Which attack: light (LMB) or heavy (RMB held, released). A heavy claim is honoured only if a `charge` arrived ≥ chargeMs earlier, else it lands as light. */
  attack: AttackKind;
}
/** Sent when the player starts holding RMB with melee (charge begins); payload is the spawn epoch. */
export type ChargeMsg = number;
/** Sent when RMB is released before the heavy was ready (no swing); payload is the spawn epoch. */
export type ChargeCancelMsg = number;
/** Sent when the player starts reloading the gun; payload is the spawn epoch. */
export type ReloadMsg = number;
/** Sent once when the player clicks to play; the server spawns them only after this. */
export type ReadyMsg = null;
/** Training rooms only: put this melee weapon in slot 2 right away (no drop needed). */
export interface SelectMeleeMsg {
  epoch: number;
  melee: MeleeKind;
}

/** CTF: switch (or pick, before playing) a team; payload is the team. */
export type SelectTeamMsg = number;
/** CTF: let go of the carried flag (hand-off); payload is the spawn epoch. */
export type DropFlagMsg = number;

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

export interface ShotMsg {
  shooterId: string;
  from: Vec3;
  to: Vec3;
  hitPlayerId: string;
  /** Body part hit ('' on a miss). */
  part: HitPart | '';
  /** Damage dealt (0 on a miss). */
  damage: number;
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
/** A player walked over a weapon drop and now holds it (the drop is gone from the state). */
export interface PickupMsg {
  playerId: string;
  melee: MeleeKind;
}
export interface KillMsg extends KillAwards {
  killerId: string;
  killerName: string;
  victimId: string;
  victimName: string;
  weapon: Weapon;
  /** Melee weapon used when `weapon` is the melee slot (MELEE_SWORD for gun kills). */
  melee: MeleeKind;
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
  selectMelee: 'selectMelee',
  selectTeam: 'selectTeam',
  dropFlag: 'dropFlag',
  ping: 'ping',
  pong: 'pong',
  shot: 'shot',
  swung: 'swung',
  hit: 'hit',
  kill: 'kill',
  pickup: 'pickup',
  flag: 'flag',
} as const;

export const ROOM_NAME = 'arena';
