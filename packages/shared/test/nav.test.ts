import { describe, expect, it } from 'vitest';
import { findPath, nearestStandable } from '../src/nav';
import { Block } from '../src/types';
import { createWorld, setBlock } from '../src/world';
import { generateWorld, PLATEAU_MIN, PLATEAU_MAX } from '../src/worldgen';

function flat(sx = 32, sz = 32): ReturnType<typeof createWorld> {
  const w = createWorld(sx, 24, sz);
  for (let x = 0; x < sx; x++) for (let z = 0; z < sz; z++) setBlock(w, x, 0, z, Block.Stone);
  return w;
}
const fill = (w: ReturnType<typeof createWorld>, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void => {
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) setBlock(w, x, y, z, Block.Brick);
};

describe('nav', () => {
  it('nearestStandable snaps a feet position onto the standable level of its column', () => {
    const w = flat();
    expect(nearestStandable(w, 5.5, 1, 5.5)).toEqual({ x: 5, y: 1, z: 5 });
    expect(nearestStandable(w, 5.5, 1.7, 5.5)).toEqual({ x: 5, y: 1, z: 5 }); // mid-jump
    fill(w, 5, 5, 1, 12, 5, 5);
    expect(nearestStandable(w, 5.5, 1, 5.5)).toBeNull(); // pillar column: no room within reach
  });

  it('walks straight across open ground', () => {
    const w = flat();
    const path = findPath(w, { x: 2, y: 1, z: 2 }, { x: 12, y: 1, z: 2 });
    expect(path).not.toBeNull();
    expect(path!.length).toBe(11);
    expect(path![0]).toEqual({ x: 2, y: 1, z: 2 });
    expect(path![path!.length - 1]).toEqual({ x: 12, y: 1, z: 2 });
  });

  it('cuts diagonals but never through a corner', () => {
    const w = flat();
    const open = findPath(w, { x: 2, y: 1, z: 2 }, { x: 8, y: 1, z: 8 })!;
    expect(open.length).toBe(7); // pure diagonal
    // An L-shaped wall with only the corner cell missing must not be squeezed through diagonally.
    fill(w, 5, 5, 1, 2, 0, 4); // wall along z 0..4 at x=5
    fill(w, 6, 12, 1, 2, 5, 5); // wall along x 6..12 at z=5
    const around = findPath(w, { x: 4, y: 1, z: 4 }, { x: 6, y: 1, z: 6 })!;
    for (let i = 1; i < around.length; i++) {
      const a = around[i - 1];
      const b = around[i];
      if (a.x !== b.x && a.z !== b.z) {
        // diagonal step: both orthogonal neighbours must be free
        expect(w.blocks[(1 * w.sz + a.z) * w.sx + b.x]).toBe(Block.Air);
        expect(w.blocks[(1 * w.sz + b.z) * w.sx + a.x]).toBe(Block.Air);
      }
    }
  });

  it('cannot cross a two-block wall but goes around it', () => {
    const w = flat();
    fill(w, 10, 10, 1, 2, 0, 20); // wall across, gap at z >= 21
    const path = findPath(w, { x: 5, y: 1, z: 5 }, { x: 15, y: 1, z: 5 })!;
    expect(path).not.toBeNull();
    expect(path.some((p) => p.x === 10 && p.z >= 21)).toBe(true);
  });

  it('steps up one block (a jump) but not two, and drops down', () => {
    const w = flat();
    fill(w, 10, 20, 1, 1, 0, 31); // one-block-high slab across the whole width
    const up = findPath(w, { x: 5, y: 1, z: 5 }, { x: 15, y: 2, z: 5 })!;
    expect(up).not.toBeNull();
    expect(up[up.length - 1].y).toBe(2);
    fill(w, 10, 20, 2, 2, 0, 31); // now two high
    expect(findPath(w, { x: 5, y: 1, z: 5 }, { x: 15, y: 3, z: 5 })).toBeNull();
    // Dropping off the slab is fine.
    expect(findPath(w, { x: 15, y: 3, z: 5 }, { x: 5, y: 1, z: 5 })).not.toBeNull();
  });

  it('returns null for an unreachable target and for a start with no footing', () => {
    const w = flat();
    fill(w, 10, 10, 1, 3, 0, 31);
    expect(findPath(w, { x: 5, y: 1, z: 5 }, { x: 15, y: 1, z: 5 })).toBeNull();
    expect(findPath(w, { x: 5, y: 5, z: 5 }, { x: 8, y: 1, z: 5 })).toBeNull();
  });

  it('climbs the generated arena plateau via a ramp', () => {
    const { world, spawnPoints } = generateWorld(7);
    const cx = Math.floor((PLATEAU_MIN + PLATEAU_MAX) / 2);
    const top = { x: cx, y: 10, z: cx }; // plateau top is 9 → feet at 10
    let onGround = 0;
    for (const s of spawnPoints) {
      const inside = s.x >= PLATEAU_MIN && s.x <= PLATEAU_MAX + 1 && s.z >= PLATEAU_MIN && s.z <= PLATEAU_MAX + 1;
      if (inside) continue;
      onGround++;
      const from = nearestStandable(world, s.x, s.y, s.z)!;
      const path = findPath(world, from, top);
      expect(path, `spawn ${s.x},${s.z}`).not.toBeNull();
      // Every step climbs at most one block.
      for (let i = 1; i < path!.length; i++) expect(path![i].y - path![i - 1].y).toBeLessThanOrEqual(1);
    }
    expect(onGround).toBeGreaterThan(3);
  });
});
