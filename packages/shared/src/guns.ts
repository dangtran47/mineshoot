import { GUN_COOLDOWN_MS, GUN_DAMAGE, GUN_MAG_SIZE, GUN_RANGE, GUN_RELOAD_MS, GUN_RELOAD_SERVER_MIN_MS, GUN_SERVER_MIN_INTERVAL_MS } from './constants';
import { WEAPON_PRIMARY, weaponAllowed } from './protocol';
import type { RoomMode, WeaponMode } from './protocol';
import type { HitPart } from './hitbox';
import { forwardVector } from './playerPhysics';
import type { Vec3 } from './types';

/*
 * Gun kinds. Slot 2 (pistol) always holds GUN_PISTOL; slot 1 (primary) holds
 * one of PRIMARY_KINDS picked up from a drop, or GUN_NONE when empty.
 */
export const GUN_NONE = 0;
export const GUN_PISTOL = 1;
export const GUN_RIFLE = 2;
export const GUN_SMG = 3;
export const GUN_SHOTGUN = 4;
export const GUN_SNIPER = 5;
export const GUN_TASER = 6;
export type GunKind = typeof GUN_NONE | typeof GUN_PISTOL | typeof GUN_RIFLE | typeof GUN_SMG | typeof GUN_SHOTGUN | typeof GUN_SNIPER | typeof GUN_TASER;
export const GUN_KINDS: readonly GunKind[] = [GUN_PISTOL, GUN_RIFLE, GUN_SMG, GUN_SHOTGUN, GUN_SNIPER, GUN_TASER];
/** Kinds that can sit in the primary slot (drops / training keys); the taser has its own slot. */
export const PRIMARY_KINDS: readonly GunKind[] = [GUN_RIFLE, GUN_SMG, GUN_SHOTGUN, GUN_SNIPER];

export interface GunSpec {
  name: string;
  /** Rounds per magazine (taser: total charges, see `consumable`). */
  magSize: number;
  cooldownMs: number;
  /** Server-side minimum interval between shots (slack for network jitter). */
  serverMinIntervalMs: number;
  /** 0 = cannot reload. */
  reloadMs: number;
  serverReloadMinMs: number;
  range: number;
  damage: Record<HitPart, number>;
  /** Rays per shot. */
  pellets: number;
  /** Cone half-angle (degrees) the pellets / auto-fire jitter spread over; 0 = exact. */
  spreadDeg: number;
  /** Keeps firing while LMB is held. */
  auto: boolean;
  /** RMB zoom factor (1 = none). */
  zoom: number;
  /** Empty magazine ⇒ the weapon is gone (taser). */
  consumable: boolean;
  /** Reloads one round per `reloadMs` (shotgun): shooting interrupts the reload and keeps the rounds loaded so far. */
  perShell: boolean;
}

type SpecInput = Omit<GunSpec, 'serverMinIntervalMs' | 'serverReloadMinMs' | 'perShell'> & { perShell?: boolean };
const spec = (s: SpecInput): GunSpec => ({ perShell: false, ...s, serverMinIntervalMs: s.cooldownMs - 50, serverReloadMinMs: Math.max(0, s.reloadMs - 100) });

export const GUN_STATS: Record<GunKind, GunSpec> = {
  [GUN_NONE]: spec({ name: 'Empty', magSize: 0, cooldownMs: 1000, reloadMs: 0, range: 0, damage: { head: 0, torso: 0, legs: 0 }, pellets: 0, spreadDeg: 0, auto: false, zoom: 1, consumable: false }),
  // Today's gun, unchanged.
  [GUN_PISTOL]: { name: 'Pistol', magSize: GUN_MAG_SIZE, cooldownMs: GUN_COOLDOWN_MS, serverMinIntervalMs: GUN_SERVER_MIN_INTERVAL_MS, reloadMs: GUN_RELOAD_MS, serverReloadMinMs: GUN_RELOAD_SERVER_MIN_MS, range: GUN_RANGE, damage: { ...GUN_DAMAGE }, pellets: 1, spreadDeg: 0, auto: false, zoom: 1, consumable: false, perShell: false },
  [GUN_RIFLE]: spec({ name: 'Rifle', magSize: 25, cooldownMs: 150, reloadMs: 2000, range: 60, damage: { head: 70, torso: 25, legs: 12 }, pellets: 1, spreadDeg: 1.5, auto: true, zoom: 1, consumable: false }),
  [GUN_SMG]: spec({ name: 'SMG', magSize: 35, cooldownMs: 80, reloadMs: 1800, range: 40, damage: { head: 40, torso: 15, legs: 8 }, pellets: 1, spreadDeg: 3, auto: true, zoom: 1, consumable: false }),
  [GUN_SHOTGUN]: spec({ name: 'Shotgun', magSize: 6, cooldownMs: 400, reloadMs: 450, perShell: true, range: 18, damage: { head: 45, torso: 25, legs: 12 }, pellets: 8, spreadDeg: 6, auto: false, zoom: 1, consumable: false }),
  [GUN_SNIPER]: spec({ name: 'Sniper', magSize: 4, cooldownMs: 1200, reloadMs: 2800, range: 60, damage: { head: 100, torso: 100, legs: 60 }, pellets: 1, spreadDeg: 0, auto: false, zoom: 3, consumable: false }),
  // Two charges, then it's gone.
  [GUN_TASER]: spec({ name: 'Taser', magSize: 2, cooldownMs: 1000, reloadMs: 0, range: 5, damage: { head: 100, torso: 100, legs: 100 }, pellets: 1, spreadDeg: 0, auto: false, zoom: 1, consumable: true }),
};

export function isGunKind(v: unknown): v is GunKind {
  return typeof v === 'number' && (GUN_KINDS as readonly number[]).includes(v);
}
export function isPrimaryKind(v: unknown): v is GunKind {
  return typeof v === 'number' && (PRIMARY_KINDS as readonly number[]).includes(v);
}
export function gunSpec(kind: GunKind): GunSpec {
  return GUN_STATS[kind] ?? GUN_STATS[GUN_PISTOL];
}

/**
 * Directions of the rays one shot fires: the exact view direction for a tight
 * gun; otherwise `pellets` directions uniformly inside the spread cone, drawn
 * from `rng` (the server's seeded rng → deterministic, replayable).
 */
export function pelletDirections(yaw: number, pitch: number, spec: GunSpec, rng: () => number): Vec3[] {
  if (spec.spreadDeg <= 0) return [forwardVector(yaw, pitch)];
  const spread = (spec.spreadDeg * Math.PI) / 180;
  const out: Vec3[] = [];
  for (let i = 0; i < spec.pellets; i++) {
    const r = spread * Math.sqrt(rng());
    const a = rng() * Math.PI * 2;
    out.push(forwardVector(yaw + r * Math.cos(a), pitch + r * Math.sin(a)));
  }
  return out;
}

/**
 * Server-side minimum reload window for a gun holding `ammo` rounds: the usual
 * full-mag window, or one shell interval per missing round for per-shell guns
 * (the jitter slack is applied once to the total).
 */
export function serverReloadMs(spec: GunSpec, ammo: number): number {
  if (!spec.perShell) return spec.serverReloadMinMs;
  const missing = Math.max(1, spec.magSize - ammo);
  return Math.max(spec.serverReloadMinMs, missing * spec.reloadMs - (spec.reloadMs - spec.serverReloadMinMs));
}

/**
 * Magazine contents when a reload that would finish `remainingMs` from now is
 * interrupted by a shot: per-shell guns keep the rounds already loaded (one
 * per elapsed interval), full-mag reloads load nothing until they finish.
 */
export function interruptedReloadAmmo(spec: GunSpec, ammo: number, remainingMs: number): number {
  if (!spec.perShell) return ammo;
  return Math.max(ammo, spec.magSize - Math.ceil(Math.max(0, remainingMs) / spec.reloadMs));
}

/** Primaries a deathmatch spawn can roll (the taser is a pickup, never a roll). */
export const SPAWN_PRIMARY_KINDS: readonly GunKind[] = PRIMARY_KINDS;

/**
 * The primary gun a fresh (re)spawn gets: a random one in a solo deathmatch
 * where guns are allowed, empty everywhere else — team modes (CTF and future
 * team deathmatch) start on the pistol, the training range lets you pick your
 * own, sword-only rooms have no guns at all.
 */
export function spawnPrimary(mode: RoomMode, weapons: WeaponMode, rng: () => number): GunKind {
  if (mode !== 'match' || !weaponAllowed(weapons, WEAPON_PRIMARY)) return GUN_NONE;
  return SPAWN_PRIMARY_KINDS[Math.floor(rng() * SPAWN_PRIMARY_KINDS.length)];
}
