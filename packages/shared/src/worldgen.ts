import { WORLD_SX, WORLD_SY, WORLD_SZ } from './constants';
import { createNoise2D } from './noise';
import { createRng } from './rng';
import { Block } from './types';
import type { SpawnPoint, World } from './types';
import { columnTop, createWorld, getBlock, setBlock } from './world';

export interface GeneratedWorld {
  world: World;
  spawnPoints: SpawnPoint[];
}

const BORDER_WALL_H = 6;
const PLATEAU_MIN = 25;
const PLATEAU_MAX = 38; // inclusive
const PLATEAU_TOP = 9;
const MIN_SPAWN_DIST = 8;
const TARGET_SPAWNS = 12;

/**
 * Deterministic arena from a seed: noise heightmap, raised central plateau,
 * pillars, walls, elevated platforms, trees, and a bedrock border. Also
 * returns valid spawn points (standing room, well spread out).
 */
export function generateWorld(seed: number): GeneratedWorld {
  const world = createWorld(WORLD_SX, WORLD_SY, WORLD_SZ);
  const rng = createRng(seed ^ 0x9e3779b9);
  const noise = createNoise2D(seed);

  // Terrain
  for (let z = 0; z < world.sz; z++) {
    for (let x = 0; x < world.sx; x++) {
      let h = 3 + Math.floor(noise(x / 12, z / 12) * 7); // 3..9
      const onPlateau = x >= PLATEAU_MIN && x <= PLATEAU_MAX && z >= PLATEAU_MIN && z <= PLATEAU_MAX;
      if (onPlateau) h = Math.max(h, PLATEAU_TOP);
      const plateauEdge =
        onPlateau && (x === PLATEAU_MIN || x === PLATEAU_MAX || z === PLATEAU_MIN || z === PLATEAU_MAX);
      for (let y = 0; y <= h; y++) {
        let b: Block;
        if (y === 0) b = Block.Bedrock;
        else if (plateauEdge) b = Block.Brick;
        else if (y === h) b = Block.Grass;
        else if (y >= h - 2) b = Block.Dirt;
        else b = Block.Stone;
        setBlock(world, x, y, z, b);
      }
    }
  }

  // Border wall (bedrock base, stone above; the world edge itself is solid for physics)
  for (let y = 0; y < BORDER_WALL_H; y++) {
    const b = y === 0 ? Block.Bedrock : Block.Stone;
    for (let x = 0; x < world.sx; x++) {
      setBlock(world, x, y, 0, b);
      setBlock(world, x, y, world.sz - 1, b);
    }
    for (let z = 0; z < world.sz; z++) {
      setBlock(world, 0, y, z, b);
      setBlock(world, world.sx - 1, y, z, b);
    }
  }

  const randInt = (lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));
  const inPlateau = (x: number, z: number): boolean =>
    x >= PLATEAU_MIN - 1 && x <= PLATEAU_MAX + 1 && z >= PLATEAU_MIN - 1 && z <= PLATEAU_MAX + 1;

  // Pillars (2x2, planks)
  for (let i = 0; i < 8; i++) {
    const x = randInt(3, world.sx - 5);
    const z = randInt(3, world.sz - 5);
    if (inPlateau(x, z)) continue;
    const base = columnTop(world, x, z) + 1;
    const h = randInt(4, 7);
    for (let dx = 0; dx < 2; dx++)
      for (let dz = 0; dz < 2; dz++)
        for (let y = base; y < base + h && y < world.sy; y++) setBlock(world, x + dx, y, z + dz, Block.Planks);
  }

  // Walls (brick, 3 tall)
  for (let i = 0; i < 10; i++) {
    const x = randInt(3, world.sx - 10);
    const z = randInt(3, world.sz - 10);
    const len = randInt(4, 8);
    const alongX = rng() < 0.5;
    for (let k = 0; k < len; k++) {
      const wx = alongX ? x + k : x;
      const wz = alongX ? z : z + k;
      if (inPlateau(wx, wz)) continue;
      const base = columnTop(world, wx, wz) + 1;
      for (let y = base; y < base + 3 && y < world.sy; y++) setBlock(world, wx, y, wz, Block.Brick);
    }
  }

  // Elevated platforms (5x5 planks slab on 4 legs)
  for (let i = 0; i < 6; i++) {
    const x = randInt(3, world.sx - 9);
    const z = randInt(3, world.sz - 9);
    if (inPlateau(x + 2, z + 2)) continue;
    let base = 0;
    for (let dx = 0; dx < 5; dx++)
      for (let dz = 0; dz < 5; dz++) base = Math.max(base, columnTop(world, x + dx, z + dz));
    const slabY = base + 4;
    if (slabY >= world.sy - 2) continue;
    for (let dx = 0; dx < 5; dx++)
      for (let dz = 0; dz < 5; dz++) setBlock(world, x + dx, slabY, z + dz, Block.Planks);
    for (const [lx, lz] of [
      [x, z],
      [x + 4, z],
      [x, z + 4],
      [x + 4, z + 4],
    ]) {
      const legBase = columnTop(world, lx, lz) + 1;
      for (let y = legBase; y < slabY; y++) setBlock(world, lx, y, lz, Block.Planks);
    }
  }

  // Trees (dirt trunk + leaves canopy)
  for (let i = 0; i < 8; i++) {
    const x = randInt(3, world.sx - 4);
    const z = randInt(3, world.sz - 4);
    if (inPlateau(x, z)) continue;
    const base = columnTop(world, x, z) + 1;
    if (getBlock(world, x, base - 1, z) !== Block.Grass) continue;
    const trunkH = randInt(3, 4);
    for (let y = base; y < base + trunkH; y++) setBlock(world, x, y, z, Block.Dirt);
    for (let dy = 0; dy < 2; dy++)
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) {
          const y = base + trunkH - 1 + dy;
          if (dy === 1 && Math.abs(dx) + Math.abs(dz) === 2) continue;
          if (getBlock(world, x + dx, y, z + dz) === Block.Air) setBlock(world, x + dx, y, z + dz, Block.Leaves);
        }
    setBlock(world, x, base + trunkH + 1, z, Block.Leaves);
  }

  return { world, spawnPoints: computeSpawnPoints(world, createRng(seed ^ 0x51ed270b)) };
}

/** True if a player can stand with feet at (x, y, z) (block-centre). */
export function isStandable(world: World, x: number, y: number, z: number): boolean {
  return (
    getBlock(world, x, y - 1, z) !== Block.Air &&
    getBlock(world, x, y, z) === Block.Air &&
    getBlock(world, x, y + 1, z) === Block.Air
  );
}

function computeSpawnPoints(world: World, rng: () => number): SpawnPoint[] {
  const candidates: SpawnPoint[] = [];
  for (let z = 4; z < world.sz - 4; z += 2) {
    for (let x = 4; x < world.sx - 4; x += 2) {
      const top = columnTop(world, x, z);
      const y = top + 1;
      if (top < 0 || y + 1 >= world.sy) continue;
      if (isStandable(world, x, y, z)) candidates.push({ x: x + 0.5, y, z: z + 0.5 });
    }
  }
  // Deterministic shuffle
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const chosen: SpawnPoint[] = [];
  for (const c of candidates) {
    if (chosen.every((s) => Math.hypot(s.x - c.x, s.z - c.z) >= MIN_SPAWN_DIST)) {
      chosen.push(c);
      if (chosen.length >= TARGET_SPAWNS) break;
    }
  }
  return chosen;
}
