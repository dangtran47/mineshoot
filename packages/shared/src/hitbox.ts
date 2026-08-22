import { CROUCH_HEIGHT, GUN_DAMAGE, HEAD_HALF_W, LEGS_TOP, PLAYER_HALF_W, PLAYER_HEIGHT, TORSO_TOP } from './constants';
import type { AABB, Vec3 } from './types';

export type HitPart = keyof typeof GUN_DAMAGE;

export interface Hitbox {
  part: HitPart;
  box: AABB;
}

const band = (feet: Vec3, halfW: number, y0: number, y1: number): AABB => ({
  min: { x: feet.x - halfW, y: feet.y + y0, z: feet.z - halfW },
  max: { x: feet.x + halfW, y: feet.y + y1, z: feet.z + halfW },
});

/**
 * Body-part boxes from the feet position, ordered legs → torso → head. World-axis
 * aligned (like the physics box in aabb.ts, which stays the movement collider).
 * Crouching scales every band edge by CROUCH_HEIGHT / PLAYER_HEIGHT — the same
 * uniform squash the client applies to the humanoid, so shots agree with what
 * the shooter sees.
 */
export function playerHitboxes(feet: Vec3, crouch = false): Hitbox[] {
  const s = crouch ? CROUCH_HEIGHT / PLAYER_HEIGHT : 1;
  return [
    { part: 'legs', box: band(feet, PLAYER_HALF_W, 0, LEGS_TOP * s) },
    { part: 'torso', box: band(feet, PLAYER_HALF_W, LEGS_TOP * s, TORSO_TOP * s) },
    { part: 'head', box: band(feet, HEAD_HALF_W, TORSO_TOP * s, PLAYER_HEIGHT * s) },
  ];
}

export function damageForPart(part: HitPart): number {
  return GUN_DAMAGE[part];
}
