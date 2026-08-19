import { ATTACK_LIGHT, CTF_CAPTURE_LIMIT_OPTIONS, CTF_DEFAULT_CAPTURE_LIMIT, DEFAULT_BOT_SKILL, DEFAULT_DURATION_MIN, DEFAULT_ROOM_MODE, DEFAULT_WEAPON_MODE, DURATION_OPTIONS_MIN, MAX_BOTS, MAX_NAME_LEN, TEAM_NONE, WEAPON_MODES, WORLD_SX, WORLD_SZ, isAttackKind, isBotSkill, isMeleeKind, isRoomMode, isTeam } from '@mineshoot/shared';
import type { BotSkill, PoseMsg, RoomMode, SelectMeleeMsg, ShootMsg, SwingMsg, Team, Weapon, WeaponMode } from '@mineshoot/shared';

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

/** Bot difficulty; anything unknown is 'normal'. */
export function parseBotSkill(raw: unknown): BotSkill {
  return isBotSkill(raw) ? raw : DEFAULT_BOT_SKILL;
}

/** Allowed-weapons rule; anything unknown falls back to the default ('all'). */
export function parseWeaponMode(raw: unknown): WeaponMode {
  return (WEAPON_MODES as readonly unknown[]).includes(raw) ? (raw as WeaponMode) : DEFAULT_WEAPON_MODE;
}

/** Room kind; anything unknown is a normal match. */
export function parseRoomMode(raw: unknown): RoomMode {
  return isRoomMode(raw) ? raw : DEFAULT_ROOM_MODE;
}

/** CTF capture limit; must be one of the offered options, else the default. */
export function parseCaptureLimit(raw: unknown): number {
  return (CTF_CAPTURE_LIMIT_OPTIONS as readonly unknown[]).includes(raw) ? (raw as number) : CTF_DEFAULT_CAPTURE_LIMIT;
}

/** A team choice (join options / MSG.selectTeam); anything else means "no preference". */
export function parseTeam(raw: unknown): Team | typeof TEAM_NONE {
  return isTeam(raw) ? raw : TEAM_NONE;
}

/** World extent used to clamp poses (the CTF map is bigger than the arena). */
export interface Bounds {
  sx: number;
  sz: number;
}
const ARENA_BOUNDS: Bounds = { sx: WORLD_SX, sz: WORLD_SZ };

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

function parsePoseLike(msg: unknown, b: Bounds): PoseLike | null {
  if (typeof msg !== 'object' || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (!finite(m.x) || !finite(m.y) || !finite(m.z) || !finite(m.yaw) || !finite(m.pitch)) return null;
  if (!Number.isInteger(m.epoch)) return null;
  return {
    x: clamp(m.x, 0.5, b.sx - 0.5),
    y: clamp(m.y, 0, 64),
    z: clamp(m.z, 0.5, b.sz - 0.5),
    yaw: m.yaw,
    pitch: clamp(m.pitch, -Math.PI / 2, Math.PI / 2),
    epoch: m.epoch as number,
  };
}

export function parsePose(msg: unknown, bounds: Bounds = ARENA_BOUNDS): PoseMsg | null {
  const p = parsePoseLike(msg, bounds);
  if (!p) return null;
  const w = (msg as Record<string, unknown>).weapon;
  const weapon: Weapon = w === 1 ? 1 : 0;
  return { ...p, weapon };
}

export function parseShoot(msg: unknown, bounds: Bounds = ARENA_BOUNDS): ShootMsg | null {
  return parsePoseLike(msg, bounds);
}

export function parseSwing(msg: unknown, bounds: Bounds = ARENA_BOUNDS): SwingMsg | null {
  const p = parsePoseLike(msg, bounds);
  if (!p) return null;
  const a = (msg as Record<string, unknown>).attack;
  return { ...p, attack: isAttackKind(a) ? a : ATTACK_LIGHT };
}

/** Charge-start payload: the sender's spawn epoch. */
export function parseCharge(msg: unknown): number | null {
  return Number.isInteger(msg) ? (msg as number) : null;
}

/** Reload payload: the sender's spawn epoch. */
export const parseReload = parseCharge;
/** Charge-cancel payload: the sender's spawn epoch. */
export const parseChargeCancel = parseCharge;
/** Drop-flag payload: the sender's spawn epoch. */
export const parseDropFlag = parseCharge;

/** Training-range melee pick: integer epoch + a known melee kind. */
export function parseSelectMelee(msg: unknown): SelectMeleeMsg | null {
  if (typeof msg !== 'object' || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (!Number.isInteger(m.epoch) || !isMeleeKind(m.melee)) return null;
  return { epoch: m.epoch as number, melee: m.melee };
}
