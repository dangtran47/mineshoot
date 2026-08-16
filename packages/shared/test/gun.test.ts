import { describe, expect, it } from 'vitest';
import { GUN_RANGE } from '../src/constants';
import { resolveShot } from '../src/gun';
import { Block } from '../src/types';
import { createWorld, setBlock } from '../src/world';

const w = createWorld(64, 24, 64);
for (let x = 0; x < 64; x++) for (let z = 0; z < 64; z++) setBlock(w, x, 0, z, Block.Stone);
// yaw 0 looks toward -Z
const shooter = { x: 32, y: 1, z: 40, yaw: 0, pitch: 0 };

describe('resolveShot', () => {
  it('hits a player straight ahead', () => {
    const r = resolveShot(w, shooter, [{ id: 'a', pose: { x: 32, y: 1, z: 30 } }], GUN_RANGE);
    expect(r.hitPlayerId).toBe('a');
    expect(r.to.z).toBeCloseTo(30.3, 3);
  });
  it('misses a player behind or to the side', () => {
    expect(resolveShot(w, shooter, [{ id: 'a', pose: { x: 32, y: 1, z: 50 } }], GUN_RANGE).hitPlayerId).toBeNull();
    expect(resolveShot(w, shooter, [{ id: 'a', pose: { x: 34, y: 1, z: 30 } }], GUN_RANGE).hitPlayerId).toBeNull();
  });
  it('is blocked by a wall', () => {
    const w2 = createWorld(64, 24, 64);
    for (let y = 1; y < 5; y++) for (let x = 30; x < 35; x++) setBlock(w2, x, y, 35, Block.Brick);
    const r = resolveShot(w2, shooter, [{ id: 'a', pose: { x: 32, y: 1, z: 30 } }], GUN_RANGE);
    expect(r.hitPlayerId).toBeNull();
    expect(r.to.z).toBeCloseTo(36, 3);
  });
  it('picks the nearest of two players', () => {
    const r = resolveShot(
      w,
      shooter,
      [
        { id: 'far', pose: { x: 32, y: 1, z: 20 } },
        { id: 'near', pose: { x: 32, y: 1, z: 30 } },
      ],
      GUN_RANGE,
    );
    expect(r.hitPlayerId).toBe('near');
  });
  it('respects range', () => {
    const r = resolveShot(w, shooter, [{ id: 'a', pose: { x: 32, y: 1, z: 30 } }], 5);
    expect(r.hitPlayerId).toBeNull();
    expect(r.to.z).toBeCloseTo(35, 3);
  });
  it('aims with pitch', () => {
    const up = { ...shooter, pitch: Math.PI / 4 };
    expect(resolveShot(w, up, [{ id: 'a', pose: { x: 32, y: 1, z: 30 } }], GUN_RANGE).hitPlayerId).toBeNull();
  });
});
