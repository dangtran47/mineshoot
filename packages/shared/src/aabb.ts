import { PLAYER_HALF_W, PLAYER_HEIGHT } from './constants';
import type { AABB, Vec3 } from './types';

/** Player box from feet position. */
export function playerAABB(feet: Vec3): AABB {
  return {
    min: { x: feet.x - PLAYER_HALF_W, y: feet.y, z: feet.z - PLAYER_HALF_W },
    max: { x: feet.x + PLAYER_HALF_W, y: feet.y + PLAYER_HEIGHT, z: feet.z + PLAYER_HALF_W },
  };
}

export function aabbOverlaps(a: AABB, b: AABB): boolean {
  return (
    a.min.x < b.max.x &&
    a.max.x > b.min.x &&
    a.min.y < b.max.y &&
    a.max.y > b.min.y &&
    a.min.z < b.max.z &&
    a.max.z > b.min.z
  );
}

export function aabbCenter(a: AABB): Vec3 {
  return {
    x: (a.min.x + a.max.x) / 2,
    y: (a.min.y + a.max.y) / 2,
    z: (a.min.z + a.max.z) / 2,
  };
}
