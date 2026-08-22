import { describe, expect, it } from 'vitest';
import { CTF_WORLD_SX, CTF_WORLD_SZ, TD_WORLD_SX, TD_WORLD_SZ, WORLD_SX, WORLD_SY, WORLD_SZ } from '../src/constants';
import { TEAM_BLUE, TEAM_RED } from '../src/protocol';
import { Block } from '../src/types';
import type { World } from '../src/types';
import { columnTop, getBlock, hashWorld, isSolid } from '../src/world';
import { PLATEAU_MAX, PLATEAU_MIN, TD_SPAWN_BAND, generateCtfWorld, generateTdWorld, generateWorld, generateWorldFor, isStandable } from '../src/worldgen';

/** Feet height a player settles at in column (x, z) — sinking through water to its floor — or -1 if there is no footing. */
function feetY(world: World, x: number, z: number): number {
  for (let y = columnTop(world, x, z) + 1; y >= 1; y--) {
    if (isStandable(world, x, y, z)) return y;
  }
  return -1;
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

describe('generateCtfWorld', () => {
  it('is deterministic per seed and sized for a long carry', () => {
    const a = generateCtfWorld(77);
    const b = generateCtfWorld(77);
    expect(hashWorld(a.world)).toBe(hashWorld(b.world));
    expect(a.spawnPoints).toEqual(b.spawnPoints);
    expect(a.bases).toEqual(b.bases);
    expect(a.world.sx).toBe(CTF_WORLD_SX);
    expect(a.world.sz).toBe(CTF_WORLD_SZ);
    expect(a.world.sy).toBe(WORLD_SY);
    expect(hashWorld(generateCtfWorld(78).world)).not.toBe(hashWorld(a.world));
  });

  it('puts each flag stand on a standable raised base at its own end, on the centre line', () => {
    for (const seed of [1, 2, 3, 500]) {
      const { world, bases } = generateCtfWorld(seed);
      const red = bases[TEAM_RED];
      const blue = bases[TEAM_BLUE];
      expect(isStandable(world, Math.floor(red.x), red.y, Math.floor(red.z))).toBe(true);
      expect(isStandable(world, Math.floor(blue.x), blue.y, Math.floor(blue.z))).toBe(true);
      expect(red.x).toBeLessThan(world.sx / 4);
      expect(blue.x).toBeGreaterThan((world.sx * 3) / 4);
      expect(red.z).toBeCloseTo(world.sz / 2 + 0.5);
      expect(blue.z).toBeCloseTo(red.z);
      expect(red.y).toBe(blue.y);
      expect(red.y).toBeGreaterThan(5); // raised base
    }
  });

  it('keeps the straight line between the bases walkable (one-block steps at most)', () => {
    for (let seed = 0; seed < 100; seed++) {
      const { world, bases } = generateCtfWorld(seed);
      const z = Math.floor(bases[TEAM_RED].z);
      let prev = feetY(world, Math.floor(bases[TEAM_RED].x), z);
      for (let x = Math.floor(bases[TEAM_RED].x) + 1; x <= Math.floor(bases[TEAM_BLUE].x); x++) {
        const y = feetY(world, x, z);
        expect(y, `seed ${seed} x ${x}`).toBeGreaterThan(0);
        expect(Math.abs(y - prev), `seed ${seed} x ${x}: ${prev} -> ${y}`).toBeLessThanOrEqual(1);
        prev = y;
      }
    }
  });

  it('spreads standable spawn points over both ends, none in the middle', () => {
    for (const seed of [1, 2, 3, 12345]) {
      const { world, spawnPoints, bases } = generateCtfWorld(seed);
      const red = spawnPoints.filter((s) => s.x < world.sx / 2);
      const blue = spawnPoints.filter((s) => s.x >= world.sx / 2);
      expect(red.length).toBeGreaterThanOrEqual(6);
      expect(blue.length).toBeGreaterThanOrEqual(6);
      for (const s of spawnPoints) {
        expect(isStandable(world, Math.floor(s.x), s.y, Math.floor(s.z))).toBe(true);
        expect(Math.min(Math.abs(s.x - bases[TEAM_RED].x), Math.abs(s.x - bases[TEAM_BLUE].x))).toBeLessThan(world.sx / 4);
      }
    }
  });

  it('has a bedrock floor, a border wall, headroom, and a drop zone on the ridge', () => {
    const { world, dropZone } = generateCtfWorld(9);
    for (let x = 0; x < world.sx; x++)
      for (let z = 0; z < world.sz; z++) {
        expect(getBlock(world, x, 0, z)).toBe(Block.Bedrock);
        expect(getBlock(world, x, world.sy - 1, z)).toBe(Block.Air);
      }
    for (let y = 0; y < 6; y++) {
      expect(getBlock(world, 0, y, 10)).not.toBe(Block.Air);
      expect(getBlock(world, world.sx - 1, y, 10)).not.toBe(Block.Air);
      expect(getBlock(world, 10, y, 0)).not.toBe(Block.Air);
      expect(getBlock(world, 10, y, world.sz - 1)).not.toBe(Block.Air);
    }
    expect(dropZone.minX).toBeGreaterThan(world.sx / 3);
    expect(dropZone.maxX).toBeLessThan((world.sx * 2) / 3);
    const y = columnTop(world, Math.floor((dropZone.minX + dropZone.maxX) / 2), Math.floor((dropZone.minZ + dropZone.maxZ) / 2));
    expect(y).toBeGreaterThan(6); // the ridge is high ground
  });

  it('every drop-zone column can be reached on foot from the plateau centre (steps of at most one block up)', () => {
    const { world, dropZone } = generateCtfWorld(9);
    const key = (x: number, z: number): number => x * 1024 + z;
    const start: [number, number] = [Math.floor((dropZone.minX + dropZone.maxX) / 2), Math.floor((dropZone.minZ + dropZone.maxZ) / 2)];
    const seen = new Set<number>([key(...start)]);
    const queue: [number, number][] = [start];
    while (queue.length > 0) {
      const [x, z] = queue.shift()!;
      const top = columnTop(world, x, z);
      for (const [nx, nz] of [
        [x - 1, z],
        [x + 1, z],
        [x, z - 1],
        [x, z + 1],
      ]) {
        if (nx < dropZone.minX || nx > dropZone.maxX || nz < dropZone.minZ || nz > dropZone.maxZ || seen.has(key(nx, nz))) continue;
        if (columnTop(world, nx, nz) - top > 1) continue; // a jump clears one block
        seen.add(key(nx, nz));
        queue.push([nx, nz]);
      }
    }
    for (let x = dropZone.minX; x <= dropZone.maxX; x++)
      for (let z = dropZone.minZ; z <= dropZone.maxZ; z++) expect(seen.has(key(x, z)), `column ${x},${z}`).toBe(true);
  });

  it('generateWorldFor picks the map by room mode', () => {
    expect(generateWorldFor('match', 5).world.sx).toBe(WORLD_SX);
    expect(generateWorldFor('training', 5).world.sx).toBe(WORLD_SX);
    expect(generateWorldFor('ctf', 5).world.sx).toBe(CTF_WORLD_SX);
    expect(generateWorldFor('td', 5).world.sz).toBe(TD_WORLD_SZ);
    expect(generateWorld(5).dropZone).toEqual({ minX: PLATEAU_MIN, maxX: PLATEAU_MAX, minZ: PLATEAU_MIN, maxZ: PLATEAU_MAX });
  });
});

describe('generateTdWorld', () => {
  it('is deterministic per seed; spawns mirror exactly even though the cover blocks are offset', () => {
    const a = generateTdWorld(42);
    const b = generateTdWorld(42);
    expect(hashWorld(a.world)).toBe(hashWorld(b.world));
    expect(a.spawnPoints).toEqual(b.spawnPoints);
    expect(a.weaponSpots).toEqual(b.weaponSpots);
    expect(a.world.sx).toBe(TD_WORLD_SX);
    expect(a.world.sz).toBe(TD_WORLD_SZ);
    // The blocks are fixed and the ground is flat, so only the spawn shuffle depends on the seed.
    expect(generateTdWorld(43).spawnPoints).not.toEqual(a.spawnPoints);
    // The middle of the map is deliberately asymmetric (offset blocks = shooting
    // angles), but fairness lives in the yards: every north spawn point has an
    // exact south mirror — same x, mirrored z, same footing.
    const north = a.spawnPoints.filter((s) => s.z < a.world.sz / 2);
    const south = a.spawnPoints.filter((s) => s.z >= a.world.sz / 2);
    expect(south.length).toBe(north.length);
    for (const s of north) {
      const m = south.find((t) => t.x === s.x && Math.abs(t.z - (a.world.sz - s.z)) < 1e-9);
      expect(m, `mirror of spawn ${s.x},${s.z}`).toBeTruthy();
      expect(m!.y).toBe(s.y);
    }
  });

  it('puts each base in its own spawn zone, standable, on the road axis', () => {
    for (const seed of [1, 2, 3, 500]) {
      const { world, bases } = generateTdWorld(seed);
      const red = bases[TEAM_RED];
      const blue = bases[TEAM_BLUE];
      expect(isStandable(world, Math.floor(red.x), red.y, Math.floor(red.z))).toBe(true);
      expect(isStandable(world, Math.floor(blue.x), blue.y, Math.floor(blue.z))).toBe(true);
      expect(red.z).toBeLessThan(world.sz / 4);
      expect(blue.z).toBeGreaterThan((world.sz * 3) / 4);
      expect(blue.z).toBeCloseTo(world.sz - red.z);
      expect(red.x).toBeCloseTo(blue.x);
    }
  });

  it('spreads standable spawn points over both zones, none in the middle', () => {
    for (const seed of [1, 2, 3, 12345]) {
      const { world, spawnPoints } = generateTdWorld(seed);
      const red = spawnPoints.filter((s) => s.z < world.sz / 2);
      const blue = spawnPoints.filter((s) => s.z >= world.sz / 2);
      expect(red.length).toBeGreaterThanOrEqual(8);
      expect(blue.length).toBeGreaterThanOrEqual(8);
      for (const s of spawnPoints) {
        expect(isStandable(world, Math.floor(s.x), s.y, Math.floor(s.z))).toBe(true);
        expect(s.z <= TD_SPAWN_BAND + 0.5 || s.z >= world.sz - TD_SPAWN_BAND - 1.5, `spawn at z ${s.z}`).toBe(true);
      }
    }
  });

  it('lays 10 mirrored standable weapon spots per side, in matching order', () => {
    for (const seed of [1, 2, 3, 12345]) {
      const { world, weaponSpots } = generateTdWorld(seed);
      expect(weaponSpots).toHaveLength(20);
      const red = weaponSpots!.slice(0, 10);
      const blue = weaponSpots!.slice(10);
      for (const s of weaponSpots!) expect(isStandable(world, Math.floor(s.x), s.y, Math.floor(s.z))).toBe(true);
      for (let i = 0; i < 10; i++) {
        expect(red[i].z).toBeLessThan(world.sz / 2);
        expect(blue[i].x).toBe(red[i].x);
        expect(blue[i].z).toBeCloseTo(world.sz - red[i].z);
      }
    }
  });

  it('keeps the north-south road walkable from base to base (one-block steps at most)', () => {
    for (let seed = 0; seed < 100; seed++) {
      const { world, bases } = generateTdWorld(seed);
      const x = Math.floor(bases[TEAM_RED].x);
      let prev = feetY(world, x, Math.floor(bases[TEAM_RED].z));
      for (let z = Math.floor(bases[TEAM_RED].z) + 1; z <= Math.floor(bases[TEAM_BLUE].z); z++) {
        const y = feetY(world, x, z);
        expect(y, `seed ${seed} z ${z}`).toBeGreaterThan(0);
        expect(Math.abs(y - prev), `seed ${seed} z ${z}: ${prev} -> ${y}`).toBeLessThanOrEqual(1);
        prev = y;
      }
    }
  });

  it('places the four offset cover blocks, the border stubs and the sunken lake', () => {
    for (const seed of [1, 7, 42]) {
      const { world, pistolSpots } = generateTdWorld(seed);
      const wallTall = (x: number, z: number): void => {
        // A TD_WALL_H block on ground 3..4 puts the column top at 10+; feetY -1 (no headroom) also counts as walled.
        const y = feetY(world, x, z);
        expect(y < 0 || y >= 10, `expected wall at ${x},${z} (feetY ${y})`).toBe(true);
      };
      const open = (x: number, z: number): void => {
        const y = feetY(world, x, z);
        expect(y, `expected walkable ground at ${x},${z}`).toBeGreaterThan(0);
        expect(y, `expected walkable ground at ${x},${z}`).toBeLessThanOrEqual(6);
      };
      // The middle of each cover block is solid wall (they are offset, not mirrored).
      wallTall(22, 23);
      wallTall(54, 21);
      wallTall(24, 52);
      wallTall(55, 50);
      // The staggered corridors between them are walkable (banks or water)…
      for (const [x, z] of [
        [38, 20],
        [40, 55],
        [20, 37],
        [55, 35],
      ]) open(x, z);
      // …and so are the side lanes along the border.
      open(4, 20);
      open(71, 55);
      // A border stub covers each corridor mouth.
      wallTall(38, 3);
      wallTall(42, 72);
      wallTall(3, 37);
      wallTall(72, 35);
      // Four standable pistol spots sit at the east-west arm mouths, beside the stubs.
      expect(pistolSpots).toHaveLength(4);
      for (const s of pistolSpots!) expect(isStandable(world, Math.floor(s.x), s.y, Math.floor(s.z)), `pistol spot ${s.x},${s.z}`).toBe(true);
      // The cross-shaped channel between the blocks is water bank to bank, one block
      // deep, its surface flush with the flat ground. Water is not support — you sink
      // through it to the channel floor and jump one block to climb out.
      for (const [x, z] of [
        [39, 36], // the crossing
        [38, 20], // north channel
        [40, 55], // south channel
        [20, 37], // west channel
        [55, 35], // east channel
        [35, 36], // channel edge: water right up to the grass, no brick rim
      ]) {
        expect(getBlock(world, x, 3, z), `water at ${x},${z}`).toBe(Block.Water);
        expect(feetY(world, x, z), `sunk to the floor at ${x},${z}`).toBe(3);
        expect(isStandable(world, x, 4, z), `no standing ON the water at ${x},${z}`).toBe(false);
      }
      // The channel stops short of the yards: the approach in front of the spawn is dry.
      expect(getBlock(world, 38, 3, 7)).not.toBe(Block.Water);
      expect(feetY(world, 38, 7)).toBe(4);
      expect(feetY(world, 33, 4)).toBe(4); // flat spawn yard
    }
  });

  it('has a bedrock floor, a border wall and headroom', () => {
    const { world } = generateTdWorld(9);
    for (let x = 0; x < world.sx; x++)
      for (let z = 0; z < world.sz; z++) {
        expect(getBlock(world, x, 0, z)).toBe(Block.Bedrock);
        expect(getBlock(world, x, world.sy - 1, z)).toBe(Block.Air);
      }
    for (let y = 0; y < 6; y++) {
      expect(getBlock(world, 0, y, 10)).not.toBe(Block.Air);
      expect(getBlock(world, world.sx - 1, y, 10)).not.toBe(Block.Air);
      expect(getBlock(world, 10, y, 0)).not.toBe(Block.Air);
      expect(getBlock(world, 10, y, world.sz - 1)).not.toBe(Block.Air);
    }
  });
});
