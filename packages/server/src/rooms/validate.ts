import { DEFAULT_DURATION_MIN, DEFAULT_WEAPON_MODE, DURATION_OPTIONS_MIN, MAX_BOTS, MAX_NAME_LEN, WEAPON_MODES, WORLD_SX, WORLD_SZ } from '@mineshoot/shared';
import type { PoseMsg, ShootMsg, SwingMsg, Weapon, WeaponMode } from '@mineshoot/shared';

export function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, MAX_NAME_LEN);
  return cleaned.length > 0 ? cleaned : fallback;
}

export function sanitizeRoomName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.replace(/[^\p{L}\p{N} _\-.!?']/gu, '').trim().slice(0, 24);
  return cleaned.length > 0 ? cleaned : fallback;
}

/** Duration in minutes; must be one of the offered options, else the default. */
export function parseDurationMin(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_DURATION_MIN;
  return (DURATION_OPTIONS_MIN as readonly number[]).includes(raw) ? raw : DEFAULT_DURATION_MIN;
}

/** Bot count 0..MAX_BOTS (integers only), default 0. */
export function parseBotCount(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return 0;
  return Math.max(0, Math.min(MAX_BOTS, raw));
}

/** Allowed-weapons rule; anything unknown falls back to the default ('all'). */
export function parseWeaponMode(raw: unknown): WeaponMode {
  return (WEAPON_MODES as readonly unknown[]).includes(raw) ? (raw as WeaponMode) : DEFAULT_WEAPON_MODE;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

interface PoseLike {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  epoch: number;
}

function parsePoseLike(msg: unknown): PoseLike | null {
  if (typeof msg !== 'object' || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (!finite(m.x) || !finite(m.y) || !finite(m.z) || !finite(m.yaw) || !finite(m.pitch)) return null;
  if (!Number.isInteger(m.epoch)) return null;
  return {
    x: clamp(m.x, 0.5, WORLD_SX - 0.5),
    y: clamp(m.y, 0, 64),
    z: clamp(m.z, 0.5, WORLD_SZ - 0.5),
    yaw: m.yaw,
    pitch: clamp(m.pitch, -Math.PI / 2, Math.PI / 2),
    epoch: m.epoch as number,
  };
}

export function parsePose(msg: unknown): PoseMsg | null {
  const p = parsePoseLike(msg);
  if (!p) return null;
  const w = (msg as Record<string, unknown>).weapon;
  const weapon: Weapon = w === 1 ? 1 : 0;
  return { ...p, weapon };
}

export function parseShoot(msg: unknown): ShootMsg | null {
  return parsePoseLike(msg);
}

export function parseSwing(msg: unknown): SwingMsg | null {
  const p = parsePoseLike(msg);
  if (!p) return null;
  return { ...p, charged: (msg as Record<string, unknown>).charged === true };
}

/** Charge-start payload: the sender's spawn epoch. */
export function parseCharge(msg: unknown): number | null {
  return Number.isInteger(msg) ? (msg as number) : null;
}

/** Reload payload: the sender's spawn epoch. */
export const parseReload = parseCharge;
