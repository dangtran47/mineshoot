import { describe, expect, it } from 'vitest';
import { Block, PLAYER_HALF_W, createWorld, setBlock } from '@mineshoot/shared';
import type { World } from '@mineshoot/shared';
import { nametagVisible } from '../src/game/nametagVisibility';

const flatWorld = (): World => {
  const w = createWorld(32, 16, 32);
  for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) setBlock(w, x, 0, z, Block.Stone);
  return w;
};

const eye = { x: 4.5, y: 1 + 1.62, z: 4.5 };
const feet = { x: 14.5, y: 1, z: 4.5 };

describe('nametagVisible', () => {
  it('shows the tag when the crosshair rests on the player', () => {
    expect(nametagVisible(flatWorld(), eye, { x: 1, y: 0, z: 0 }, feet)).toBe(true);
  });

  it('hides the tag when aiming elsewhere', () => {
    expect(nametagVisible(flatWorld(), eye, { x: 0, y: 0, z: 1 }, feet)).toBe(false);
    expect(nametagVisible(flatWorld(), eye, { x: -1, y: 0, z: 0 }, feet)).toBe(false);
  });

  it('forgives a near-miss within the aim padding', () => {
    const offset = { ...feet, z: feet.z + PLAYER_HALF_W + 0.15 };
    expect(nametagVisible(flatWorld(), eye, { x: 1, y: 0, z: 0 }, offset)).toBe(true);
  });

  it('hides the tag when a wall stands between', () => {
    const w = flatWorld();
    for (let y = 1; y < 8; y++) for (let z = 0; z < 32; z++) setBlock(w, 10, y, z, Block.Brick);
    expect(nametagVisible(w, eye, { x: 1, y: 0, z: 0 }, feet)).toBe(false);
  });
});
