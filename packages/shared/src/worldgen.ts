import { CTF_WORLD_SX, CTF_WORLD_SZ, TD_WORLD_SX, TD_WORLD_SZ, WORLD_SX, WORLD_SY, WORLD_SZ } from './constants';
import { createNoise2D } from './noise';
import { TEAM_BLUE, TEAM_RED } from './protocol';
import type { RoomMode, Team } from './protocol';
import { createRng } from './rng';
import { Block } from './types';
import type { SpawnPoint, World } from './types';
import { columnTop, createWorld, getBlock, setBlock } from './world';

/** Inclusive block-coordinate rectangle on the x/z plane. */
export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface GeneratedWorld {
  world: World;
  spawnPoints: SpawnPoint[];
  /** Where weapon drops land (see drops.ts). */
  dropZone: Rect;
  /** Team modes only: the flag stand (ctf) / spawn-zone centre (td) of each team (feet position). */
  bases: Record<Team, SpawnPoint>;
  /** Team elimination only: the fixed weapon spots, 8 red-side then their 8 blue-side mirrors (same order). */
  weaponSpots?: SpawnPoint[];
}

const BORDER_WALL_H = 6;
/** The raised central plateau: the arena's centre stage, where weapon drops land. */
export const PLATEAU_MIN = 25;
export const PLATEAU_MAX = 38; // inclusive
const PLATEAU_TOP = 9;
/** Stair ramps up onto the plateau: one per side, centred, this many blocks wide. */
const RAMP_WIDTH = 4;
const RAMP_LO = Math.floor((PLATEAU_MIN + PLATEAU_MAX + 1) / 2) - RAMP_WIDTH / 2; // first ramp column
const MIN_SPAWN_DIST = 8;
const TARGET_SPAWNS = 16;

// --- CTF map layout (x is the long axis; the map is mirrored across its middle so both teams get the same ground) ---
/** Raised base forts: x extent from the wall, z extent, top height, and the gate (front stair) width. */
const CTF_BASE_DEPTH = 9; // x 3..11 (red) / 84..92 (blue)
const CTF_BASE_Z_MIN = 18;
const CTF_BASE_Z_MAX = 29;
const CTF_BASE_TOP = 7;
const CTF_GATE_WIDTH = 6;
/** Central plateau: the contested high ground in the middle, with a ramp on each side (like the arena's). */
const CTF_HUB_MIN_X = 40;
const CTF_HUB_MAX_X = 55; // inclusive: 16 wide
const CTF_HUB_TOP = 9;
/** Watchtowers (5x5 plank slabs on legs) overlooking each side lane, mirrored for the other team. */
const CTF_TOWERS: readonly [number, number][] = [
  [22, 6],
  [22, 37],
];
const CTF_MIN_SPAWN_DIST = 8;
const CTF_TARGET_SPAWNS = 24;
/** Spawn points only this close to the end walls (each team respawns near its base). */
const CTF_SPAWN_BAND = 22;

/** Pick the generator for a room mode. */
export function generateWorldFor(mode: RoomMode, seed: number): GeneratedWorld {
  return mode === 'ctf' ? generateCtfWorld(seed) : mode === 'td' ? generateTdWorld(seed) : generateWorld(seed);
}

/**
 * Deterministic arena from a seed: noise heightmap, raised central plateau
 * with a stair ramp on each of its four sides, pillars, walls, elevated
 * platforms, trees, and a bedrock border. Also returns valid spawn points
 * (standing room, well spread out).
 */
export function generateWorld(seed: number): GeneratedWorld {
  const world = createWorld(WORLD_SX, WORLD_SY, WORLD_SZ);
  const rng = createRng(seed ^ 0x9e3779b9);
  const noise = createNoise2D(seed);
  const plateau: Rect = { minX: PLATEAU_MIN, maxX: PLATEAU_MAX, minZ: PLATEAU_MIN, maxZ: PLATEAU_MAX };

  fillTerrain(world, (x, z) => {
    let h = 3 + Math.floor(noise(x / 12, z / 12) * 7); // 3..9
    const onPlateau = inRect(plateau, x, z);
    if (onPlateau) h = Math.max(h, PLATEAU_TOP);
    return { h, brick: onPlateau && onRectEdge(plateau, x, z) };
  });
  borderWall(world);

  // Stair ramps from the middle of each plateau side. Ramp columns (plus a
  // margin) are reserved so no obstacle can block them.
  const reserved = new Set<number>();
  carveRamp(world, reserved, PLATEAU_MAX + 1, RAMP_LO, 1, 0, PLATEAU_TOP, RAMP_WIDTH);
  carveRamp(world, reserved, PLATEAU_MIN - 1, RAMP_LO, -1, 0, PLATEAU_TOP, RAMP_WIDTH);
  carveRamp(world, reserved, RAMP_LO, PLATEAU_MAX + 1, 0, 1, PLATEAU_TOP, RAMP_WIDTH);
  carveRamp(world, reserved, RAMP_LO, PLATEAU_MIN - 1, 0, -1, PLATEAU_TOP, RAMP_WIDTH);

  const forbidden = (x: number, z: number): boolean =>
    (x >= PLATEAU_MIN - 1 && x <= PLATEAU_MAX + 1 && z >= PLATEAU_MIN - 1 && z <= PLATEAU_MAX + 1) || reserved.has(x * 1024 + z);
  scatterPillars(world, rng, 8, forbidden);
  scatterWalls(world, rng, 10, forbidden);
  scatterPlatforms(world, rng, 6, forbidden);
  scatterTrees(world, rng, 8, forbidden);

  const spawnPoints = computeSpawnPoints(world, createRng(seed ^ 0x51ed270b), TARGET_SPAWNS, MIN_SPAWN_DIST);
  return { world, spawnPoints, dropZone: plateau, bases: noBases() };
}

/**
 * Deterministic capture-the-flag map: a long rectangle, mirrored across its
 * middle. A raised fort with the flag stand at each end (parapet, a gate on
 * the field side and a stair on each flank), a central plateau with a ramp on
 * every side as the contested high ground, and rolling side lanes with mirrored
 * watchtowers, walls, pillars and trees for cover. The straight line between
 * the flag stands is always walkable (gate → ground → plateau ramps → gate),
 * so even the naive bot pathing gets from base to base.
 */
export function generateCtfWorld(seed: number): GeneratedWorld {
  const world = createWorld(CTF_WORLD_SX, WORLD_SY, CTF_WORLD_SZ);
  const rng = createRng(seed ^ 0x7f4a7c15);
  const noise = createNoise2D(seed ^ 0x2545f491);
  const sx = world.sx;
  const mirrorX = (x: number): number => sx - 1 - x;
  const zMid = Math.floor(world.sz / 2); // 24
  const redBase: Rect = { minX: 3, maxX: 3 + CTF_BASE_DEPTH - 1, minZ: CTF_BASE_Z_MIN, maxZ: CTF_BASE_Z_MAX };
  const blueBase: Rect = { minX: mirrorX(redBase.maxX), maxX: mirrorX(redBase.minX), minZ: CTF_BASE_Z_MIN, maxZ: CTF_BASE_Z_MAX };
  const hub: Rect = { minX: CTF_HUB_MIN_X, maxX: CTF_HUB_MAX_X, minZ: CTF_BASE_Z_MIN, maxZ: CTF_BASE_Z_MAX };

  // Rolling ground (3..6, mirrored so both halves are the same), the forts and the plateau raised out of it with brick rims.
  fillTerrain(world, (x, z) => {
    const nx = x < sx / 2 ? x : mirrorX(x);
    let h = 3 + Math.floor(noise(nx / 12, z / 12) * 4);
    let brick = false;
    for (const [r, top] of [
      [redBase, CTF_BASE_TOP],
      [blueBase, CTF_BASE_TOP],
      [hub, CTF_HUB_TOP],
    ] as const) {
      if (!inRect(r, x, z)) continue;
      h = Math.max(h, top);
      brick = onRectEdge(r, x, z);
    }
    return { h, brick };
  });
  borderWall(world);

  const reserved = new Set<number>();
  const rampLo = zMid - RAMP_WIDTH / 2; // 22..25 across the centre line
  // Plateau: a ramp on each of its four sides.
  carveRamp(world, reserved, hub.minX - 1, rampLo, -1, 0, CTF_HUB_TOP, RAMP_WIDTH);
  carveRamp(world, reserved, hub.maxX + 1, rampLo, 1, 0, CTF_HUB_TOP, RAMP_WIDTH);
  const hubRampX = Math.floor((hub.minX + hub.maxX + 1) / 2) - RAMP_WIDTH / 2;
  carveRamp(world, reserved, hubRampX, hub.minZ - 1, 0, -1, CTF_HUB_TOP, RAMP_WIDTH);
  carveRamp(world, reserved, hubRampX, hub.maxZ + 1, 0, 1, CTF_HUB_TOP, RAMP_WIDTH);
  // Forts: a gate (stair) on the field side, a stair on each flank, and a one-block parapet everywhere else.
  const gateLo = zMid - CTF_GATE_WIDTH / 2; // 21..26
  const flankLo = (r: Rect): number => Math.floor((r.minX + r.maxX + 1) / 2) - RAMP_WIDTH / 2; // 5..8 / 86..89
  for (const [r, dx] of [
    [redBase, 1],
    [blueBase, -1],
  ] as const) {
    carveRamp(world, reserved, dx > 0 ? r.maxX + 1 : r.minX - 1, gateLo, dx, 0, CTF_BASE_TOP, CTF_GATE_WIDTH);
    carveRamp(world, reserved, flankLo(r), r.maxZ + 1, 0, 1, CTF_BASE_TOP, RAMP_WIDTH);
    carveRamp(world, reserved, flankLo(r), r.minZ - 1, 0, -1, CTF_BASE_TOP, RAMP_WIDTH);
    const gateX = dx > 0 ? r.maxX : r.minX;
    for (let x = r.minX; x <= r.maxX; x++) {
      for (let z = r.minZ; z <= r.maxZ; z++) {
        if (!onRectEdge(r, x, z)) continue;
        const inGate = x === gateX && z >= gateLo && z < gateLo + CTF_GATE_WIDTH;
        const inFlank = (z === r.minZ || z === r.maxZ) && x >= flankLo(r) && x < flankLo(r) + RAMP_WIDTH;
        if (!inGate && !inFlank) setBlock(world, x, CTF_BASE_TOP + 1, z, Block.Brick);
      }
    }
  }
  // Plateau corner posts: a little cover up top. Two blocks high with a
  // one-block step on the side facing the plateau centre, so a drop that lands
  // on top can still be jumped up to (a jump clears one block, not two).
  for (const [cx, cz] of [
    [hub.minX + 1, hub.minZ + 1],
    [hub.maxX - 2, hub.minZ + 1],
    [hub.minX + 1, hub.maxZ - 2],
    [hub.maxX - 2, hub.maxZ - 2],
  ]) {
    const stepDz = cz < zMid ? 1 : 0;
    for (let dx = 0; dx < 2; dx++)
      for (let dz = 0; dz < 2; dz++) {
        const h = dz === stepDz ? 1 : 2;
        for (let y = CTF_HUB_TOP + 1; y <= CTF_HUB_TOP + h; y++) setBlock(world, cx + dx, y, cz + dz, Block.Planks);
      }
  }

  const towers: Rect[] = CTF_TOWERS.flatMap(([tx, tz]) => [
    { minX: tx, maxX: tx + 4, minZ: tz, maxZ: tz + 4 },
    { minX: mirrorX(tx + 4), maxX: mirrorX(tx), minZ: tz, maxZ: tz + 4 },
  ]);
  const forbidden = (x: number, z: number): boolean => {
    if (reserved.has(x * 1024 + z)) return true;
    for (const r of [redBase, blueBase, hub, ...towers]) if (x >= r.minX - 2 && x <= r.maxX + 2 && z >= r.minZ - 2 && z <= r.maxZ + 2) return true;
    // Keep the centre corridor between each gate and the plateau clear (the bots' road).
    if (z >= gateLo - 1 && z < gateLo + CTF_GATE_WIDTH + 1) return true;
    return false;
  };
  // Mirrored watchtowers overlooking the side lanes.
  for (const [tx, tz] of CTF_TOWERS) {
    platformAt(world, tx, tz);
    platformAt(world, mirrorX(tx + 4), tz);
  }
  // Cover in the west half, mirrored to the east so both teams see the same ground.
  const westCover = (x: number, z: number): boolean => x >= 14 && x <= 38 && !forbidden(x, z);
  scatterMirrored(world, rng, 6, sx, mirrorX, westCover, (x, z, r) => {
    // Short brick walls, along x or z, 4–6 long.
    const len = randInt(r, 4, 6);
    const alongX = r() < 0.5;
    for (let k = 0; k < len; k++) if (!westCover(alongX ? x + k : x, alongX ? z : z + k)) return null;
    return { w: alongX ? len : 1, d: alongX ? 1 : len, build: (bx, bz) => wallCells(world, bx, bz, alongX ? len : 1, alongX ? 1 : len) };
  });
  scatterMirrored(world, rng, 3, sx, mirrorX, westCover, (x, z, r) => {
    if (!westCover(x + 1, z + 1)) return null;
    const h = randInt(r, 4, 6);
    return { w: 2, d: 2, build: (bx, bz) => pillarAt(world, bx, bz, h) };
  });
  scatterMirrored(world, rng, 5, sx, mirrorX, westCover, (_x, _z, r) => {
    const trunk = randInt(r, 3, 4);
    return { w: 1, d: 1, build: (bx, bz) => treeAt(world, bx, bz, trunk) };
  });

  const spawnPoints = computeSpawnPoints(
    world,
    createRng(seed ^ 0x3c6ef372),
    CTF_TARGET_SPAWNS,
    CTF_MIN_SPAWN_DIST,
    (x) => x <= CTF_SPAWN_BAND || x >= sx - 1 - CTF_SPAWN_BAND,
  );
  const stand = (r: Rect): SpawnPoint => {
    const x = Math.floor((r.minX + r.maxX) / 2);
    return { x: x + 0.5, y: columnTop(world, x, zMid) + 1, z: zMid + 0.5 };
  };
  return {
    world,
    spawnPoints,
    dropZone: { minX: hub.minX + 1, maxX: hub.maxX - 1, minZ: hub.minZ + 1, maxZ: hub.maxZ - 1 },
    bases: { [TEAM_RED]: stand(redBase), [TEAM_BLUE]: stand(blueBase) },
  };
}

// --- TD map layout (teams north/south; the map is mirrored across its z middle so both sides get the same ground) ---
/** The two brick-paved roads whose crossing is the "ngã tư"; flattened to this height so they are always walkable. */
const TD_ROAD_MIN = 28;
const TD_ROAD_MAX = 35; // inclusive: 8 wide
const TD_ROAD_H = 3;
/** Hollow corner buildings framing the intersection (north pair; the south pair is the mirror). */
const TD_BUILDINGS: readonly Rect[] = [
  { minX: 15, maxX: 23, minZ: 15, maxZ: 23 },
  { minX: 40, maxX: 48, minZ: 15, maxZ: 23 },
];
const TD_WALL_H = 4;
const TD_DOOR_WIDTH = 3;
/** Each team spawns in the band z 2..TD_SPAWN_BAND at its own end. */
const TD_SPAWN_BAND = 11;
const TD_TARGET_SPAWNS = 24;
const TD_MIN_SPAWN_DIST = 6;
/** Fixed weapon spots: this row of x columns at TD_WEAPON_Z (red) and its mirror (blue). */
const TD_WEAPON_XS: readonly number[] = [12, 18, 24, 30, 34, 40, 46, 52];
const TD_WEAPON_Z = 13;

/**
 * Deterministic team-elimination map: a square crossroads ("ngã tư tử thần").
 * Two flat brick roads cross in the middle; four hollow corner buildings frame
 * the intersection, each with a doorway onto both roads. Each team spawns in
 * its own band at the north/south end behind a row of fixed weapon spots, with
 * a little cover. Everything is mirrored across the z middle so both teams
 * fight over identical ground, and the north-south road runs base to base so
 * the bots always have a route.
 */
export function generateTdWorld(seed: number): GeneratedWorld {
  const world = createWorld(TD_WORLD_SX, WORLD_SY, TD_WORLD_SZ);
  const rng = createRng(seed ^ 0x6a09e667);
  const noise = createNoise2D(seed ^ 0xbb67ae85);
  const sz = world.sz;
  const mirrorZ = (z: number): number => sz - 1 - z;
  const onRoad = (x: number, z: number): boolean => (x >= TD_ROAD_MIN && x <= TD_ROAD_MAX) || (z >= TD_ROAD_MIN && z <= TD_ROAD_MAX);
  const buildings: Rect[] = [
    ...TD_BUILDINGS,
    ...TD_BUILDINGS.map((r) => ({ minX: r.minX, maxX: r.maxX, minZ: mirrorZ(r.maxZ), maxZ: mirrorZ(r.minZ) })),
  ];

  // Gentle mirrored ground (3..4, so the flat roads never have a bank too tall to jump out over),
  // brick-paved roads, flat building floors.
  fillTerrain(world, (x, z) => {
    const nz = z < sz / 2 ? z : mirrorZ(z);
    let h = 3 + Math.floor(noise(x / 12, nz / 12) * 2);
    let brick = false;
    if (buildings.some((r) => inRect(r, x, z))) h = TD_ROAD_H;
    if (onRoad(x, z)) {
      h = TD_ROAD_H;
      brick = true;
    }
    return { h, brick };
  });
  borderWall(world);

  // Corner buildings: a doorway onto each road they face (the mirrored pair faces north instead of south).
  for (const r of TD_BUILDINGS) {
    const south = { minX: r.minX, maxX: r.maxX, minZ: mirrorZ(r.maxZ), maxZ: mirrorZ(r.minZ) };
    const roadSide = r.maxX < TD_ROAD_MIN ? 'e' : 'w';
    roomAt(world, r, [roadSide, 's']);
    roomAt(world, south, [roadSide, 'n']);
  }

  // Spawn-zone cover: a short wall in front of each spawn band, mirrored.
  for (const x0 of [10, 22, 42, 52]) {
    wallCells(world, x0, 9, 4, 1);
    wallCells(world, x0, mirrorZ(9), 4, 1);
  }
  // A few mirrored trees and pillars in the side strips between the buildings and the border.
  const strip = (x: number, z: number): boolean => (x >= 3 && x <= 11 || x >= 52 && x <= 60) && z >= 15 && z <= 24;
  for (let i = 0, tries = 0; i < 6 && tries < 36; tries++) {
    const x = randInt(rng, 3, world.sx - 4);
    const z = randInt(rng, 15, 24);
    if (!strip(x, z)) continue;
    if (rng() < 0.6) {
      const trunk = randInt(rng, 3, 4);
      treeAt(world, x, z, trunk);
      treeAt(world, x, mirrorZ(z), trunk);
    } else {
      if (!strip(x + 1, z + 1)) continue;
      const h = randInt(rng, 4, 6);
      pillarAt(world, x, z, h);
      pillarAt(world, x, mirrorZ(z + 1), h);
    }
    i++;
  }

  const spawnPoints = computeSpawnPoints(
    world,
    createRng(seed ^ 0x3c6ef372),
    TD_TARGET_SPAWNS,
    TD_MIN_SPAWN_DIST,
    (_x, z) => z <= TD_SPAWN_BAND || z >= sz - 1 - TD_SPAWN_BAND,
  );
  const spotAt = (x: number, z: number): SpawnPoint => ({ x: x + 0.5, y: columnTop(world, x, z) + 1, z: z + 0.5 });
  const weaponSpots = [
    ...TD_WEAPON_XS.map((x) => spotAt(x, TD_WEAPON_Z)),
    ...TD_WEAPON_XS.map((x) => spotAt(x, mirrorZ(TD_WEAPON_Z))),
  ];
  const baseX = Math.floor((TD_ROAD_MIN + TD_ROAD_MAX) / 2);
  return {
    world,
    spawnPoints,
    dropZone: { minX: TD_ROAD_MIN, maxX: TD_ROAD_MAX, minZ: TD_ROAD_MIN, maxZ: TD_ROAD_MAX },
    bases: { [TEAM_RED]: spotAt(baseX, 6), [TEAM_BLUE]: spotAt(baseX, mirrorZ(6)) },
    weaponSpots,
  };
}

// --- shared building blocks ---

const noBases = (): Record<Team, SpawnPoint> => ({ [TEAM_RED]: { x: 0, y: 0, z: 0 }, [TEAM_BLUE]: { x: 0, y: 0, z: 0 } });

function inRect(r: Rect, x: number, z: number): boolean {
  return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
}
function onRectEdge(r: Rect, x: number, z: number): boolean {
  return x === r.minX || x === r.maxX || z === r.minZ || z === r.maxZ;
}

/** Fill every column up to `h` (bedrock floor, stone, dirt, grass; brick where flagged). */
function fillTerrain(world: World, heightAt: (x: number, z: number) => { h: number; brick: boolean }): void {
  for (let z = 0; z < world.sz; z++) {
    for (let x = 0; x < world.sx; x++) {
      const { h, brick } = heightAt(x, z);
      for (let y = 0; y <= h; y++) {
        let b: Block;
        if (y === 0) b = Block.Bedrock;
        else if (brick) b = Block.Brick;
        else if (y === h) b = Block.Grass;
        else if (y >= h - 2) b = Block.Dirt;
        else b = Block.Stone;
        setBlock(world, x, y, z, b);
      }
    }
  }
}

/** Bedrock base, stone above; the world edge itself is solid for physics. */
function borderWall(world: World): void {
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
}

/**
 * Stair ramp: starting at the first column outside a raised area whose top is
 * `top`, step down one block per column outward (direction dx/dz) until the
 * terrain is already at least that high. Players can only jump one block, so
 * this guarantees a way up regardless of what the heightmap did. `width`
 * columns across the direction; every touched column (plus a margin) goes into
 * `reserved` so no obstacle can block it.
 */
function carveRamp(world: World, reserved: Set<number>, x0: number, z0: number, dx: number, dz: number, top: number, width: number): void {
  const reserve = (x: number, z: number): void => {
    for (let ex = -1; ex <= 1; ex++) for (let ez = -1; ez <= 1; ez++) reserved.add((x + ex) * 1024 + z + ez);
  };
  let x = x0;
  let z = z0;
  for (let stepTop = top - 1; stepTop >= 1; stepTop--) {
    let merged = true;
    for (let k = 0; k < width; k++) {
      const cx = dx === 0 ? x + k : x;
      const cz = dz === 0 ? z + k : z;
      reserve(cx, cz);
      const t = columnTop(world, cx, cz);
      if (t >= stepTop) continue; // terrain already reaches this step here
      merged = false;
      for (let y = t + 1; y <= stepTop; y++) setBlock(world, cx, y, cz, Block.Brick);
    }
    if (merged) break;
    x += dx;
    z += dz;
  }
}

const randInt = (rng: () => number, lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));

/** A 2x2 plank pillar `h` tall at (x, z), standing on the ground under its origin column. */
function pillarAt(world: World, x: number, z: number, h: number): void {
  const base = columnTop(world, x, z) + 1;
  for (let dx = 0; dx < 2; dx++)
    for (let dz = 0; dz < 2; dz++)
      for (let y = base; y < base + h && y < world.sy; y++) setBlock(world, x + dx, y, z + dz, Block.Planks);
}

/** 2x2 plank pillars, 4–7 tall. */
function scatterPillars(world: World, rng: () => number, n: number, forbidden: (x: number, z: number) => boolean): void {
  for (let i = 0; i < n; i++) {
    const x = randInt(rng, 3, world.sx - 5);
    const z = randInt(rng, 3, world.sz - 5);
    if (forbidden(x, z)) continue;
    pillarAt(world, x, z, randInt(rng, 4, 7));
  }
}

/** Brick cells over a w×d footprint from (x0, z0), 3 tall, each column following the ground. */
function wallCells(world: World, x0: number, z0: number, w: number, d: number): void {
  for (let dx = 0; dx < w; dx++)
    for (let dz = 0; dz < d; dz++) {
      const base = columnTop(world, x0 + dx, z0 + dz) + 1;
      for (let y = base; y < base + 3 && y < world.sy; y++) setBlock(world, x0 + dx, y, z0 + dz, Block.Brick);
    }
}

/**
 * A hollow, roofless brick room over `r`: walls TD_WALL_H tall on the rect
 * edge, with a TD_DOOR_WIDTH-wide, two-block-tall doorway centred on each
 * side named in `doors` ('n' = minZ, 's' = maxZ, 'w' = minX, 'e' = maxX).
 */
function roomAt(world: World, r: Rect, doors: readonly ('n' | 's' | 'e' | 'w')[]): void {
  const cx = Math.floor((r.minX + r.maxX) / 2);
  const cz = Math.floor((r.minZ + r.maxZ) / 2);
  const half = Math.floor(TD_DOOR_WIDTH / 2);
  const inDoor = (x: number, z: number): boolean =>
    doors.some((side) => {
      if (side === 'n') return z === r.minZ && Math.abs(x - cx) <= half;
      if (side === 's') return z === r.maxZ && Math.abs(x - cx) <= half;
      if (side === 'w') return x === r.minX && Math.abs(z - cz) <= half;
      return x === r.maxX && Math.abs(z - cz) <= half;
    });
  for (let x = r.minX; x <= r.maxX; x++)
    for (let z = r.minZ; z <= r.maxZ; z++) {
      if (!onRectEdge(r, x, z)) continue;
      const base = columnTop(world, x, z) + 1;
      const from = inDoor(x, z) ? base + 2 : base;
      for (let y = from; y < base + TD_WALL_H && y < world.sy; y++) setBlock(world, x, y, z, Block.Brick);
    }
}

interface MirroredPiece {
  /** Footprint (x extent, z extent) from the origin, for the mirrored copy's origin. */
  w: number;
  d: number;
  build: (x: number, z: number) => void;
}

/**
 * Place up to `n` random pieces on the west half (origins accepted by `ok`)
 * and build a mirror image of each on the east half, so both teams face the
 * same cover. `make` may return null to reject a spot.
 */
function scatterMirrored(
  world: World,
  rng: () => number,
  n: number,
  sx: number,
  mirrorX: (x: number) => number,
  ok: (x: number, z: number) => boolean,
  make: (x: number, z: number, rng: () => number) => MirroredPiece | null,
): void {
  for (let i = 0, tries = 0; i < n && tries < n * 6; tries++) {
    const x = randInt(rng, 3, Math.floor(sx / 2) - 2);
    const z = randInt(rng, 3, world.sz - 5);
    if (!ok(x, z)) continue;
    const piece = make(x, z, rng);
    if (!piece) continue;
    piece.build(x, z);
    piece.build(mirrorX(x + piece.w - 1), z);
    i++;
  }
}

/** Brick walls, 3 tall, 4–8 long, along x or z. */
function scatterWalls(world: World, rng: () => number, n: number, forbidden: (x: number, z: number) => boolean): void {
  for (let i = 0; i < n; i++) {
    const x = randInt(rng, 3, world.sx - 10);
    const z = randInt(rng, 3, world.sz - 10);
    const len = randInt(rng, 4, 8);
    const alongX = rng() < 0.5;
    for (let k = 0; k < len; k++) {
      const wx = alongX ? x + k : x;
      const wz = alongX ? z : z + k;
      if (forbidden(wx, wz)) continue;
      const base = columnTop(world, wx, wz) + 1;
      for (let y = base; y < base + 3 && y < world.sy; y++) setBlock(world, wx, y, wz, Block.Brick);
    }
  }
}

/** An elevated 5x5 plank slab on 4 legs with its corner at (x, z); false if there is no headroom. */
function platformAt(world: World, x: number, z: number): boolean {
  let base = 0;
  for (let dx = 0; dx < 5; dx++)
    for (let dz = 0; dz < 5; dz++) base = Math.max(base, columnTop(world, x + dx, z + dz));
  const slabY = base + 4;
  if (slabY >= world.sy - 2) return false;
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
  return true;
}

/** Elevated 5x5 plank slabs on 4 legs. */
function scatterPlatforms(world: World, rng: () => number, n: number, forbidden: (x: number, z: number) => boolean): void {
  for (let i = 0; i < n; i++) {
    const x = randInt(rng, 3, world.sx - 9);
    const z = randInt(rng, 3, world.sz - 9);
    if (forbidden(x + 2, z + 2) || forbidden(x, z) || forbidden(x + 4, z) || forbidden(x, z + 4) || forbidden(x + 4, z + 4)) continue;
    platformAt(world, x, z);
  }
}

/** A tree (dirt trunk `trunkH` tall + leaves canopy) at (x, z); only grows on grass. */
function treeAt(world: World, x: number, z: number, trunkH: number): boolean {
  const base = columnTop(world, x, z) + 1;
  if (getBlock(world, x, base - 1, z) !== Block.Grass) return false;
  for (let y = base; y < base + trunkH; y++) setBlock(world, x, y, z, Block.Dirt);
  for (let dy = 0; dy < 2; dy++)
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const y = base + trunkH - 1 + dy;
        if (dy === 1 && Math.abs(dx) + Math.abs(dz) === 2) continue;
        if (getBlock(world, x + dx, y, z + dz) === Block.Air) setBlock(world, x + dx, y, z + dz, Block.Leaves);
      }
  setBlock(world, x, base + trunkH + 1, z, Block.Leaves);
  return true;
}

/** Trees: dirt trunk + leaves canopy, only on grass. */
function scatterTrees(world: World, rng: () => number, n: number, forbidden: (x: number, z: number) => boolean): void {
  for (let i = 0; i < n; i++) {
    const x = randInt(rng, 3, world.sx - 4);
    const z = randInt(rng, 3, world.sz - 4);
    if (forbidden(x, z)) continue;
    if (getBlock(world, x, columnTop(world, x, z), z) !== Block.Grass) continue;
    treeAt(world, x, z, randInt(rng, 3, 4));
  }
}

/** True if a player can stand with feet at (x, y, z) (block-centre). */
export function isStandable(world: World, x: number, y: number, z: number): boolean {
  return (
    getBlock(world, x, y - 1, z) !== Block.Air &&
    getBlock(world, x, y, z) === Block.Air &&
    getBlock(world, x, y + 1, z) === Block.Air
  );
}

/**
 * Standable columns on a 2-block grid (optionally filtered by `accept`),
 * shuffled deterministically, greedily kept at least `minDist` apart, up to
 * `target` points.
 */
function computeSpawnPoints(
  world: World,
  rng: () => number,
  target: number,
  minDist: number,
  accept: (x: number, z: number) => boolean = () => true,
): SpawnPoint[] {
  const candidates: SpawnPoint[] = [];
  for (let z = 4; z < world.sz - 4; z += 2) {
    for (let x = 4; x < world.sx - 4; x += 2) {
      if (!accept(x, z)) continue;
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
    if (chosen.every((s) => Math.hypot(s.x - c.x, s.z - c.z) >= minDist)) {
      chosen.push(c);
      if (chosen.length >= target) break;
    }
  }
  return chosen;
}
