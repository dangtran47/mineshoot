import { describe, expect, it } from 'vitest';
import { EYE_HEIGHT, GUN_RANGE, HEAD_HALF_W } from '../src/constants';
import { resolveShot } from '../src/gun';
import { Block } from '../src/types';
import { createWorld, setBlock } from '../src/world';

const w = createWorld(64, 24, 64);
for (let x = 0; x < 64; x++) for (let z = 0; z < 64; z++) setBlock(w, x, 0, z, Block.Stone);
// yaw 0 looks toward -Z
const shooter = { x: 32, y: 1, z: 40, yaw: 0, pitch: 0 };
const target = { id: 'a', pose: { x: 32, y: 1, z: 30 } };
/** Pitch that lands the ray at `height` above the target's feet at its front face (z = 30.3). */
const pitchFor = (height: number): number => Math.atan2(height - EYE_HEIGHT, 40 - 30.3);

describe('resolveShot', () => {
  it('hits a player straight ahead (level shot lands on the head)', () => {
    const r = resolveShot(w, shooter, [target], GUN_RANGE);
    expect(r.hitPlayerId).toBe('a');
    expect(r.part).toBe('head');
    expect(r.damage).toBe(100);
    expect(r.to.z).toBeCloseTo(30 + HEAD_HALF_W, 3); // tracer stops at the head's front face
  });
  it('hits the torso when aiming at chest height', () => {
    const r = resolveShot(w, { ...shooter, pitch: pitchFor(1.0) }, [target], GUN_RANGE);
    expect(r.hitPlayerId).toBe('a');
    expect(r.part).toBe('torso');
    expect(r.damage).toBe(30);
  });
  it('hits the legs when aiming low', () => {
    const r = resolveShot(w, { ...shooter, pitch: pitchFor(0.4) }, [target], GUN_RANGE);
    expect(r.hitPlayerId).toBe('a');
    expect(r.part).toBe('legs');
    expect(r.damage).toBe(15);
  });
  it('head box is narrower than the body: a shot past the ear misses, same offset hits the torso', () => {
    const offset = { ...shooter, x: 32.27 };
    expect(resolveShot(w, offset, [target], GUN_RANGE).hitPlayerId).toBeNull();
    const low = resolveShot(w, { ...offset, pitch: pitchFor(1.0) }, [target], GUN_RANGE);
    expect(low.hitPlayerId).toBe('a');
    expect(low.part).toBe('torso');
  });
  it('misses a player behind or to the side', () => {
    const miss = resolveShot(w, shooter, [{ id: 'a', pose: { x: 32, y: 1, z: 50 } }], GUN_RANGE);
    expect(miss.hitPlayerId).toBeNull();
    expect(miss.part).toBeNull();
    expect(miss.damage).toBe(0);
    expect(resolveShot(w, shooter, [{ id: 'a', pose: { x: 34, y: 1, z: 30 } }], GUN_RANGE).hitPlayerId).toBeNull();
  });
  it('is blocked by a wall', () => {
    const w2 = createWorld(64, 24, 64);
    for (let y = 1; y < 5; y++) for (let x = 30; x < 35; x++) setBlock(w2, x, y, 35, Block.Brick);
    const r = resolveShot(w2, shooter, [target], GUN_RANGE);
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
    const r = resolveShot(w, shooter, [target], 5);
    expect(r.hitPlayerId).toBeNull();
    expect(r.to.z).toBeCloseTo(35, 3);
  });
  it('aims with pitch', () => {
    const up = { ...shooter, pitch: Math.PI / 4 };
    expect(resolveShot(w, up, [target], GUN_RANGE).hitPlayerId).toBeNull();
  });
});
