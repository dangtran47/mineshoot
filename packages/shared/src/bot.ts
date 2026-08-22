import { CROUCH_HEIGHT, EYE_HEIGHT, GUN_RANGE, PLAYER_HEIGHT, SWORD_RANGE, WALK_SPEED } from './constants';
import { DEFAULT_BOT_SKILL, DEFAULT_WEAPON_MODE, WEAPON_MELEE, WEAPON_PISTOL, WEAPON_PRIMARY, weaponAllowed } from './protocol';
import { GUN_NONE, GUN_PISTOL, gunSpec } from './guns';
import type { GunKind } from './guns';
import type { BotSkill, Weapon, WeaponMode } from './protocol';
import { cellCentre, findPath, nearestStandable } from './nav';
import type { NavCell } from './nav';
import { flatForward, flatRight } from './playerPhysics';
import { raycastVoxels } from './raycast';
import type { MoveInput, PlayerPhysState, SpawnPoint, Vec3, World } from './types';

/** Where a bot aims: 60 % of the target's height, so it tracks a crouching player down instead of shooting where the head used to be. */
const chestHeight = (crouch?: boolean): number => (crouch ? CROUCH_HEIGHT : PLAYER_HEIGHT) * 0.6;

/** What the bot can see this tick. */
export interface BotView {
  self: PlayerPhysState;
  /** Other alive players (never includes the bot itself, nor teammates in CTF). */
  enemies: { id: string; x: number; y: number; z: number; crouch?: boolean }[];
  now: number;
  /** CTF: where to head when nothing else is going on (a flag, the base); null/absent = wander. */
  goal?: Vec3 | null;
  /** CTF: carrying a flag — run for the goal, melee only. */
  carrying?: boolean;
  /** Primary gun held (slot 1); GUN_NONE / absent = empty, the bot uses the pistol. */
  gun?: GunKind;
  /** Pistol slot filled (absent = true); false = blade-only until a gun is lifted (td spawns). */
  pistol?: boolean;
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

/** The knobs a skill level (protocol.ts BotSkill) turns. */
export interface BotSkillProfile {
  /** How far (blocks) the bot notices enemies. */
  sightRange: number;
  /** rad/s the bot can turn its aim. */
  turnRate: number;
  /** Delay between spotting a target and the first attack. */
  reactionMs: number;
  /** Fires once the aim is within this many rad of the (jittered) target. */
  aimTolerance: number;
  /** rad of aim jitter per block of distance (re-rolled every rethink). */
  aimErrorPerBlock: number;
  /** Minimum gap between two attacks (shots or swings) on top of the weapon's own cooldown. */
  attackIntervalMs: number;
}
const SKILL_PROFILES: Record<BotSkill, BotSkillProfile> = {
  easy: { sightRange: GUN_RANGE * 0.5, turnRate: 3, reactionMs: 900, aimTolerance: 0.08, aimErrorPerBlock: 0.02, attackIntervalMs: 700 },
  normal: { sightRange: GUN_RANGE * 0.65, turnRate: 4, reactionMs: 600, aimTolerance: 0.06, aimErrorPerBlock: 0.01, attackIntervalMs: 350 },
  hard: { sightRange: GUN_RANGE * 0.75, turnRate: 4.5, reactionMs: 450, aimTolerance: 0.06, aimErrorPerBlock: 0.004, attackIntervalMs: 0 },
};
export function botSkillProfile(skill: BotSkill): BotSkillProfile {
  return SKILL_PROFILES[skill];
}

// Tuning (skill-independent)
const PREFERRED_MIN = 5;
const PREFERRED_MAX = 9;
const RETHINK_MIN_MS = 800;
const RETHINK_MAX_MS = 2000;
const STUCK_SPEED = WALK_SPEED * 0.35;
const WAYPOINT_REACHED = 1.5;
/** Within this distance of the CTF goal the bot patrols nearby waypoints instead of standing still. */
const GOAL_REACHED = 1.5;
/** Patrol waypoints this close to the goal once there. */
const GOAL_PATROL_RADIUS = 14;
/** Once at the goal, keep patrolling until this far from it (hysteresis: no flip-flopping at the GOAL_REACHED edge). */
const GOAL_LEAVE = GOAL_PATROL_RADIUS + 3;
/** Re-plan the route this often even if the destination hasn't moved (world doesn't change, but we may have been knocked off it). */
const REPATH_MS = 1500;
/** Re-plan when the destination has moved this far since the last plan (chasing an enemy). */
const REPATH_DEST_MOVED = 2;
/** A path cell counts as reached within this horizontal distance of its centre. */
const CELL_REACHED = 0.55;
/** Jump for a step up once this close to the higher cell. */
const JUMP_AT = 1.2;
/** Beyond this distance from the next cell we are off the route; re-plan. */
const OFF_ROUTE = 3;

export interface Bot {
  compute(world: World, view: BotView, dt: number): BotDecision;
  /** Forget target/waypoint (call on respawn). */
  reset(): void;
}

export interface BotOptions {
  /** Room weapon rules; the bot only ever picks an allowed weapon. */
  weapons?: WeaponMode;
  /** Training dummy: stands where it spawned, turns to face the nearest visible enemy, never attacks. */
  passive?: boolean;
  /** Difficulty (default 'normal'). */
  skill?: BotSkill;
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
 * spawn points. In CTF (view.goal set) it walks to the goal instead of
 * wandering, patrols around it once there, and as a flag carrier runs for the
 * goal with the melee weapon out, only swinging at enemies within reach.
 * Pure w.r.t. the world; all randomness comes from `rng`.
 */
export function createBot(rng: () => number, waypoints: SpawnPoint[], options: BotOptions = {}): Bot {
  const mode = options.weapons ?? DEFAULT_WEAPON_MODE;
  const gunOk = weaponAllowed(mode, WEAPON_PISTOL);
  const swordOk = weaponAllowed(mode, WEAPON_MELEE);
  const passive = options.passive === true;
  const skill = botSkillProfile(options.skill ?? DEFAULT_BOT_SKILL);
  let targetId: string | null = null;
  let acquiredAt = 0;
  let lastAttackAt = -Infinity;
  let waypoint: SpawnPoint | null = null;
  /** CTF: the goal we've reached and are patrolling around (null = still travelling). */
  let atGoal: Vec3 | null = null;
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

  /** At the goal (with hysteresis) — a new goal or straying GOAL_LEAVE away resets it. */
  const goalReached = (goal: Vec3, self: PlayerPhysState): boolean => {
    const d = Math.hypot(goal.x - self.x, goal.z - self.z);
    if (atGoal && Math.hypot(atGoal.x - goal.x, atGoal.z - goal.z) > REPATH_DEST_MOVED) atGoal = null;
    if (atGoal && d > GOAL_LEAVE) atGoal = null;
    if (!atGoal && d <= GOAL_REACHED) atGoal = { x: goal.x, y: goal.y, z: goal.z };
    return atGoal !== null;
  };

  const pickWaypoint = (self: PlayerPhysState, near: Vec3 | null): SpawnPoint | null => {
    let pool = waypoints;
    if (near) {
      const byDist = [...waypoints].sort((a, b) => Math.hypot(a.x - near.x, a.z - near.z) - Math.hypot(b.x - near.x, b.z - near.z));
      const close = byDist.filter((w) => Math.hypot(w.x - near.x, w.z - near.z) <= GOAL_PATROL_RADIUS);
      // Patrol the waypoints around the goal (at least the goal and the nearest few).
      pool = [near, ...(close.length >= 2 ? close : byDist.slice(0, 3))];
    }
    if (pool.length === 0) return null;
    // Prefer waypoints that aren't right next to us.
    for (let tries = 0; tries < 6; tries++) {
      const w = pool[Math.floor(rng() * pool.length)];
      if (Math.hypot(w.x - self.x, w.z - self.z) > 6) return w;
    }
    return pool[Math.floor(rng() * pool.length)];
  };
  // Route following: the current path (cell centres), the index of the cell we're heading for,
  // and where/when it was planned.
  let path: NavCell[] | null = null;
  let pathIdx = 0;
  let pathDest: Vec3 | null = null;
  let pathAt = -Infinity;

  const dropPath = (): void => {
    path = null;
    pathIdx = 0;
    pathDest = null;
  };

  /** (Re)plan a route to `to` when needed; returns whether a usable path exists. */
  const plan = (world: World, self: PlayerPhysState, to: Vec3, now: number): boolean => {
    const moved = pathDest ? Math.hypot(pathDest.x - to.x, pathDest.z - to.z) : Infinity;
    const stale = now - pathAt >= REPATH_MS;
    if (path && moved < REPATH_DEST_MOVED && !stale && pathIdx < path.length) {
      const c = cellCentre(path[pathIdx]);
      if (Math.hypot(c.x - self.x, c.z - self.z) <= OFF_ROUTE) return true;
    }
    pathAt = now;
    pathDest = { x: to.x, y: to.y, z: to.z };
    const from = nearestStandable(world, self.x, self.y, self.z);
    const dest = nearestStandable(world, to.x, to.y, to.z);
    path = from && dest ? findPath(world, from, dest) : null;
    pathIdx = path && path.length > 1 ? 1 : 0;
    return path !== null;
  };

  /** Push `input` in world direction (dx, dz) regardless of where we look. */
  const moveDir = (dx: number, dz: number, input: MoveInput): void => {
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return;
    const f = flatForward(yaw);
    const r = flatRight(yaw);
    input.forward = (dx * f.x + dz * f.z) / len;
    input.strafe = (dx * r.x + dz * r.z) / len;
  };

  /**
   * Move toward `to` along a planned route (jumping up steps); falls back to a
   * straight line when there is no route. `face` = also turn to look the way
   * we're going (wandering); a bot with an enemy keeps its aim and only moves.
   * Returns false when no route exists (we still push straight at it).
   */
  const navigate = (world: World, self: PlayerPhysState, to: Vec3, input: MoveInput, dt: number, now: number, face: boolean): boolean => {
    let tx = to.x;
    let tz = to.z;
    let stepUp = false;
    const routed = plan(world, self, to, now) && path !== null;
    if (routed && path) {
      // Advance past cells we've reached; the last cell is the destination itself.
      while (pathIdx < path.length - 1) {
        const c = cellCentre(path[pathIdx]);
        if (Math.hypot(c.x - self.x, c.z - self.z) > CELL_REACHED || Math.abs(c.y - self.y) > 1.2) break;
        pathIdx++;
      }
      const next = cellCentre(path[Math.min(pathIdx, path.length - 1)]);
      tx = next.x;
      tz = next.z;
      stepUp = next.y > self.y + 0.5 && Math.hypot(tx - self.x, tz - self.z) < JUMP_AT;
    }
    const dx = tx - self.x;
    const dz = tz - self.z;
    if (face) turnToward(Math.atan2(-dx, -dz), 0, dt);
    moveDir(dx, dz, input);
    if (stepUp && self.onGround) input.jump = true;
    return routed;
  };

  const turnToward = (targetYaw: number, targetPitch: number, dt: number): void => {
    const maxStep = skill.turnRate * dt;
    const dy = wrapAngle(targetYaw - yaw);
    yaw = wrapAngle(yaw + Math.max(-maxStep, Math.min(maxStep, dy)));
    const dp = targetPitch - pitch;
    pitch += Math.max(-maxStep, Math.min(maxStep, dp));
  };

  return {
    reset() {
      targetId = null;
      waypoint = null;
      atGoal = null;
      initialised = false;
      dropPath();
    },
    compute(world, view, dt) {
      const { self, enemies, now } = view;
      const goal = view.goal ?? null;
      const carrying = view.carrying === true;
      const gunKind: GunKind = view.gun || GUN_PISTOL;
      const gunSlot: Weapon = gunKind === GUN_PISTOL ? WEAPON_PISTOL : WEAPON_PRIMARY;
      const gun = gunSpec(gunKind);
      // Whether any gun is actually in hand: a primary, or the pistol slot when it is filled.
      const hasGun = gunOk && (!!view.gun || view.pistol !== false);
      // Short guns (shotgun, taser) want to be close; long ones keep the usual band.
      const shortGun = gun.range < PREFERRED_MAX * 2;
      const preferredMax = shortGun ? gun.range * 0.8 : PREFERRED_MAX;
      const preferredMin = shortGun ? 0 : PREFERRED_MIN;
      if (!initialised) {
        yaw = self.yaw;
        pitch = self.pitch;
        initialised = true;
      }
      if (now >= nextRethinkAt) rethink(now);

      const eye = { x: self.x, y: self.y + EYE_HEIGHT, z: self.z };
      // Acquire: nearest enemy with line of sight.
      let best: { id: string; x: number; y: number; z: number; crouch?: boolean; d: number } | null = null;
      for (const e of enemies) {
        const chest = { x: e.x, y: e.y + chestHeight(e.crouch), z: e.z };
        const dx = chest.x - eye.x;
        const dy = chest.y - eye.y;
        const dz = chest.z - eye.z;
        const d = Math.hypot(dx, dy, dz);
        if (d > skill.sightRange || (best && d >= best.d)) continue;
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
      let weapon: Weapon = hasGun ? gunSlot : WEAPON_MELEE;
      let shoot = false;
      let swing = false;

      if (passive) {
        // Dummy: just watch whoever is closest.
        if (best) {
          const dx = best.x - eye.x;
          const dz = best.z - eye.z;
          turnToward(Math.atan2(-dx, -dz), 0, dt);
        }
        return { input, yaw, pitch, weapon, shoot, swing };
      }

      if (carrying) {
        // Flag carrier: no shooting, melee out; run for the goal, but cut down anyone within reach.
        weapon = swordOk ? WEAPON_MELEE : gunSlot;
        if (best && swordOk && best.d <= SWORD_RANGE * 0.9) {
          const dx = best.x - eye.x;
          const dz = best.z - eye.z;
          turnToward(Math.atan2(-dx, -dz), 0, dt);
          input.forward = 1;
          swing = now - acquiredAt >= skill.reactionMs;
        } else if (goal) {
          navigate(world, self, goal, input, dt, now, true);
        }
      } else if (best) {
        const chest = { x: best.x, y: best.y + chestHeight(best.crouch), z: best.z };
        const dx = chest.x - eye.x;
        const dy = chest.y - eye.y;
        const dz = chest.z - eye.z;
        const horiz = Math.hypot(dx, dz);
        const err = best.d * skill.aimErrorPerBlock;
        const wantYaw = Math.atan2(-dx, -dz) + aimErrYaw * err;
        const wantPitch = Math.atan2(dy, horiz) + aimErrPitch * err;
        turnToward(wantYaw, wantPitch, dt);

        // Position: with a gun, close in / back off to the preferred band and strafe a bit;
        // sword-only, charge straight in. Closing in follows a route (the enemy may be
        // up on the plateau); the rest is relative to where we're aiming.
        const closeIn = !hasGun || best.d > preferredMax || (swordOk && best.d <= SWORD_RANGE * 0.9);
        if (closeIn) navigate(world, self, best, input, dt, now, false);
        else if (best.d < preferredMin && best.d > SWORD_RANGE) input.forward = -0.6;
        if (!closeIn) input.strafe = strafeDir * 0.8;

        const aligned = Math.abs(wrapAngle(wantYaw - yaw)) < skill.aimTolerance && Math.abs(wantPitch - pitch) < skill.aimTolerance;
        const reacted = now - acquiredAt >= skill.reactionMs;
        if (swordOk && best.d <= SWORD_RANGE * 0.9) {
          weapon = WEAPON_MELEE;
          swing = reacted;
        } else if (hasGun) {
          shoot = aligned && reacted && best.d <= gun.range;
        }
      } else if (goal && !goalReached(goal, self)) {
        // CTF: head for the goal.
        waypoint = null;
        navigate(world, self, goal, input, dt, now, true);
      } else {
        // Wander between waypoints (around the goal, if there is one).
        if (!waypoint || Math.hypot(waypoint.x - self.x, waypoint.z - self.z) < WAYPOINT_REACHED) {
          waypoint = pickWaypoint(self, goal);
        }
        // An unroutable waypoint (a perch you can only jump down from) is dropped for another.
        if (waypoint && !navigate(world, self, waypoint, input, dt, now, true)) waypoint = null;
      }

      // Skill-paced trigger finger: never attack faster than the profile allows.
      if ((shoot || swing) && now - lastAttackAt < skill.attackIntervalMs) {
        shoot = false;
        swing = false;
      }
      if (shoot || swing) lastAttackAt = now;

      // Unstick: trying to move but barely progressing on the ground → hop.
      const speed = Math.hypot(self.vx, self.vz);
      if ((input.forward !== 0 || input.strafe !== 0) && self.onGround && speed < STUCK_SPEED) input.jump = true;

      return { input, yaw, pitch, weapon, shoot, swing };
    },
  };
}
