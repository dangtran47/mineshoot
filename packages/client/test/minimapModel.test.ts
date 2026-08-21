import { describe, expect, it } from 'vitest';
import { Block, EYE_HEIGHT, createWorld, flatForward, setBlock } from '@mineshoot/shared';
import type { World } from '@mineshoot/shared';
import {
  hasLineOfSight,
  terrainColor,
  updateFlagPin,
  visibleIds,
  worldToMap,
  yawToMapAngle,
} from '../src/game/minimapModel';

const flatWorld = (): World => {
  const w = createWorld(32, 16, 32);
  for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) setBlock(w, x, 0, z, Block.Stone);
  return w;
};

/** A full-height wall across the map at x = 10. */
const walled = (): World => {
  const w = flatWorld();
  for (let y = 1; y < 8; y++) for (let z = 0; z < 32; z++) setBlock(w, 10, y, z, Block.Brick);
  return w;
};

const eye = (x: number, z: number, y = 1): { x: number; y: number; z: number } => ({ x, y: y + EYE_HEIGHT, z });

describe('hasLineOfSight', () => {
  it('sees across an open floor', () => {
    expect(hasLineOfSight(flatWorld(), eye(4.5, 4.5), eye(20.5, 4.5))).toBe(true);
  });

  it('is blocked by a wall between the two points', () => {
    expect(hasLineOfSight(walled(), eye(4.5, 4.5), eye(20.5, 4.5))).toBe(false);
  });

  it('still sees a point on the same side of the wall', () => {
    expect(hasLineOfSight(walled(), eye(4.5, 4.5), eye(8.5, 12.5))).toBe(true);
  });

  it('treats a zero-length segment as visible', () => {
    expect(hasLineOfSight(walled(), eye(4.5, 4.5), eye(4.5, 4.5))).toBe(true);
  });
});

describe('visibleIds', () => {
  const enemy = { id: 'e1', pos: { x: 20.5, y: 1, z: 4.5 } };

  it('reveals an enemy a teammate can see even when I cannot', () => {
    const w = walled();
    const me = { x: 4.5, y: 1, z: 4.5 };
    const mate = { x: 20.5, y: 1, z: 12.5 }; // past the wall, open line to the enemy
    expect(visibleIds(w, [me], [enemy]).has('e1')).toBe(false);
    expect(visibleIds(w, [me, mate], [enemy]).has('e1')).toBe(true);
  });

  it('hides an enemy nobody can see', () => {
    const w = walled();
    const observers = [{ x: 4.5, y: 1, z: 4.5 }, { x: 2.5, y: 1, z: 20.5 }];
    expect(visibleIds(w, observers, [enemy]).size).toBe(0);
  });

  it('returns an empty set with no observers', () => {
    expect(visibleIds(flatWorld(), [], [enemy]).size).toBe(0);
  });

  it('works with a single observer (deathmatch shape)', () => {
    expect(visibleIds(flatWorld(), [{ x: 4.5, y: 1, z: 4.5 }], [enemy]).has('e1')).toBe(true);
  });
});

describe('updateFlagPin', () => {
  const base = { x: 8, z: 24 };

  it('pins a flag at home to the base and marks it live', () => {
    expect(updateFlagPin(null, { status: 'home', x: 8, y: 1, z: 24 }, base, false)).toEqual({ x: 8, z: 24, visible: true });
  });

  it('keeps the base pin dimmed when the flag is stolen out of sight', () => {
    const home = updateFlagPin(null, { status: 'home', x: 8, y: 1, z: 24 }, base, false);
    const stolen = updateFlagPin(home, { status: 'carried', x: 30, y: 2, z: 30 }, base, false);
    expect(stolen).toEqual({ x: 8, z: 24, visible: false });
  });

  it('moves the pin to the live spot when seen', () => {
    const seen = updateFlagPin({ x: 8, z: 24, visible: false }, { status: 'dropped', x: 30, y: 2, z: 30 }, base, true);
    expect(seen).toEqual({ x: 30, z: 30, visible: true });
  });

  it('leaves the pin at the last-seen spot once vision is lost', () => {
    const lost = updateFlagPin({ x: 30, z: 30, visible: true }, { status: 'carried', x: 44, y: 2, z: 12 }, base, false);
    expect(lost).toEqual({ x: 30, z: 30, visible: false });
  });

  it('resets to the base when the flag returns home', () => {
    const back = updateFlagPin({ x: 30, z: 30, visible: false }, { status: 'home', x: 8, y: 1, z: 24 }, base, false);
    expect(back).toEqual({ x: 8, z: 24, visible: true });
  });
});

describe('worldToMap', () => {
  it('maps the corners and centre of the square arena', () => {
    expect(worldToMap(64, 64, 128, 128, 0, 0)).toEqual({ px: 0, py: 0 });
    expect(worldToMap(64, 64, 128, 128, 64, 64)).toEqual({ px: 128, py: 128 });
    expect(worldToMap(64, 64, 128, 128, 32, 32)).toEqual({ px: 64, py: 64 });
  });

  it('keeps the non-square CTF map in proportion', () => {
    expect(worldToMap(96, 48, 192, 96, 96, 48)).toEqual({ px: 192, py: 96 });
    expect(worldToMap(96, 48, 192, 96, 48, 24)).toEqual({ px: 96, py: 48 });
    // 2 px per block on both axes
    expect(worldToMap(96, 48, 192, 96, 10, 10)).toEqual({ px: 20, py: 20 });
  });
});

describe('yawToMapAngle', () => {
  it('points the up-facing arrow along the player forward vector', () => {
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 3, 2.4]) {
      const a = yawToMapAngle(yaw);
      // Canvas rotate(a) sends the marker's up vector (0,-1) to (sin a, -cos a),
      // which must match the forward direction on the map (fwd.x, fwd.z).
      const fwd = flatForward(yaw);
      expect(Math.sin(a)).toBeCloseTo(fwd.x, 10);
      expect(-Math.cos(a)).toBeCloseTo(fwd.z, 10);
    }
  });
});

describe('terrainColor', () => {
  it('separates block kinds', () => {
    expect(terrainColor(Block.Grass, 8, 24)).not.toBe(terrainColor(Block.Stone, 8, 24));
  });

  it('brightens with height', () => {
    const lum = (c: string): number => c.match(/\d+/g)!.slice(0, 3).reduce((s, n) => s + Number(n), 0);
    expect(lum(terrainColor(Block.Stone, 16, 24))).toBeGreaterThan(lum(terrainColor(Block.Stone, 4, 24)));
  });

  it('renders an empty column as the void colour', () => {
    expect(terrainColor(Block.Air, -1, 24)).toBe(terrainColor(Block.Air, 20, 24));
  });
});
