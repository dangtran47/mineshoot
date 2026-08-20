import { EYE_HEIGHT, GRAVITY, LEGS_TOP, TORSO_TOP } from './constants';
import { aabbCenter } from './aabb';
import { moveAABB } from './collision';
import type { ShotTarget } from './gun';
import { forwardVector } from './playerPhysics';
import { raycastVoxels } from './raycast';
import type { AABB, PlayerPose, Vec3, World } from './types';

/*
 * Grenades (slot 4). Thrown from the eye along the view direction, they fly
 * ballistically, bounce off voxels and burst after a fixed fuse; damage falls
 * off linearly with distance and is blocked by walls. Server-simulated; the
 * client only renders `state.grenades`.
 */
export const GRENADE_START = 2;
export const GRENADE_MAX = 4;
/** A "Grenades" drop adds this many. */
export const GRENADE_DROP_AMOUNT = 2;
/** Throw speed: a tap lobs at MIN, holding LMB charges up to MAX over GRENADE_THROW_CHARGE_MS (hold as long as you like; only release throws). */
export const GRENADE_THROW_MIN_SPEED = 10;
export const GRENADE_THROW_MAX_SPEED = 24;
export const GRENADE_THROW_CHARGE_MS = 900;
export const GRENADE_RADIUS = 0.15;
/** Speed kept (and reversed) along the axis that hit a voxel. */
export const GRENADE_BOUNCE = 0.4;
/** Tangential speed kept on a floor bounce. */
export const GRENADE_FRICTION = 0.7;
export const GRENADE_FUSE_MS = 2500;
export const GRENADE_THROW_COOLDOWN_MS = 600;
export const GRENADE_SERVER_MIN_INTERVAL_MS = 550;
export const GRENADE_BLAST_RADIUS = 5;
export const GRENADE_DAMAGE_CENTER = 100;
export const GRENADE_DAMAGE_EDGE = 30;
/** Physics sub-steps per 50 ms server tick. */
export const GRENADE_SUBSTEPS = 4;

export interface GrenadeState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  bornAt: number;
}

/** Initial speed for a throw held to `charge` (0..1, clamped). */
export function throwSpeed(charge: number): number {
  const c = Math.min(1, Math.max(0, charge));
  return GRENADE_THROW_MIN_SPEED + (GRENADE_THROW_MAX_SPEED - GRENADE_THROW_MIN_SPEED) * c;
}

/** A grenade leaving the thrower's eye (a little ahead, so it never starts inside their own head box), at the speed of a `charge`-long hold. */
export function throwGrenade(pose: PlayerPose, now: number, charge = 1): GrenadeState {
  const d = forwardVector(pose.yaw, pose.pitch);
  const v = throwSpeed(charge);
  return {
    x: pose.x + d.x * 0.4,
    y: pose.y + EYE_HEIGHT - 0.1 + d.y * 0.4,
    z: pose.z + d.z * 0.4,
    vx: d.x * v,
    vy: d.y * v,
    vz: d.z * v,
    bornAt: now,
  };
}

/** Advance one grenade by `dt` seconds: gravity, swept voxel collision, bounce. */
export function stepGrenade(world: World, g: GrenadeState, dt: number): GrenadeState {
  const vy = g.vy - GRAVITY * dt;
  const r = GRENADE_RADIUS;
  const box: AABB = { min: { x: g.x - r, y: g.y - r, z: g.z - r }, max: { x: g.x + r, y: g.y + r, z: g.z + r } };
  const m = moveAABB(world, box, { x: g.vx * dt, y: vy * dt, z: g.vz * dt });
  let nvx = g.vx;
  let nvy = vy;
  let nvz = g.vz;
  if (m.hitY) {
    nvy = -vy * GRENADE_BOUNCE;
    if (Math.abs(nvy) < 1) nvy = 0;
    nvx *= GRENADE_FRICTION;
    nvz *= GRENADE_FRICTION;
  }
  if (m.hitX) nvx = -g.vx * GRENADE_BOUNCE;
  if (m.hitZ) nvz = -g.vz * GRENADE_BOUNCE;
  const c = aabbCenter(m.box);
  return { x: c.x, y: c.y, z: c.z, vx: nvx, vy: nvy, vz: nvz, bornAt: g.bornAt };
}

export function grenadeFuseDone(g: GrenadeState, now: number): boolean {
  return now - g.bornAt >= GRENADE_FUSE_MS;
}

/** Damage at `dist` blocks from the burst: linear from the centre value to the edge value, 0 beyond the radius. */
export function blastDamage(dist: number): number {
  if (dist > GRENADE_BLAST_RADIUS) return 0;
  return Math.round(GRENADE_DAMAGE_CENTER + (GRENADE_DAMAGE_EDGE - GRENADE_DAMAGE_CENTER) * (dist / GRENADE_BLAST_RADIUS));
}

export interface BlastVictim {
  id: string;
  damage: number;
}

/** Everyone in `targets` the burst at `at` reaches (distance to the torso centre; voxels in between block it). */
export function explosionVictims(world: World, at: Vec3, targets: ShotTarget[]): BlastVictim[] {
  const out: BlastVictim[] = [];
  for (const t of targets) {
    const torso: Vec3 = { x: t.pose.x, y: t.pose.y + (LEGS_TOP + TORSO_TOP) / 2, z: t.pose.z };
    const dx = torso.x - at.x;
    const dy = torso.y - at.y;
    const dz = torso.z - at.z;
    const dist = Math.hypot(dx, dy, dz);
    const damage = blastDamage(dist);
    if (damage <= 0) continue;
    if (dist > 1e-3 && raycastVoxels(world, at, { x: dx / dist, y: dy / dist, z: dz / dist }, dist).hit) continue;
    out.push({ id: t.id, damage });
  }
  return out;
}
