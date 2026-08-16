import { describe, expect, it } from 'vitest';
import { GRAVITY, JUMP_SPEED } from '../src/constants';
import { moveAABB } from '../src/collision';
import { Block } from '../src/types';
import type { AABB } from '../src/types';
import { createWorld, setBlock } from '../src/world';
import { createPhysState, stepPlayer } from '../src/playerPhysics';

function flatWorld(): ReturnType<typeof createWorld> {
  const w = createWorld(16, 16, 16);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) setBlock(w, x, 0, z, Block.Stone);
  return w;
}
const box = (x: number, y: number, z: number): AABB => ({
  min: { x: x - 0.3, y, z: z - 0.3 },
  max: { x: x + 0.3, y: y + 1.8, z: z + 0.3 },
});

describe('moveAABB', () => {
  it('lands on top of the floor', () => {
    const w = flatWorld();
    const r = moveAABB(w, box(8, 3, 8), { x: 0, y: -5, z: 0 });
    expect(r.hitY).toBe(true);
    expect(r.onGround).toBe(true);
    expect(r.box.min.y).toBeCloseTo(1, 3);
  });
  it('slides along a wall, preserving the other axis', () => {
    const w = flatWorld();
    for (let y = 1; y < 4; y++) setBlock(w, 10, y, 8, Block.Brick);
    const r = moveAABB(w, box(8, 1, 8), { x: 3, y: 0, z: 1 });
    expect(r.hitX).toBe(true);
    expect(r.box.max.x).toBeLessThanOrEqual(10);
    expect(r.box.min.z).toBeCloseTo(9 - 0.3, 3);
  });
  it('does not tunnel through a 1-thick wall at high speed', () => {
    const w = flatWorld();
    for (let y = 1; y < 4; y++) setBlock(w, 10, y, 8, Block.Brick);
    const r = moveAABB(w, box(8, 1, 8), { x: 6, y: 0, z: 0 });
    expect(r.hitX).toBe(true);
    expect(r.box.max.x).toBeLessThanOrEqual(10);
  });
  it('is stopped by a ceiling', () => {
    const w = flatWorld();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) setBlock(w, x, 4, z, Block.Stone);
    const r = moveAABB(w, box(8, 1, 8), { x: 0, y: 5, z: 0 });
    expect(r.hitY).toBe(true);
    expect(r.box.max.y).toBeLessThanOrEqual(4);
  });
  it('reports onGround when resting on a block without moving', () => {
    const w = flatWorld();
    const r = moveAABB(w, box(8, 1.0001, 8), { x: 0, y: 0, z: 0 });
    expect(r.onGround).toBe(true);
  });
});

describe('stepPlayer', () => {
  it('falls and settles on the ground, then can jump to the expected apex', () => {
    const w = flatWorld();
    let s = createPhysState(8, 5, 8);
    const dt = 1 / 60;
    for (let i = 0; i < 240; i++) s = stepPlayer(w, s, { forward: 0, strafe: 0, jump: false }, dt);
    expect(s.onGround).toBe(true);
    expect(s.y).toBeCloseTo(1, 2);
    s = stepPlayer(w, s, { forward: 0, strafe: 0, jump: true }, dt);
    expect(s.vy).toBeGreaterThan(0);
    let apex = s.y;
    for (let i = 0; i < 120; i++) {
      s = stepPlayer(w, s, { forward: 0, strafe: 0, jump: true }, dt);
      apex = Math.max(apex, s.y);
    }
    const expected = 1 + (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY);
    expect(apex).toBeGreaterThan(expected * 0.85);
    expect(apex).toBeLessThan(expected * 1.05);
  });
  it('walks forward along -Z at yaw 0 and cannot exceed walk speed', () => {
    const w = flatWorld();
    let s = createPhysState(8, 1, 8);
    const dt = 1 / 60;
    for (let i = 0; i < 60; i++) s = stepPlayer(w, s, { forward: 1, strafe: 1, jump: false }, dt);
    expect(s.z).toBeLessThan(8);
    expect(s.x).toBeGreaterThan(8);
    expect(Math.hypot(s.vx, s.vz)).toBeLessThanOrEqual(5.5 + 1e-6);
  });
});
