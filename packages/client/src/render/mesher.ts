import { Block, getBlock } from '@mineshoot/shared';
import type { World } from '@mineshoot/shared';

/** Atlas layout: ATLAS_TILES square tiles in one row. */
export const ATLAS_TILES = 8;
export const TILE_PX = 16;

export const enum Tile {
  GrassTop = 0,
  GrassSide = 1,
  Dirt = 2,
  Stone = 3,
  Planks = 4,
  Brick = 5,
  Bedrock = 6,
  Leaves = 7,
}

/** 0:+X 1:-X 2:+Y 3:-Y 4:+Z 5:-Z */
export type Face = 0 | 1 | 2 | 3 | 4 | 5;

export function tileFor(block: Block, face: Face): Tile {
  switch (block) {
    case Block.Grass:
      return face === 2 ? Tile.GrassTop : face === 3 ? Tile.Dirt : Tile.GrassSide;
    case Block.Dirt:
      return Tile.Dirt;
    case Block.Stone:
      return Tile.Stone;
    case Block.Planks:
      return Tile.Planks;
    case Block.Brick:
      return Tile.Brick;
    case Block.Bedrock:
      return Tile.Bedrock;
    case Block.Leaves:
      return Tile.Leaves;
    default:
      return Tile.Stone;
  }
}

/** Per-face brightness (baked into vertex colours; the world material is unlit). */
export const FACE_SHADE: readonly number[] = [0.8, 0.8, 1.0, 0.5, 0.65, 0.65];

const FACE_DIRS: readonly [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

// Corner offsets per face, CCW as seen from outside, with (h, v) tex coords.
const FACE_CORNERS: readonly (readonly [number, number, number, number, number][])[] = [
  [
    [1, 0, 0, 0, 0],
    [1, 1, 0, 0, 1],
    [1, 1, 1, 1, 1],
    [1, 0, 1, 1, 0],
  ],
  [
    [0, 0, 0, 0, 0],
    [0, 0, 1, 1, 0],
    [0, 1, 1, 1, 1],
    [0, 1, 0, 0, 1],
  ],
  [
    [0, 1, 0, 0, 0],
    [0, 1, 1, 0, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 0, 1, 0],
  ],
  [
    [0, 0, 0, 0, 0],
    [1, 0, 0, 1, 0],
    [1, 0, 1, 1, 1],
    [0, 0, 1, 0, 1],
  ],
  [
    [0, 0, 1, 0, 0],
    [1, 0, 1, 1, 0],
    [1, 1, 1, 1, 1],
    [0, 1, 1, 0, 1],
  ],
  [
    [0, 0, 0, 0, 0],
    [0, 1, 0, 0, 1],
    [1, 1, 0, 1, 1],
    [1, 0, 0, 1, 0],
  ],
];

export interface ChunkMesh {
  positions: Float32Array;
  uvs: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  faceCount: number;
}

/**
 * Naive face-culled mesh for the block range [x0,x1) × [0,sy) × [z0,z1).
 * Pure: no three.js. UVs are inset by half a texel to avoid atlas bleeding.
 */
export function meshRegion(world: World, x0: number, x1: number, z0: number, z1: number): ChunkMesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let faceCount = 0;
  const tileW = 1 / ATLAS_TILES;
  const inset = 0.5 / (ATLAS_TILES * TILE_PX);
  const insetV = 0.5 / TILE_PX;

  for (let y = 0; y < world.sy; y++) {
    for (let z = z0; z < z1; z++) {
      for (let x = x0; x < x1; x++) {
        const b = getBlock(world, x, y, z);
        if (b === Block.Air) continue;
        for (let f = 0; f < 6; f++) {
          const d = FACE_DIRS[f];
          if (getBlock(world, x + d[0], y + d[1], z + d[2]) !== Block.Air) continue;
          const tile = tileFor(b, f as Face);
          const u0 = tile * tileW + inset;
          const u1 = (tile + 1) * tileW - inset;
          const v0 = insetV;
          const v1 = 1 - insetV;
          const shade = FACE_SHADE[f];
          const base = positions.length / 3;
          for (const c of FACE_CORNERS[f]) {
            positions.push(x + c[0], y + c[1], z + c[2]);
            uvs.push(c[3] ? u1 : u0, c[4] ? v1 : v0);
            colors.push(shade, shade, shade);
          }
          indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
          faceCount++;
        }
      }
    }
  }
  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
    faceCount,
  };
}
