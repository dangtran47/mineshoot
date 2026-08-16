import { EYE_HEIGHT } from './constants';
import { playerAABB } from './aabb';
import { forwardVector } from './playerPhysics';
import { raycastVoxels, segmentVsAABB } from './raycast';
import type { PlayerPose, Vec3, World } from './types';

export interface ShotTarget {
  id: string;
  pose: { x: number; y: number; z: number };
}

export interface ShotResult {
  from: Vec3;
  to: Vec3;
  hitPlayerId: string | null;
}

export function eyePosition(pose: { x: number; y: number; z: number }): Vec3 {
  return { x: pose.x, y: pose.y + EYE_HEIGHT, z: pose.z };
}

/**
 * Hitscan: ray from the shooter's eye along yaw/pitch, up to `range`.
 * Voxels and player boxes compete; the nearest wins. Returns the tracer
 * endpoint and the id of the hit player (if any).
 */
export function resolveShot(world: World, shooter: PlayerPose, targets: ShotTarget[], range: number): ShotResult {
  const from = eyePosition(shooter);
  const dir = forwardVector(shooter.yaw, shooter.pitch);
  const voxel = raycastVoxels(world, from, dir, range);
  let bestT = voxel.hit ? voxel.t : range;
  const far: Vec3 = { x: from.x + dir.x * range, y: from.y + dir.y * range, z: from.z + dir.z * range };
  let hitPlayerId: string | null = null;
  for (const target of targets) {
    const t01 = segmentVsAABB(from, far, playerAABB(target.pose));
    if (t01 === null) continue;
    const t = t01 * range;
    if (t < bestT) {
      bestT = t;
      hitPlayerId = target.id;
    }
  }
  const to: Vec3 = { x: from.x + dir.x * bestT, y: from.y + dir.y * bestT, z: from.z + dir.z * bestT };
  return { from, to, hitPlayerId };
}
