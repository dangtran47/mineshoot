import { Client } from 'colyseus.js';
import type { Room } from 'colyseus.js';
import { ROOM_NAME } from '@mineshoot/shared';
import type { CreateOptions, RoomMetadata, RoomMode, WeaponMode } from '@mineshoot/shared';

/** Structural views over the server's synced schema (decoded via reflection). */
export interface NetPlayer {
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  alive: boolean;
  hp: number;
  kills: number;
  deaths: number;
  spawnEpoch: number;
  weapon: number;
  /** Melee weapon in slot 2 (MeleeKind). */
  melee: number;
  color: number;
  isBot: boolean;
  shielded: boolean;
  charging: boolean;
  reloading: boolean;
}
export interface NetDrop {
  kind: number;
  x: number;
  y: number;
  z: number;
}
export interface NetMap<T> {
  size: number;
  get(key: string): T | undefined;
  has(key: string): boolean;
  forEach(cb: (value: T, key: string) => void): void;
}
export interface NetRoomState {
  phase: 'playing' | 'ended';
  name: string;
  seed: number;
  durationMin: number;
  weapons: WeaponMode;
  mode: RoomMode;
  timeLeftMs: number;
  players: NetMap<NetPlayer>;
  drops: NetMap<NetDrop>;
}
export type GameRoom = Room<NetRoomState>;

export interface RoomListEntry {
  roomId: string;
  clients: number;
  maxClients: number;
  locked: boolean;
  metadata: RoomMetadata;
}

export const WS_URL: string = import.meta.env.VITE_SERVER_URL ?? 'ws://localhost:2567';
export const HTTP_URL = WS_URL.replace(/^ws/, 'http');

export async function listRooms(): Promise<RoomListEntry[]> {
  const res = await fetch(`${HTTP_URL}/rooms`);
  if (!res.ok) throw new Error(`Room list failed (${res.status})`);
  return (await res.json()) as RoomListEntry[];
}

export async function createRoom(options: CreateOptions): Promise<GameRoom> {
  let room: GameRoom;
  try {
    room = await new Client(WS_URL).create<NetRoomState>(ROOM_NAME, options);
  } catch (error) {
    throw new Error(friendlyError(error, 'Could not create room'));
  }
  return waitForSelf(room);
}

export async function joinRoom(roomId: string, nickname: string): Promise<GameRoom> {
  let room: GameRoom;
  try {
    room = await new Client(WS_URL).joinById<NetRoomState>(roomId, { nickname });
  } catch (error) {
    throw new Error(friendlyError(error, 'Could not join room'));
  }
  return waitForSelf(room);
}

/** Resolves once the first synced state contains our own player. */
function waitForSelf(room: GameRoom): Promise<GameRoom> {
  return new Promise((resolve, reject) => {
    const settle = (): void => {
      if (room.state?.players?.has(room.sessionId)) {
        cleanup();
        resolve(room);
      }
    };
    const timeout = setTimeout(() => {
      cleanup();
      void room.leave();
      reject(new Error('Timed out waiting for room state'));
    }, 5000);
    const cleanup = (): void => {
      clearTimeout(timeout);
      room.onStateChange.remove(settle);
    };
    room.onStateChange(settle);
    settle();
  });
}

function friendlyError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/locked/i.test(message)) return 'Match already ended';
  if (/full|maxClients|max clients/i.test(message)) return 'Room is full';
  if (/expired|not found/i.test(message)) return 'Room not found';
  if (/failed to fetch|network|ECONNREFUSED/i.test(message)) return 'Cannot reach server';
  return message !== '' ? `${fallback}: ${message}` : fallback;
}

/** Name as shown in nametags, feeds and tables. */
export function displayName(name: string, isBot: boolean): string {
  return isBot ? `\u{1F916} ${name}` : name;
}
