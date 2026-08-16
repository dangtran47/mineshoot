import { createRng } from './rng';

/**
 * Seeded 2D value noise on a lattice with bilinear interpolation, summed over
 * a few octaves. Returns values in [0, 1]. Deterministic per seed.
 */
export function createNoise2D(seed: number, latticeSize = 64): (x: number, y: number) => number {
  const rng = createRng(seed);
  const size = latticeSize;
  const lattice = new Float32Array(size * size);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng();

  const at = (ix: number, iy: number): number => {
    const x = ((ix % size) + size) % size;
    const y = ((iy % size) + size) % size;
    return lattice[y * size + x];
  };
  const smooth = (t: number): number => t * t * (3 - 2 * t);

  const single = (x: number, y: number): number => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const a = at(x0, y0);
    const b = at(x0 + 1, y0);
    const c = at(x0, y0 + 1);
    const d = at(x0 + 1, y0 + 1);
    const top = a + (b - a) * fx;
    const bottom = c + (d - c) * fx;
    return top + (bottom - top) * fy;
  };

  return (x, y) => {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < 3; o++) {
      sum += single(x * freq, y * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };
}
