import { ATTACK_LIGHT, CTF_CAPTURE_LIMIT_OPTIONS, CTF_DEFAULT_CAPTURE_LIMIT, DEFAULT_BOT_SKILL, DEFAULT_DURATION_MIN, DEFAULT_ROOM_MODE, DEFAULT_WEAPON_MODE, DURATION_OPTIONS_MIN, MAX_BOTS, MAX_NAME_LEN, TD_DEFAULT_ROUND_LIMIT, TD_ROUND_LIMIT_OPTIONS, TEAM_NONE, GUN_TASER, WEAPON_MELEE, WEAPON_MODES, WEAPON_PISTOL, WEAPON_PRIMARY, WEAPON_TASER, WORLD_SX, WORLD_SZ, isAttackKind, isBotSkill, isGunSlot, isMeleeKind, isPrimaryKind, isRoomMode, isTeam, isWeapon } from '@mineshoot/shared';
import type { BotSkill, DropWeaponMsg, PoseMsg, ReloadMsg, RoomMode, SelectWeaponMsg, ShootMsg, SwingMsg, Team, ThrowMsg, Weapon, WeaponMode } from '@mineshoot/shared';

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

/** TD round limit; must be one of the offered options, else the default. */
export function parseRoundLimit(raw: unknown): number {
  return (TD_ROUND_LIMIT_OPTIONS as readonly unknown[]).includes(raw) ? (raw as number) : TD_DEFAULT_ROUND_LIMIT;
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
  crouch: boolean;
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
    crouch: m.crouch === true, // absent (old clients) or anything else = standing
  };
}

export function parsePose(msg: unknown, bounds: Bounds = ARENA_BOUNDS): PoseMsg | null {
  const p = parsePoseLike(msg, bounds);
  if (!p) return null;
  const w = (msg as Record<string, unknown>).weapon;
  const weapon: Weapon = isWeapon(w) ? w : WEAPON_PISTOL;
  return { ...p, weapon };
}

export function parseShoot(msg: unknown, bounds: Bounds = ARENA_BOUNDS): ShootMsg | null {
  const p = parsePoseLike(msg, bounds);
  if (!p) return null;
  const w = (msg as Record<string, unknown>).weapon;
  return { ...p, weapon: isWeapon(w) && isGunSlot(w) ? w : WEAPON_PISTOL };
}

/** Throw: pose-like + the hold charge (0..1; garbage → a tap). */
export function parseThrow(msg: unknown, bounds: Bounds = ARENA_BOUNDS): ThrowMsg | null {
  const p = parsePoseLike(msg, bounds);
  if (!p) return null;
  const c = (msg as Record<string, unknown>).charge;
  return { ...p, charge: finite(c) ? clamp(c, 0, 1) : 0 };
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

/** Reload payload: {epoch, weapon} for a gun slot (a bare epoch means the pistol). */
export function parseReload(msg: unknown): ReloadMsg | null {
  if (Number.isInteger(msg)) return { epoch: msg as number, weapon: WEAPON_PISTOL };
  if (typeof msg !== 'object' || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (!Number.isInteger(m.epoch) || !isWeapon(m.weapon) || !isGunSlot(m.weapon)) return null;
  return { epoch: m.epoch as number, weapon: m.weapon };
}
/** Charge-cancel payload: the sender's spawn epoch. */
export const parseChargeCancel = parseCharge;
/** Drop-flag payload: the sender's spawn epoch. */
export const parseDropFlag = parseCharge;

/** Drop-weapon (G) payload: {epoch, slot} for a droppable slot (primary gun, taser or the melee blade). */
export function parseDropWeapon(msg: unknown): DropWeaponMsg | null {
  if (typeof msg !== 'object' || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (!Number.isInteger(m.epoch)) return null;
  if (m.slot !== WEAPON_PRIMARY && m.slot !== WEAPON_TASER && m.slot !== WEAPON_MELEE) return null;
  return { epoch: m.epoch as number, slot: m.slot };
}

/** Training-range weapon pick: integer epoch + a melee kind for the melee slot or a primary kind for the primary slot. */
export function parseSelectWeapon(msg: unknown): SelectWeaponMsg | null {
  if (typeof msg !== 'object' || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (!Number.isInteger(m.epoch)) return null;
  if (m.slot === WEAPON_MELEE && isMeleeKind(m.kind)) return { epoch: m.epoch as number, slot: WEAPON_MELEE, kind: m.kind };
  if (m.slot === WEAPON_PRIMARY && isPrimaryKind(m.kind)) return { epoch: m.epoch as number, slot: WEAPON_PRIMARY, kind: m.kind };
  if (m.slot === WEAPON_TASER && m.kind === GUN_TASER) return { epoch: m.epoch as number, slot: WEAPON_TASER, kind: GUN_TASER };
  return null;
}
