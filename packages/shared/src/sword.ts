import { PLAYER_HEIGHT } from './constants';
import { eyePosition } from './gun';
import { playerHitboxes } from './hitbox';
import { ATTACK_LIGHT, MELEE_SWORD, attackSpec } from './melee';
import type { AttackKind, MeleeKind } from './melee';
import { flatForward, forwardVector } from './playerPhysics';
import { raycastVoxels, segmentVsAABB } from './raycast';
import type { PlayerPose, Vec3, World } from './types';
import type { ShotTarget } from './gun';

/** Where a melee swing lands: the head box, or anywhere else on the body. */
export type SwordPart = 'head' | 'body';

export interface SwordHit {
  id: string;
  part: SwordPart;
}

/** Damage of `attack` with `kind` (default: the plain sword) by part. */
export function swordDamage(part: SwordPart, attack: AttackKind = ATTACK_LIGHT, kind: MeleeKind = MELEE_SWORD): number {
  return attackSpec(kind, attack).damage[part];
}

const cosDeg = (deg: number): number => Math.cos((deg * Math.PI) / 180);

/**
 * Targets within the attack's range of the attacker's eye, inside its forward
 * cone (measured in the horizontal plane, so looking up/down at a close target
 * never misses), and with an unobstructed
 * line to the target's chest. A sweeping attack hits everyone in the cone,
 * otherwise only the nearest target. A hit lands on the head only when the
 * attacker's aim ray goes through the head box; any other cone hit counts as
 * body.
 */
export function swordVictims(
  world: World,
  attacker: PlayerPose,
  targets: ShotTarget[],
  attack: AttackKind = ATTACK_LIGHT,
  kind: MeleeKind = MELEE_SWORD,
): SwordHit[] {
  const spec = attackSpec(kind, attack);
  const range = spec.range;
  const eye = eyePosition(attacker);
  const dir = forwardVector(attacker.yaw, attacker.pitch);
  const flat = flatForward(attacker.yaw);
  const reach: Vec3 = { x: eye.x + dir.x * range, y: eye.y + dir.y * range, z: eye.z + dir.z * range };
  const minCos = cosDeg(spec.halfAngleDeg);
  const sweep = spec.sweep;
  const out: SwordHit[] = [];
  let nearest: SwordHit | null = null;
  let nearestDist = Infinity;
  for (const target of targets) {
    const chest = { x: target.pose.x, y: target.pose.y + PLAYER_HEIGHT * 0.6, z: target.pose.z };
    const dx = chest.x - eye.x;
    const dy = chest.y - eye.y;
    const dz = chest.z - eye.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > range) continue;
    const horiz = Math.hypot(dx, dz);
    if (horiz > 1e-6 && (dx * flat.x + dz * flat.z) / horiz < minCos) continue;
    if (dist > 1e-6) {
      const los = raycastVoxels(world, eye, { x: dx / dist, y: dy / dist, z: dz / dist }, dist);
      if (los.hit) continue;
    }
    const hit: SwordHit = { id: target.id, part: aimedPart(eye, reach, target.pose) };
    if (sweep) out.push(hit);
    else if (dist < nearestDist) {
      nearestDist = dist;
      nearest = hit;
    }
  }
  return sweep ? out : nearest ? [nearest] : [];
}

/** 'head' if the aim segment first enters the head box, else 'body'. */
function aimedPart(eye: Vec3, reach: Vec3, feet: Vec3): SwordPart {
  let bestT = Infinity;
  let part: SwordPart = 'body';
  for (const hb of playerHitboxes(feet)) {
    const t = segmentVsAABB(eye, reach, hb.box);
    if (t !== null && t < bestT) {
      bestT = t;
      part = hb.part === 'head' ? 'head' : 'body';
    }
  }
  return part;
}
