import { describe, expect, it } from 'vitest';
import { WORLD_SX, WORLD_SY, WORLD_SZ } from '../src/constants';
import { Block } from '../src/types';
import type { World } from '../src/types';
import { columnTop, getBlock, hashWorld, isSolid } from '../src/world';
import { PLATEAU_MAX, PLATEAU_MIN, generateWorld, isStandable } from '../src/worldgen';

/** Feet height of a player standing on column (x, z), or -1 if it is not standable. */
function feetY(world: World, x: number, z: number): number {
  const y = columnTop(world, x, z) + 1;
  return isStandable(world, x, y, z) ? y : -1;
}

/**
 * Which sides of the central plateau (n/s/e/w) can be climbed onto from the
 * spawn points, walking and jumping at most one block up per step.
 */
function climbableSides(world: World, spawns: { x: number; z: number }[]): Set<string> {
  const onPlateau = (x: number, z: number): boolean =>
    x >= PLATEAU_MIN && x <= PLATEAU_MAX && z >= PLATEAU_MIN && z <= PLATEAU_MAX;
  const key = (x: number, z: number): number => x * 1024 + z;
  const seen = new Set<number>();
  const queue: [number, number][] = [];
  const sides = new Set<string>();
  for (const s of spawns) {
    const x = Math.floor(s.x);
    const z = Math.floor(s.z);
    seen.add(key(x, z));
    queue.push([x, z]);
  }
  while (queue.length > 0) {
    const [x, z] = queue.shift()!;
    const y = feetY(world, x, z);
    if (y < 0) continue;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 1 || nz < 1 || nx >= world.sx - 1 || nz >= world.sz - 1) continue;
      const ny = feetY(world, nx, nz);
      if (ny < 0 || ny - y > 1) continue;
      if (onPlateau(nx, nz)) {
        // Entered the plateau: record which side we came in from, don't expand across it.
        if (!onPlateau(x, z)) sides.add(dx === 1 ? 'w' : dx === -1 ? 'e' : dz === 1 ? 'n' : 's');
        continue;
      }
      const k = key(nx, nz);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push([nx, nz]);
    }
  }
  return sides;
}

describe('generateWorld', () => {
  it('is deterministic per seed', () => {
    const a = generateWorld(1234);
    const b = generateWorld(1234);
    expect(hashWorld(a.world)).toBe(hashWorld(b.world));
    expect(a.spawnPoints).toEqual(b.spawnPoints);
    expect(hashWorld(generateWorld(999).world)).not.toBe(hashWorld(a.world));
  });

  it('has the expected dimensions and a bedrock floor + border', () => {
    const { world } = generateWorld(7);
    expect(world.sx).toBe(WORLD_SX);
    expect(world.sy).toBe(WORLD_SY);
    expect(world.sz).toBe(WORLD_SZ);
    for (let x = 0; x < world.sx; x++)
      for (let z = 0; z < world.sz; z++) expect(getBlock(world, x, 0, z)).toBe(Block.Bedrock);
    for (let y = 0; y < 6; y++) {
      expect(getBlock(world, 0, y, 10)).not.toBe(Block.Air);
      expect(getBlock(world, world.sx - 1, y, 10)).not.toBe(Block.Air);
      expect(getBlock(world, 10, y, 0)).not.toBe(Block.Air);
      expect(getBlock(world, 10, y, world.sz - 1)).not.toBe(Block.Air);
    }
  });

  it('keeps headroom near the top of the world', () => {
    const { world } = generateWorld(7);
    for (let x = 0; x < world.sx; x++)
      for (let z = 0; z < world.sz; z++) expect(getBlock(world, x, world.sy - 1, z)).toBe(Block.Air);
  });

  it('produces enough well-spread, standable spawn points', () => {
    for (const seed of [1, 2, 3, 12345]) {
      const { world, spawnPoints } = generateWorld(seed);
      expect(spawnPoints.length).toBeGreaterThanOrEqual(8);
      for (const s of spawnPoints) {
        expect(isStandable(world, Math.floor(s.x), s.y, Math.floor(s.z))).toBe(true);
      }
      for (let i = 0; i < spawnPoints.length; i++)
        for (let j = i + 1; j < spawnPoints.length; j++) {
          const a = spawnPoints[i];
          const b = spawnPoints[j];
          expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(8);
        }
    }
  });

  it('lets players climb onto the central plateau from at least two sides in every seed', () => {
    for (let seed = 0; seed < 300; seed++) {
      const { world, spawnPoints } = generateWorld(seed);
      const sides = climbableSides(world, spawnPoints);
      expect(sides.size, `seed ${seed}: sides ${[...sides].join(',')}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('treats out-of-bounds as solid on the sides/below and air above', () => {
    const { world } = generateWorld(1);
    expect(isSolid(world, -1, 5, 5)).toBe(true);
    expect(isSolid(world, 5, -1, 5)).toBe(true);
    expect(isSolid(world, 5, 5, world.sz)).toBe(true);
    expect(isSolid(world, 5, world.sy, 5)).toBe(false);
  });
});
