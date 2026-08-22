import { Client } from 'colyseus.js';
import type { Room } from 'colyseus.js';
import { ROOM_NAME } from '@mineshoot/shared';
import type { CreateOptions, FlagStatus, RoomMetadata, RoomMode, WeaponMode } from '@mineshoot/shared';

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
  /** Melee weapon in slot 3 (MeleeKind). */
  melee: number;
  /** Pistol slot (key 2): GUN_PISTOL, or GUN_NONE while empty (td spawns blade-only). */
  pistol: number;
  /** Primary gun in slot 1 (GunKind; GUN_NONE = empty). */
  gun: number;
  /** Taser slot (key 5): GUN_TASER while held, GUN_NONE when empty / spent. */
  taser: number;
  /** Grenades in slot 4. */
  grenades: number;
  color: number;
  isBot: boolean;
  shielded: boolean;
  charging: boolean;
  reloading: boolean;
  /** Crouching (hold Ctrl/C): shorter hitbox, lower eye, half speed. */
  crouching: boolean;
  /** CTF: TEAM_RED / TEAM_BLUE (TEAM_NONE elsewhere). */
  team: number;
  /** CTF: flags captured. */
  captures: number;
}
/** CTF: one team's flag; x/y/z follow the carrier while carried. */
export interface NetFlag {
  team: number;
  status: FlagStatus;
  x: number;
  y: number;
  z: number;
  carrierId: string;
}
export interface NetDrop {
  /** Slot the drop fills (WEAPON_PRIMARY / WEAPON_MELEE / WEAPON_GRENADE); `kind` per slot. */
  slot: number;
  kind: number;
  x: number;
  y: number;
  z: number;
}
/** A live grenade (server-simulated). */
export interface NetGrenade {
  ownerId: string;
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
  grenades: NetMap<NetGrenade>;
  /** CTF: flags keyed by team ('1' red, '2' blue); empty otherwise. */
  flags: NetMap<NetFlag>;
  redScore: number;
  blueScore: number;
  captureLimit: number;
  /** TD: rounds won, running round number, round wins to take the match, 'live' | 'intermission'. */
  roundsRed: number;
  roundsBlue: number;
  round: number;
  roundLimit: number;
  roundPhase: string;
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

/** `team` (CTF): TEAM_RED / TEAM_BLUE, or TEAM_NONE / omitted to let the server pick the smaller side. */
export async function joinRoom(roomId: string, nickname: string, team = 0): Promise<GameRoom> {
  let room: GameRoom;
  try {
    room = await new Client(WS_URL).joinById<NetRoomState>(roomId, { nickname, team });
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
