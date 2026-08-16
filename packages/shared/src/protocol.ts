import type { Vec3 } from './types';
import type { HitPart } from './hitbox';
import type { SwordPart } from './sword';

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

export interface CreateOptions {
  name: string;
  durationMin: number;
  nickname: string;
  /** Number of AI bots to add at creation (0..MAX_BOTS). */
  bots?: number;
  /** Allowed weapons (default 'all'). */
  weapons?: WeaponMode;
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
  /** Client claims a charged swing; the server only honours it if the charge really lasted SWORD_CHARGE_MS. */
  charged: boolean;
}
/** Sent when the player starts holding the sword button; payload is the spawn epoch. */
export type ChargeMsg = number;
/** Sent when the player starts reloading the gun; payload is the spawn epoch. */
export type ReloadMsg = number;
/** Sent once when the player clicks to play; the server spawns them only after this. */
export type ReadyMsg = null;

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
/** A sword swing connected (lethal or not). */
export interface HitMsg {
  attackerId: string;
  victimId: string;
  part: SwordPart;
  damage: number;
  charged: boolean;
}
export interface KillMsg {
  killerId: string;
  killerName: string;
  victimId: string;
  victimName: string;
  weapon: Weapon;
}

export const MSG = {
  pose: 'pose',
  shoot: 'shoot',
  swing: 'swing',
  charge: 'charge',
  reload: 'reload',
  ready: 'ready',
  ping: 'ping',
  pong: 'pong',
  shot: 'shot',
  hit: 'hit',
  kill: 'kill',
} as const;

export const ROOM_NAME = 'arena';
