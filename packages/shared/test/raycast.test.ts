import { describe, expect, it } from 'vitest';
import { raycastVoxels, segmentVsAABB } from '../src/raycast';
import { Block } from '../src/types';
import { createWorld, setBlock } from '../src/world';

describe('raycastVoxels', () => {
  const w = createWorld(16, 16, 16);
  setBlock(w, 10, 5, 5, Block.Stone);

  it('hits the block with the right normal and distance', () => {
    const r = raycastVoxels(w, { x: 2.5, y: 5.5, z: 5.5 }, { x: 1, y: 0, z: 0 }, 20);
    expect(r.hit).toBe(true);
    if (r.hit) {
      expect([r.bx, r.by, r.bz]).toEqual([10, 5, 5]);
      expect(r.normal).toEqual({ x: -1, y: 0, z: 0 });
      expect(r.t).toBeCloseTo(7.5, 5);
    }
  });
  it('misses when the ray points elsewhere or is too short', () => {
    expect(raycastVoxels(w, { x: 2.5, y: 5.5, z: 5.5 }, { x: 0, y: 1, z: 0 }, 20).hit).toBe(false);
    expect(raycastVoxels(w, { x: 2.5, y: 5.5, z: 5.5 }, { x: 1, y: 0, z: 0 }, 5).hit).toBe(false);
  });
  it('works in negative directions and diagonals', () => {
    const r = raycastVoxels(w, { x: 14.5, y: 5.5, z: 5.5 }, { x: -1, y: 0, z: 0 }, 20);
    expect(r.hit && r.bx === 10 && r.normal.x === 1).toBe(true);
    const d = raycastVoxels(w, { x: 8.5, y: 3.5, z: 3.5 }, { x: 2, y: 2, z: 2 }, 5);
    expect(d.hit && d.bx === 10 && d.by === 5 && d.bz === 5).toBe(true);
  });
  it('reports t=0 when starting inside a solid', () => {
    const r = raycastVoxels(w, { x: 10.5, y: 5.5, z: 5.5 }, { x: 1, y: 0, z: 0 }, 20);
    expect(r.hit && r.t === 0).toBe(true);
  });
  it('hits the world border (out of bounds is solid)', () => {
    const r = raycastVoxels(w, { x: 2.5, y: 5.5, z: 8.5 }, { x: -1, y: 0, z: 0 }, 20);
    expect(r.hit && r.bx === -1).toBe(true);
  });
});

describe('segmentVsAABB', () => {
  const box = { min: { x: 4, y: 0, z: 4 }, max: { x: 5, y: 2, z: 5 } };
  it('returns entry t for a hit', () => {
    const t = segmentVsAABB({ x: 0, y: 1, z: 4.5 }, { x: 10, y: 1, z: 4.5 }, box);
    expect(t).toBeCloseTo(0.4, 6);
  });
  it('returns null for a miss', () => {
    expect(segmentVsAABB({ x: 0, y: 5, z: 4.5 }, { x: 10, y: 5, z: 4.5 }, box)).toBeNull();
    expect(segmentVsAABB({ x: 0, y: 1, z: 4.5 }, { x: 3, y: 1, z: 4.5 }, box)).toBeNull();
  });
  it('returns 0 when starting inside', () => {
    expect(segmentVsAABB({ x: 4.5, y: 1, z: 4.5 }, { x: 10, y: 1, z: 4.5 }, box)).toBe(0);
  });
});
