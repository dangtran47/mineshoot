import { PLAYER_HEIGHT, SWORD_HALF_ANGLE_COS, SWORD_RANGE } from './constants';
import { eyePosition } from './gun';
import { forwardVector } from './playerPhysics';
import { raycastVoxels } from './raycast';
import type { PlayerPose, World } from './types';
import type { ShotTarget } from './gun';

/**
 * Ids of every target within SWORD_RANGE of the attacker's eye, inside the
 * forward cone, and with an unobstructed line to the target's chest.
 */
export function swordVictims(world: World, attacker: PlayerPose, targets: ShotTarget[]): string[] {
  const eye = eyePosition(attacker);
  const dir = forwardVector(attacker.yaw, attacker.pitch);
  const out: string[] = [];
  for (const target of targets) {
    const chest = { x: target.pose.x, y: target.pose.y + PLAYER_HEIGHT * 0.6, z: target.pose.z };
    const dx = chest.x - eye.x;
    const dy = chest.y - eye.y;
    const dz = chest.z - eye.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > SWORD_RANGE) continue;
    if (dist > 1e-6) {
      const cos = (dx * dir.x + dy * dir.y + dz * dir.z) / dist;
      if (cos < SWORD_HALF_ANGLE_COS) continue;
      const los = raycastVoxels(world, eye, { x: dx / dist, y: dy / dist, z: dz / dist }, dist);
      if (los.hit) continue;
    }
    out.push(target.id);
  }
  return out;
}
