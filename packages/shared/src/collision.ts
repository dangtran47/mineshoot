import { isSolid } from './world';
import type { AABB, World } from './types';

export interface MoveResult {
  box: AABB;
  onGround: boolean;
  hitX: boolean;
  hitY: boolean;
  hitZ: boolean;
}

const EPS = 1e-4;

/** Does the box overlap any solid voxel? */
export function boxCollides(world: World, box: AABB): boolean {
  const x0 = Math.floor(box.min.x);
  const x1 = Math.floor(box.max.x - EPS);
  const y0 = Math.floor(box.min.y);
  const y1 = Math.floor(box.max.y - EPS);
  const z0 = Math.floor(box.min.z);
  const z1 = Math.floor(box.max.z - EPS);
  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) if (isSolid(world, x, y, z)) return true;
  return false;
}

/**
 * Sweep an AABB through the voxel world by `delta`, resolving each axis in
 * turn (Y, then X, then Z — Minecraft order) so the box slides along walls
 * and never tunnels: each axis is stepped in sub-steps no larger than a
 * block so thin walls are always sampled.
 */
export function moveAABB(world: World, start: AABB, delta: { x: number; y: number; z: number }): MoveResult {
  const box: AABB = {
    min: { ...start.min },
    max: { ...start.max },
  };
  let onGround = false;
  let hitX = false;
  let hitY = false;
  let hitZ = false;

  const sweep = (axis: 'x' | 'y' | 'z', amount: number): boolean => {
    if (amount === 0) return false;
    const dir = Math.sign(amount);
    let remaining = Math.abs(amount);
    while (remaining > 0) {
      const step = Math.min(remaining, 0.5);
      remaining -= step;
      const move = step * dir;
      box.min[axis] += move;
      box.max[axis] += move;
      if (boxCollides(world, box)) {
        // Snap to the face of the blocking voxel.
        if (dir > 0) {
          const face = Math.floor(box.max[axis] - EPS);
          const size = box.max[axis] - box.min[axis];
          box.max[axis] = face - EPS;
          box.min[axis] = box.max[axis] - size;
        } else {
          const face = Math.floor(box.min[axis]) + 1;
          const size = box.max[axis] - box.min[axis];
          box.min[axis] = face + EPS;
          box.max[axis] = box.min[axis] + size;
        }
        return true;
      }
    }
    return false;
  };

  hitY = sweep('y', delta.y);
  if (hitY && delta.y < 0) onGround = true;
  hitX = sweep('x', delta.x);
  hitZ = sweep('z', delta.z);

  // Grounded check when not moving down: is there solid right below?
  if (!onGround && delta.y <= 0) {
    const probe: AABB = {
      min: { x: box.min.x, y: box.min.y - 0.02, z: box.min.z },
      max: { x: box.max.x, y: box.min.y, z: box.max.z },
    };
    if (boxCollides(world, probe)) onGround = true;
  }

  return { box, onGround, hitX, hitY, hitZ };
}
