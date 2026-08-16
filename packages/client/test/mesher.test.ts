import { describe, expect, it } from 'vitest';
import { Block, createWorld, setBlock } from '@mineshoot/shared';
import { ATLAS_TILES, meshRegion, tileFor } from '../src/render/mesher';

describe('meshRegion', () => {
  it('emits 6 faces for a lone block, 10 for two adjacent', () => {
    const w = createWorld(8, 8, 8);
    setBlock(w, 3, 3, 3, Block.Stone);
    let m = meshRegion(w, 0, 8, 0, 8);
    expect(m.faceCount).toBe(6);
    expect(m.positions.length).toBe(6 * 4 * 3);
    expect(m.indices.length).toBe(6 * 6);
    setBlock(w, 4, 3, 3, Block.Stone);
    m = meshRegion(w, 0, 8, 0, 8);
    expect(m.faceCount).toBe(10);
  });
  it('culls faces against the world border (sides solid) but not the top', () => {
    const w = createWorld(4, 4, 4);
    setBlock(w, 0, 0, 0, Block.Stone); // corner: -X, -Y, -Z neighbours are out of bounds (solid)
    const m = meshRegion(w, 0, 4, 0, 4);
    expect(m.faceCount).toBe(3);
    const w2 = createWorld(4, 4, 4);
    setBlock(w2, 1, 3, 1, Block.Stone); // top layer: +Y neighbour out of bounds is air
    expect(meshRegion(w2, 0, 4, 0, 4).faceCount).toBe(6);
  });
  it('uses distinct atlas tiles per block/face', () => {
    expect(tileFor(Block.Grass, 2)).not.toBe(tileFor(Block.Grass, 0));
    expect(tileFor(Block.Grass, 3)).toBe(tileFor(Block.Dirt, 3));
    const w = createWorld(4, 4, 4);
    setBlock(w, 1, 1, 1, Block.Brick);
    const m = meshRegion(w, 0, 4, 0, 4);
    const tile = tileFor(Block.Brick, 0);
    for (let i = 0; i < m.uvs.length; i += 2) {
      expect(m.uvs[i]).toBeGreaterThan(tile / ATLAS_TILES);
      expect(m.uvs[i]).toBeLessThan((tile + 1) / ATLAS_TILES);
    }
  });
  it('winds triangles outward (normal of first triangle points along the face)', () => {
    const w = createWorld(4, 4, 4);
    setBlock(w, 1, 1, 1, Block.Stone);
    const m = meshRegion(w, 0, 4, 0, 4);
    const p = m.positions;
    for (let f = 0; f < m.faceCount; f++) {
      const i0 = m.indices[f * 6] * 3;
      const i1 = m.indices[f * 6 + 1] * 3;
      const i2 = m.indices[f * 6 + 2] * 3;
      const ax = p[i1] - p[i0], ay = p[i1 + 1] - p[i0 + 1], az = p[i1 + 2] - p[i0 + 2];
      const bx = p[i2] - p[i0], by = p[i2 + 1] - p[i0 + 1], bz = p[i2 + 2] - p[i0 + 2];
      const n = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
      // face centre minus block centre should align with n
      const cx = (p[i0] + p[i1] + p[i2]) / 3 - 1.5;
      const cy = (p[i0 + 1] + p[i1 + 1] + p[i2 + 1]) / 3 - 1.5;
      const cz = (p[i0 + 2] + p[i1 + 2] + p[i2 + 2]) / 3 - 1.5;
      expect(n[0] * cx + n[1] * cy + n[2] * cz).toBeGreaterThan(0);
    }
  });
});
