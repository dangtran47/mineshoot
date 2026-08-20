import { PLAYER_HALF_W, PLAYER_HEIGHT, raycastVoxels, segmentVsAABB } from '@mineshoot/shared';
import type { Vec3, World } from '@mineshoot/shared';

/** Aim forgiveness around the body box, so the tag appears without pixel-perfect aim. */
const AIM_PAD = 0.25;
/** Longer than either map's diagonal; the segment end for the aim test. */
const MAX_RANGE = 160;

/**
 * True when the crosshair ray from `eye` along the unit direction `dir` rests on
 * the player standing at `feet`, with no block in between — names must not leak
 * the position of someone hiding behind a wall.
 */
export function nametagVisible(world: World, eye: Vec3, dir: Vec3, feet: Vec3): boolean {
  const end = { x: eye.x + dir.x * MAX_RANGE, y: eye.y + dir.y * MAX_RANGE, z: eye.z + dir.z * MAX_RANGE };
  const half = PLAYER_HALF_W + AIM_PAD;
  const box = {
    min: { x: feet.x - half, y: feet.y - AIM_PAD, z: feet.z - half },
    max: { x: feet.x + half, y: feet.y + PLAYER_HEIGHT + AIM_PAD, z: feet.z + half },
  };
  const t = segmentVsAABB(eye, end, box);
  if (t === null) return false;
  return !raycastVoxels(world, eye, dir, t * MAX_RANGE).hit;
}
