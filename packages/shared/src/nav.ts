import type { Vec3, World } from './types';
import { Block } from './types';

/*
 * Grid navigation for bots: A* over "standable" voxel cells (solid floor,
 * two blocks of headroom). Moving to a neighbour cell may step up one block
 * (the walker has to jump) or drop down up to MAX_DROP blocks; diagonals are
 * only allowed on a level floor with both orthogonal neighbours free (no
 * corner cutting). Pure functions of the world; no allocation between calls
 * beyond the search itself.
 */

/** A walkable cell: block coordinates of the column, `y` = feet level (first air block above the floor). */
export interface NavCell {
  x: number;
  y: number;
  z: number;
}

/** Largest drop the pathfinder will route through (falls are harmless, but keep bots off ledges they didn't mean to leave). */
export const MAX_DROP = 4;
/** How far above/below `y` nearestStandable looks for footing. */
const SNAP_RANGE = 3;
/** Search budget: cells expanded per findPath call. */
const MAX_EXPANSIONS = 6000;
const SQRT2 = Math.SQRT2;

const air = (w: World, x: number, y: number, z: number): boolean => {
  if (x < 0 || z < 0 || x >= w.sx || z >= w.sz) return false;
  if (y < 0) return false;
  if (y >= w.sy) return true;
  const b = w.blocks[(y * w.sz + z) * w.sx + x];
  // Water is passable (you wade through it) but not support (`solid` below stays false).
  return b === Block.Air || b === Block.Water;
};
const solid = (w: World, x: number, y: number, z: number): boolean => x >= 0 && z >= 0 && x < w.sx && z < w.sz && y >= 0 && y < w.sy && !air(w, x, y, z);

/** Feet at `y` in column (x, z) with a floor below and two blocks of headroom. */
export function standable(w: World, x: number, y: number, z: number): boolean {
  return solid(w, x, y - 1, z) && air(w, x, y, z) && air(w, x, y + 1, z);
}

/** Snap a feet position (e.g. mid-jump or on a slope) to the closest standable cell in its column, or null. */
export function nearestStandable(w: World, x: number, y: number, z: number): NavCell | null {
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  const cy = Math.floor(y + 1e-6);
  for (let d = 0; d <= SNAP_RANGE; d++) {
    if (standable(w, cx, cy - d, cz)) return { x: cx, y: cy - d, z: cz };
    if (d > 0 && standable(w, cx, cy + d, cz)) return { x: cx, y: cy + d, z: cz };
  }
  return null;
}

const DIRS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const DIAGS: readonly [number, number][] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Where an orthogonal step from feet-level `y` lands in column (nx, nz): same level, one up (needs a jump), or a drop; -1 if blocked. */
function stepLevel(w: World, x: number, y: number, z: number, nx: number, nz: number): number {
  if (standable(w, nx, y, nz)) return y;
  // Step up: needs jump headroom in the current column too.
  if (standable(w, nx, y + 1, nz) && air(w, x, y + 2, z)) return y + 1;
  for (let d = 1; d <= MAX_DROP; d++) {
    // Falling through: every block passed must be air.
    if (!air(w, nx, y - d + 1, nz)) return -1;
    if (standable(w, nx, y - d, nz)) return y - d;
  }
  return -1;
}

interface Node {
  x: number;
  y: number;
  z: number;
  g: number;
  f: number;
  parent: Node | null;
}

/** Binary min-heap on `f`. */
class Heap {
  private readonly a: Node[] = [];
  get size(): number {
    return this.a.length;
  }
  push(n: Node): void {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): Node {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

const key = (w: World, x: number, y: number, z: number): number => (y * w.sz + z) * w.sx + x;

/**
 * A* from `from` to `to` (both standable cells; snap with nearestStandable
 * first). Returns the cell sequence including both ends, or null when
 * unreachable / out of budget. Deterministic.
 */
export function findPath(w: World, from: NavCell, to: NavCell): NavCell[] | null {
  if (!standable(w, from.x, from.y, from.z) || !standable(w, to.x, to.y, to.z)) return null;
  const h = (x: number, z: number): number => {
    const dx = Math.abs(x - to.x);
    const dz = Math.abs(z - to.z);
    return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
  };
  const open = new Heap();
  const best = new Map<number, number>();
  const closed = new Set<number>();
  const start: Node = { ...from, g: 0, f: h(from.x, from.z), parent: null };
  open.push(start);
  best.set(key(w, from.x, from.y, from.z), 0);
  let expansions = 0;
  const relax = (n: Node, x: number, y: number, z: number, cost: number): void => {
    const k = key(w, x, y, z);
    if (closed.has(k)) return;
    const g = n.g + cost;
    const prev = best.get(k);
    if (prev !== undefined && prev <= g) return;
    best.set(k, g);
    open.push({ x, y, z, g, f: g + h(x, z), parent: n });
  };
  while (open.size > 0) {
    const n = open.pop();
    const k = key(w, n.x, n.y, n.z);
    if (closed.has(k)) continue;
    if (n.x === to.x && n.y === to.y && n.z === to.z) {
      const path: NavCell[] = [];
      for (let c: Node | null = n; c; c = c.parent) path.push({ x: c.x, y: c.y, z: c.z });
      return path.reverse();
    }
    closed.add(k);
    if (++expansions > MAX_EXPANSIONS) return null;
    for (const [dx, dz] of DIRS) {
      const nx = n.x + dx;
      const nz = n.z + dz;
      const ny = stepLevel(w, n.x, n.y, n.z, nx, nz);
      if (ny < 0) continue;
      // Climbing costs a little extra so ramps beat pointless hops; drops are cheap.
      relax(n, nx, ny, nz, 1 + (ny > n.y ? 0.5 : 0));
    }
    for (const [dx, dz] of DIAGS) {
      const nx = n.x + dx;
      const nz = n.z + dz;
      if (!standable(w, nx, n.y, nz) || !standable(w, n.x + dx, n.y, n.z) || !standable(w, n.x, n.y, n.z + dz)) continue;
      relax(n, nx, n.y, nz, SQRT2);
    }
  }
  return null;
}

/** Centre of a cell at feet level, for steering. */
export function cellCentre(c: NavCell): Vec3 {
  return { x: c.x + 0.5, y: c.y, z: c.z + 0.5 };
}
