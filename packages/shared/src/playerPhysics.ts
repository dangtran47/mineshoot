import { AIR_CONTROL, GRAVITY, JUMP_SPEED, MAX_FALL, PLAYER_HALF_W, WALK_SPEED } from './constants';
import { playerAABB } from './aabb';
import { moveAABB } from './collision';
import type { MoveInput, PlayerPhysState, Vec3, World } from './types';

/** Unit look vector from yaw/pitch. yaw 0 looks toward -Z; yaw increases turning left (toward -X). */
export function forwardVector(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

/** Horizontal forward (ignores pitch). */
export function flatForward(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

export function flatRight(yaw: number): { x: number; z: number } {
  return { x: Math.cos(yaw), z: -Math.sin(yaw) };
}

/** Advance one fixed physics step. Pure: returns a new state. */
export function stepPlayer(world: World, s: PlayerPhysState, input: MoveInput, dt: number): PlayerPhysState {
  const f = flatForward(s.yaw);
  const r = flatRight(s.yaw);
  let wx = f.x * input.forward + r.x * input.strafe;
  let wz = f.z * input.forward + r.z * input.strafe;
  const len = Math.hypot(wx, wz);
  if (len > 1) {
    wx /= len;
    wz /= len;
  }

  let vx = s.vx;
  let vz = s.vz;
  let vy = s.vy;

  if (s.onGround) {
    vx = wx * WALK_SPEED;
    vz = wz * WALK_SPEED;
    if (input.jump) vy = JUMP_SPEED;
  } else {
    // Limited air control: blend toward wish velocity.
    vx += (wx * WALK_SPEED - vx) * AIR_CONTROL * dt * 10;
    vz += (wz * WALK_SPEED - vz) * AIR_CONTROL * dt * 10;
  }
  vy -= GRAVITY * dt;
  if (vy < -MAX_FALL) vy = -MAX_FALL;

  const box = playerAABB(s);
  const res = moveAABB(world, box, { x: vx * dt, y: vy * dt, z: vz * dt });
  if (res.hitY) vy = 0;
  if (res.hitX) vx = 0;
  if (res.hitZ) vz = 0;

  return {
    x: res.box.min.x + PLAYER_HALF_W,
    y: res.box.min.y,
    z: res.box.min.z + PLAYER_HALF_W,
    yaw: s.yaw,
    pitch: s.pitch,
    vx,
    vy,
    vz,
    onGround: res.onGround,
  };
}

export function createPhysState(x: number, y: number, z: number, yaw = 0): PlayerPhysState {
  return { x, y, z, yaw, pitch: 0, vx: 0, vy: 0, vz: 0, onGround: false };
}
