import { isSolid } from './world';
import type { AABB, Vec3, VoxelHit, World } from './types';

/**
 * Amanatides–Woo voxel traversal. `dir` need not be normalised; `t` is
 * expressed in units of |dir| (so with a unit dir, t is distance).
 */
export function raycastVoxels(world: World, origin: Vec3, dir: Vec3, maxT: number): VoxelHit {
  let bx = Math.floor(origin.x);
  let by = Math.floor(origin.y);
  let bz = Math.floor(origin.z);

  if (isSolid(world, bx, by, bz)) {
    return { hit: true, bx, by, bz, point: { ...origin }, normal: { x: 0, y: 0, z: 0 }, t: 0 };
  }

  const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
  const stepY = dir.y > 0 ? 1 : dir.y < 0 ? -1 : 0;
  const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;

  const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;

  let tMaxX = stepX > 0 ? (bx + 1 - origin.x) / dir.x : stepX < 0 ? (bx - origin.x) / dir.x : Infinity;
  let tMaxY = stepY > 0 ? (by + 1 - origin.y) / dir.y : stepY < 0 ? (by - origin.y) / dir.y : Infinity;
  let tMaxZ = stepZ > 0 ? (bz + 1 - origin.z) / dir.z : stepZ < 0 ? (bz - origin.z) / dir.z : Infinity;

  let t = 0;
  // Bounded loop: cannot cross more voxels than the ray length allows.
  for (let i = 0; i < 4096; i++) {
    let normal: Vec3;
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      t = tMaxX;
      bx += stepX;
      tMaxX += tDeltaX;
      normal = { x: -stepX, y: 0, z: 0 };
    } else if (tMaxY < tMaxZ) {
      t = tMaxY;
      by += stepY;
      tMaxY += tDeltaY;
      normal = { x: 0, y: -stepY, z: 0 };
    } else {
      t = tMaxZ;
      bz += stepZ;
      tMaxZ += tDeltaZ;
      normal = { x: 0, y: 0, z: -stepZ };
    }
    if (t > maxT) return { hit: false };
    if (by >= world.sy && stepY >= 0) return { hit: false }; // escaped upward
    if (isSolid(world, bx, by, bz)) {
      return {
        hit: true,
        bx,
        by,
        bz,
        point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t },
        normal,
        t,
      };
    }
  }
  return { hit: false };
}

/**
 * Slab test: parametric t in [0, 1] where segment p0→p1 first enters `box`,
 * or null if it misses. A segment starting inside returns 0.
 */
export function segmentVsAABB(p0: Vec3, p1: Vec3, box: AABB): number | null {
  let tMin = 0;
  let tMax = 1;
  const axes: ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];
  for (const a of axes) {
    const d = p1[a] - p0[a];
    if (Math.abs(d) < 1e-9) {
      if (p0[a] < box.min[a] || p0[a] > box.max[a]) return null;
      continue;
    }
    let t1 = (box.min[a] - p0[a]) / d;
    let t2 = (box.max[a] - p0[a]) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }
  return tMin;
}
