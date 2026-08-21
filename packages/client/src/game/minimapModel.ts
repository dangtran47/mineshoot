import { Block, EYE_HEIGHT, raycastVoxels } from '@mineshoot/shared';
import type { FlagStatus, Vec3, World } from '@mineshoot/shared';

/**
 * Pure minimap logic: who the map is allowed to reveal, where the enemy flag was
 * last spotted, and how world coordinates land on the canvas. Kept free of DOM and
 * three.js so it can be unit tested (the client vitest environment is 'node').
 *
 * The fog is cosmetic — the server broadcasts every pose to every client, exactly
 * like the nametags — but it keeps the map honest for ordinary play.
 */

/** How often the line-of-sight sweep runs; markers reuse the cached answer between ticks. */
export const VISION_INTERVAL_MS = 150;

/** A player marker on the map, in world x/z. */
export interface MapDot {
  id: string;
  x: number;
  z: number;
  team: number;
}

/** The enemy flag marker: where it was last seen, and whether that is live. */
export interface FlagPin {
  x: number;
  z: number;
  visible: boolean;
}

/** True when nothing solid stands between the two points. */
export function hasLineOfSight(world: World, from: Vec3, to: Vec3): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  const dir = { x: dx / len, y: dy / len, z: dz / len };
  return !raycastVoxels(world, from, dir, len).hit;
}

const eyeOf = (feet: Vec3): Vec3 => ({ x: feet.x, y: feet.y + EYE_HEIGHT, z: feet.z });

const dist2 = (a: Vec3, b: Vec3): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;

/**
 * The union of what every observer can see: a target is revealed when *any* of
 * the observers (me plus my living team-mates) has an unobstructed eye-to-eye
 * line to it. Observers are tried nearest-first and each target short-circuits on
 * the first hit, so the common case costs one ray.
 *
 * `observers` and `targets` are feet positions; eye height is added here.
 */
export function visibleIds(world: World, observers: Vec3[], targets: { id: string; pos: Vec3 }[]): Set<string> {
  const seen = new Set<string>();
  if (observers.length === 0) return seen;
  const eyes = observers.map(eyeOf);
  for (const target of targets) {
    const at = eyeOf(target.pos);
    const order = eyes.length > 1 ? [...eyes].sort((a, b) => dist2(a, at) - dist2(b, at)) : eyes;
    for (const eye of order) {
      if (hasLineOfSight(world, eye, at)) {
        seen.add(target.id);
        break;
      }
    }
  }
  return seen;
}

/**
 * Last-seen tracking for the enemy flag. A flag on its stand is public knowledge
 * (the score bar already announces the status), so it pins to the base and the pin
 * resets there on every return. Once it is carried or dropped the pin only follows
 * the flag while somebody actually sees it, and otherwise stays — dimmed — on the
 * last spot we know of.
 */
export function updateFlagPin(
  prev: FlagPin | null,
  flag: { status: FlagStatus; x: number; y: number; z: number },
  basePos: { x: number; z: number },
  seenNow: boolean,
): FlagPin {
  if (flag.status === 'home') return { x: basePos.x, z: basePos.z, visible: true };
  if (seenNow) return { x: flag.x, z: flag.z, visible: true };
  if (prev) return { x: prev.x, z: prev.z, visible: false };
  return { x: basePos.x, z: basePos.z, visible: false };
}

/** World (x, z) → canvas pixel, for a mapW×mapH map over an sx×sz world. */
export function worldToMap(
  sx: number,
  sz: number,
  mapW: number,
  mapH: number,
  x: number,
  z: number,
): { px: number; py: number } {
  return { px: (x / sx) * mapW, py: (z / sz) * mapH };
}

/**
 * Canvas rotation for the self arrow. The map draws world +x to the right and
 * world +z downwards, and the marker is drawn pointing up, so rotating by -yaw
 * lines it up with `flatForward(yaw)` = (-sin yaw, -cos yaw).
 */
export function yawToMapAngle(yaw: number): number {
  return -yaw;
}

/** Base tint per block kind, before the height shading. */
const BLOCK_RGB: Record<number, [number, number, number]> = {
  [Block.Bedrock]: [64, 64, 70],
  [Block.Stone]: [128, 128, 134],
  [Block.Dirt]: [134, 96, 67],
  [Block.Grass]: [106, 170, 80],
  [Block.Planks]: [162, 130, 78],
  [Block.Brick]: [150, 82, 70],
  [Block.Leaves]: [58, 112, 52],
};

/** Empty columns (and the sky) read as the void, so the map edge stays legible. */
const VOID_RGB = 'rgb(24, 27, 33)';

/** Colour for a map cell: the kind of block on top, shaded by how high it sits. */
export function terrainColor(block: Block, top: number, sy: number): string {
  const base = BLOCK_RGB[block];
  if (!base || top < 0) return VOID_RGB;
  const span = Math.max(1, sy - 1);
  const shade = 0.55 + 0.45 * Math.min(1, Math.max(0, top / span));
  const [r, g, b] = base;
  return `rgb(${Math.round(r * shade)}, ${Math.round(g * shade)}, ${Math.round(b * shade)})`;
}
