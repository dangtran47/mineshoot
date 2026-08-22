import { describe, expect, it } from 'vitest';
import { Block, createWorld, setBlock } from '@mineshoot/shared';
import type { World } from '@mineshoot/shared';
import { BULLET_HOLE_TTL_MS, BulletHoles, bulletHoleAt } from '../src/render/bulletHoles';

/** Stone floor at y = 0 and a full-height wall across x = 10. */
const walled = (): World => {
  const w = createWorld(32, 16, 32);
  for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) setBlock(w, x, 0, z, Block.Stone);
  for (let y = 1; y < 8; y++) for (let z = 0; z < 32; z++) setBlock(w, 10, y, z, Block.Brick);
  return w;
};

describe('bulletHoleAt', () => {
  it('finds the wall face a shot ended on', () => {
    const hole = bulletHoleAt(walled(), { x: 5, y: 2.5, z: 5 }, { x: 10, y: 2.5, z: 5 });
    expect(hole).not.toBeNull();
    expect(hole!.point.x).toBeCloseTo(10, 3);
    expect(hole!.point.y).toBeCloseTo(2.5, 3);
    expect(hole!.normal).toEqual({ x: -1, y: 0, z: 0 });
  });

  it('finds the floor face for a downward shot', () => {
    const hole = bulletHoleAt(walled(), { x: 5, y: 3, z: 5 }, { x: 5, y: 1, z: 5 });
    expect(hole).not.toBeNull();
    expect(hole!.point.y).toBeCloseTo(1, 3);
    expect(hole!.normal).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('ignores a ray that stopped short of the wall (a body took it)', () => {
    expect(bulletHoleAt(walled(), { x: 5, y: 2.5, z: 5 }, { x: 8, y: 2.5, z: 5 })).toBeNull();
  });

  it('ignores a shot that flew its full range without hitting anything', () => {
    expect(bulletHoleAt(walled(), { x: 5, y: 2.5, z: 5 }, { x: 5, y: 42.5, z: 5 })).toBeNull();
  });

  it('ignores a degenerate ray', () => {
    expect(bulletHoleAt(walled(), { x: 5, y: 2.5, z: 5 }, { x: 5, y: 2.5, z: 5 })).toBeNull();
  });

  it('never marks the sky past the map edge (out of bounds is solid but unmeshed)', () => {
    // Straight out of the world sideways: the boundary "block" stops bullets but is never drawn.
    expect(bulletHoleAt(walled(), { x: 5, y: 2.5, z: 5 }, { x: -20, y: 2.5, z: 5 })).toBeNull();
    expect(bulletHoleAt(walled(), { x: 5, y: 2.5, z: 5 }, { x: 5, y: 2.5, z: 52 })).toBeNull();
  });

  it('ignores an origin already inside a block (no face to stick to)', () => {
    expect(bulletHoleAt(walled(), { x: 10.5, y: 2.5, z: 5 }, { x: 12, y: 2.5, z: 5 })).toBeNull();
  });
});

describe('BulletHoles', () => {
  const normal = { x: -1, y: 0, z: 0 };

  it('draws one instance per hole', () => {
    const holes = new BulletHoles();
    expect(holes.mesh.count).toBe(0);
    holes.spawn({ x: 10, y: 2, z: 5 }, normal, 0);
    holes.spawn({ x: 10, y: 3, z: 5 }, normal, 0);
    holes.update(0);
    expect(holes.mesh.count).toBe(2);
    holes.dispose();
  });

  it('caps the pool, evicting the oldest holes', () => {
    const holes = new BulletHoles();
    for (let i = 0; i < 400; i++) holes.spawn({ x: 10, y: 2, z: i * 0.01 }, normal, i);
    holes.update(0);
    expect(holes.mesh.count).toBeLessThanOrEqual(256);
    expect(holes.mesh.count).toBe(256);
    holes.dispose();
  });

  it('expires holes after their lifetime', () => {
    const holes = new BulletHoles();
    holes.spawn({ x: 10, y: 2, z: 5 }, normal, 0);
    holes.update(BULLET_HOLE_TTL_MS - 1);
    expect(holes.mesh.count).toBe(1);
    holes.update(BULLET_HOLE_TTL_MS);
    expect(holes.mesh.count).toBe(0);
    holes.dispose();
  });
});
