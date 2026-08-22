import * as THREE from 'three';
import { ATLAS_TILES, TILE_PX, Tile } from './mesher';

interface TileSpec {
  base: [number, number, number];
  noise: number;
  pattern?: 'brick' | 'planks' | 'grassSide' | 'leaves' | 'water';
}

const SPECS: Record<Tile, TileSpec> = {
  [Tile.GrassTop]: { base: [95, 159, 53], noise: 22 },
  [Tile.GrassSide]: { base: [134, 96, 67], noise: 18, pattern: 'grassSide' },
  [Tile.Dirt]: { base: [134, 96, 67], noise: 22 },
  [Tile.Stone]: { base: [125, 125, 125], noise: 20 },
  [Tile.Planks]: { base: [178, 142, 86], noise: 12, pattern: 'planks' },
  [Tile.Brick]: { base: [150, 84, 68], noise: 10, pattern: 'brick' },
  [Tile.Bedrock]: { base: [70, 70, 70], noise: 45 },
  [Tile.Leaves]: { base: [58, 122, 44], noise: 30, pattern: 'leaves' },
  [Tile.Water]: { base: [52, 116, 200], noise: 14, pattern: 'water' },
};

/** Tiny deterministic hash → [0,1) so the atlas is identical on every client. */
function h(x: number, y: number, t: number): number {
  let n = (x * 374761393 + y * 668265263 + t * 2147483647) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Procedural 16px block texture atlas (one row of tiles); zero shipped assets. */
export function createAtlasTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_TILES * TILE_PX;
  canvas.height = TILE_PX;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(canvas.width, canvas.height);
  const d = img.data;

  for (let t = 0; t < ATLAS_TILES; t++) {
    const spec = SPECS[t as Tile];
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        let [r, g, b] = spec.base;
        const n = (h(x, y, t) - 0.5) * 2 * spec.noise;
        r += n;
        g += n;
        b += n;
        switch (spec.pattern) {
          case 'grassSide':
            if (y < 3 + Math.floor(h(x, 0, t + 9) * 3)) {
              [r, g, b] = SPECS[Tile.GrassTop].base;
              const m = (h(x, y, t + 3) - 0.5) * 30;
              r += m; g += m; b += m;
            }
            break;
          case 'brick': {
            const row = Math.floor(y / 4);
            const off = row % 2 === 0 ? 0 : 4;
            const mortar = y % 4 === 3 || (x + off) % 8 === 7;
            if (mortar) { r = 190; g = 180; b = 170; }
            break;
          }
          case 'planks': {
            const line = y % 4 === 3;
            const nick = h(x, y, t + 5) < 0.06;
            if (line || nick) { r -= 45; g -= 40; b -= 30; }
            break;
          }
          case 'leaves':
            if (h(x, y, t + 7) < 0.18) { r += 40; g += 40; b += 20; }
            break;
          case 'water':
            // Faint horizontal ripple highlights.
            if ((y + Math.floor(h(0, y, t + 11) * 3)) % 5 === 0 && h(x, y, t + 13) < 0.6) { r += 35; g += 45; b += 40; }
            break;
        }
        const i = (y * canvas.width + (t * TILE_PX + x)) * 4;
        d[i] = Math.max(0, Math.min(255, r));
        d[i + 1] = Math.max(0, Math.min(255, g));
        d[i + 2] = Math.max(0, Math.min(255, b));
        d[i + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
