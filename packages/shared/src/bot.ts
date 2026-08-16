import { EYE_HEIGHT, GUN_RANGE, PLAYER_HEIGHT, SWORD_RANGE, WALK_SPEED } from './constants';
import { DEFAULT_WEAPON_MODE, WEAPON_GUN, WEAPON_SWORD, weaponAllowed } from './protocol';
import type { Weapon, WeaponMode } from './protocol';
import { raycastVoxels } from './raycast';
import type { MoveInput, PlayerPhysState, SpawnPoint, World } from './types';

/** What the bot can see this tick. */
export interface BotView {
  self: PlayerPhysState;
  /** Other alive players (never includes the bot itself). */
  enemies: { id: string; x: number; y: number; z: number }[];
  now: number;
}

/** What the bot wants to do this tick; the server applies it like client input. */
export interface BotDecision {
  input: MoveInput;
  yaw: number;
  pitch: number;
  weapon: Weapon;
  shoot: boolean;
  swing: boolean;
}

// Tuning
const SIGHT_RANGE = GUN_RANGE * 0.75;
const TURN_RATE = 4.5; // rad/s
const REACTION_MS = 450;
const AIM_TOLERANCE = 0.06; // rad — fire when within this
const AIM_ERROR_PER_BLOCK = 0.004; // rad of jitter per block of distance
const PREFERRED_MIN = 5;
const PREFERRED_MAX = 9;
const RETHINK_MIN_MS = 800;
const RETHINK_MAX_MS = 2000;
const STUCK_SPEED = WALK_SPEED * 0.35;
const WAYPOINT_REACHED = 1.5;

export interface Bot {
  compute(world: World, view: BotView, dt: number): BotDecision;
  /** Forget target/waypoint (call on respawn). */
  reset(): void;
}

export interface BotOptions {
  /** Room weapon rules; the bot only ever picks an allowed weapon. */
  weapons?: WeaponMode;
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Simple deterministic (given rng) FPS bot: hunts the nearest visible enemy,
 * keeps a mid-range distance, strafes, jumps when stuck, and fires once its
 * (imperfect, reaction-delayed) aim settles. Falls back to wandering between
 * spawn points. Pure w.r.t. the world; all randomness comes from `rng`.
 */
export function createBot(rng: () => number, waypoints: SpawnPoint[], options: BotOptions = {}): Bot {
  const mode = options.weapons ?? DEFAULT_WEAPON_MODE;
  const gunOk = weaponAllowed(mode, WEAPON_GUN);
  const swordOk = weaponAllowed(mode, WEAPON_SWORD);
  let targetId: string | null = null;
  let acquiredAt = 0;
  let waypoint: SpawnPoint | null = null;
  let strafeDir = 0;
  let nextRethinkAt = 0;
  let aimErrYaw = 0;
  let aimErrPitch = 0;
  let yaw = 0;
  let pitch = 0;
  let initialised = false;

  const rethink = (now: number): void => {
    strafeDir = rng() < 0.4 ? 0 : rng() < 0.5 ? -1 : 1;
    aimErrYaw = (rng() - 0.5) * 2;
    aimErrPitch = (rng() - 0.5) * 2;
    nextRethinkAt = now + RETHINK_MIN_MS + rng() * (RETHINK_MAX_MS - RETHINK_MIN_MS);
  };

  const pickWaypoint = (self: PlayerPhysState): SpawnPoint | null => {
    if (waypoints.length === 0) return null;
    // Prefer waypoints that aren't right next to us.
    for (let tries = 0; tries < 6; tries++) {
      const w = waypoints[Math.floor(rng() * waypoints.length)];
      if (Math.hypot(w.x - self.x, w.z - self.z) > 6) return w;
    }
    return waypoints[Math.floor(rng() * waypoints.length)];
  };

  const turnToward = (targetYaw: number, targetPitch: number, dt: number): void => {
    const maxStep = TURN_RATE * dt;
    const dy = wrapAngle(targetYaw - yaw);
    yaw = wrapAngle(yaw + Math.max(-maxStep, Math.min(maxStep, dy)));
    const dp = targetPitch - pitch;
    pitch += Math.max(-maxStep, Math.min(maxStep, dp));
  };

  return {
    reset() {
      targetId = null;
      waypoint = null;
      initialised = false;
    },
    compute(world, view, dt) {
      const { self, enemies, now } = view;
      if (!initialised) {
        yaw = self.yaw;
        pitch = self.pitch;
        initialised = true;
      }
      if (now >= nextRethinkAt) rethink(now);

      const eye = { x: self.x, y: self.y + EYE_HEIGHT, z: self.z };
      // Acquire: nearest enemy with line of sight.
      let best: { id: string; x: number; y: number; z: number; d: number } | null = null;
      for (const e of enemies) {
        const chest = { x: e.x, y: e.y + PLAYER_HEIGHT * 0.6, z: e.z };
        const dx = chest.x - eye.x;
        const dy = chest.y - eye.y;
        const dz = chest.z - eye.z;
        const d = Math.hypot(dx, dy, dz);
        if (d > SIGHT_RANGE || (best && d >= best.d)) continue;
        if (d > 1e-3) {
          const los = raycastVoxels(world, eye, { x: dx / d, y: dy / d, z: dz / d }, d);
          if (los.hit) continue;
        }
        best = { ...e, d };
      }
      if (best && best.id !== targetId) {
        targetId = best.id;
        acquiredAt = now;
      }
      if (!best) targetId = null;

      const input: MoveInput = { forward: 0, strafe: 0, jump: false };
      let weapon: Weapon = gunOk ? WEAPON_GUN : WEAPON_SWORD;
      let shoot = false;
      let swing = false;

      if (best) {
        const chest = { x: best.x, y: best.y + PLAYER_HEIGHT * 0.6, z: best.z };
        const dx = chest.x - eye.x;
        const dy = chest.y - eye.y;
        const dz = chest.z - eye.z;
        const horiz = Math.hypot(dx, dz);
        const err = best.d * AIM_ERROR_PER_BLOCK;
        const wantYaw = Math.atan2(-dx, -dz) + aimErrYaw * err;
        const wantPitch = Math.atan2(dy, horiz) + aimErrPitch * err;
        turnToward(wantYaw, wantPitch, dt);

        // Position: with a gun, close in / back off to the preferred band and strafe a bit;
        // sword-only, charge straight in.
        if (!gunOk || best.d > PREFERRED_MAX) input.forward = 1;
        else if (best.d < PREFERRED_MIN && best.d > SWORD_RANGE) input.forward = -0.6;
        input.strafe = strafeDir * 0.8;

        const aligned = Math.abs(wrapAngle(wantYaw - yaw)) < AIM_TOLERANCE && Math.abs(wantPitch - pitch) < AIM_TOLERANCE;
        const reacted = now - acquiredAt >= REACTION_MS;
        if (swordOk && best.d <= SWORD_RANGE * 0.9) {
          weapon = WEAPON_SWORD;
          input.forward = 1;
          swing = reacted;
        } else if (gunOk) {
          shoot = aligned && reacted;
        }
      } else {
        // Wander between waypoints.
        if (!waypoint || Math.hypot(waypoint.x - self.x, waypoint.z - self.z) < WAYPOINT_REACHED) {
          waypoint = pickWaypoint(self);
        }
        if (waypoint) {
          const dx = waypoint.x - self.x;
          const dz = waypoint.z - self.z;
          turnToward(Math.atan2(-dx, -dz), 0, dt);
          input.forward = 1;
        }
      }

      // Unstick: moving forward but barely progressing on the ground → hop.
      const speed = Math.hypot(self.vx, self.vz);
      if (input.forward !== 0 && self.onGround && speed < STUCK_SPEED) input.jump = true;

      return { input, yaw, pitch, weapon, shoot, swing };
    },
  };
}
