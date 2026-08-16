import { Block } from './types';
import type { World } from './types';

export function createWorld(sx: number, sy: number, sz: number): World {
  return { sx, sy, sz, blocks: new Uint8Array(sx * sy * sz) };
}

export function blockIndex(w: World, x: number, y: number, z: number): number {
  return (y * w.sz + z) * w.sx + x;
}

export function inBounds(w: World, x: number, y: number, z: number): boolean {
  return x >= 0 && y >= 0 && z >= 0 && x < w.sx && y < w.sy && z < w.sz;
}

/** Block at integer coords; out-of-bounds: sides and below are Bedrock, above is Air. */
export function getBlock(w: World, x: number, y: number, z: number): Block {
  if (y >= w.sy) return Block.Air;
  if (x < 0 || z < 0 || y < 0 || x >= w.sx || z >= w.sz) return Block.Bedrock;
  return w.blocks[(y * w.sz + z) * w.sx + x] as Block;
}

export function setBlock(w: World, x: number, y: number, z: number, b: Block): void {
  if (!inBounds(w, x, y, z)) return;
  w.blocks[(y * w.sz + z) * w.sx + x] = b;
}

export function isSolid(w: World, x: number, y: number, z: number): boolean {
  return getBlock(w, x, y, z) !== Block.Air;
}

/** Highest solid y in the column, or -1 if the column is empty. */
export function columnTop(w: World, x: number, z: number): number {
  for (let y = w.sy - 1; y >= 0; y--) {
    if (w.blocks[(y * w.sz + z) * w.sx + x] !== Block.Air) return y;
  }
  return -1;
}

/** Cheap content hash for determinism tests. */
export function hashWorld(w: World): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < w.blocks.length; i++) {
    h ^= w.blocks[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
