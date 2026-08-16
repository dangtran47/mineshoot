import type { Vec3 } from './types';

export const WEAPON_GUN = 0;
export const WEAPON_SWORD = 1;
export type Weapon = typeof WEAPON_GUN | typeof WEAPON_SWORD;

export type Phase = 'playing' | 'ended';

export interface CreateOptions {
  name: string;
  durationMin: number;
  nickname: string;
  /** Number of AI bots to add at creation (0..MAX_BOTS). */
  bots?: number;
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
export type SwingMsg = ShootMsg;

export interface ShotMsg {
  shooterId: string;
  from: Vec3;
  to: Vec3;
  hitPlayerId: string;
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
  ping: 'ping',
  pong: 'pong',
  shot: 'shot',
  kill: 'kill',
} as const;

export const ROOM_NAME = 'arena';
