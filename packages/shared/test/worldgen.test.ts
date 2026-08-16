import { describe, expect, it } from 'vitest';
import { WORLD_SX, WORLD_SY, WORLD_SZ } from '../src/constants';
import { Block } from '../src/types';
import { getBlock, hashWorld, isSolid } from '../src/world';
import { generateWorld, isStandable } from '../src/worldgen';

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
    for (let y = 0; y < 12; y++) {
      expect(getBlock(world, 0, y, 10)).toBe(Block.Bedrock);
      expect(getBlock(world, world.sx - 1, y, 10)).toBe(Block.Bedrock);
      expect(getBlock(world, 10, y, 0)).toBe(Block.Bedrock);
      expect(getBlock(world, 10, y, world.sz - 1)).toBe(Block.Bedrock);
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

  it('treats out-of-bounds as solid on the sides/below and air above', () => {
    const { world } = generateWorld(1);
    expect(isSolid(world, -1, 5, 5)).toBe(true);
    expect(isSolid(world, 5, -1, 5)).toBe(true);
    expect(isSolid(world, 5, 5, world.sz)).toBe(true);
    expect(isSolid(world, 5, world.sy, 5)).toBe(false);
  });
});
