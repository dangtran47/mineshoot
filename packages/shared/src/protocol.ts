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
 */
export const ROOM_MODES = ['match', 'training'] as const;
export type RoomMode = (typeof ROOM_MODES)[number];
export const DEFAULT_ROOM_MODE: RoomMode = 'match';
export function isRoomMode(v: unknown): v is RoomMode {
  return (ROOM_MODES as readonly unknown[]).includes(v);
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
  /** Allowed weapons (default 'all'). */
  weapons?: WeaponMode;
  /** Deathmatch or training range (default 'match'). */
  mode?: RoomMode;
}
export interface JoinOptions {
  nickname: string;
}
export interface RoomMetadata {
  name: string;
  durationMin: number;
  /** Server epoch ms when the match ends (lobby display only). */
  endsAt: number;
  bots: number;
  weapons: WeaponMode;
  mode: RoomMode;
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
  ping: 'ping',
  pong: 'pong',
  shot: 'shot',
  swung: 'swung',
  hit: 'hit',
  kill: 'kill',
  pickup: 'pickup',
} as const;

export const ROOM_NAME = 'arena';
