import { describe, expect, it } from 'vitest';
import { DROP_KINDS, DROP_MIN_SPACING, MELEE_SWORD } from '../src/melee';
import { pickDropKind, pickDropSpot } from '../src/drops';
import { createRng } from '../src/rng';
import { PLATEAU_MAX, PLATEAU_MIN, generateWorld, isStandable } from '../src/worldgen';

describe('drops', () => {
  const { world, spawnPoints, dropZone } = generateWorld(42);
  it('pickDropKind never yields the sword and covers every drop kind', () => {
    const rng = createRng(1);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const k = pickDropKind(rng);
      expect(k).not.toBe(MELEE_SWORD);
      seen.add(k);
    }
    expect([...seen].sort()).toEqual([...DROP_KINDS].sort());
  });
  it('pickDropSpot returns standable block centres in the middle of the arena, away from existing drops', () => {
    const rng = createRng(7);
    const placed: { x: number; z: number }[] = [];
    for (let i = 0; i < 10; i++) {
      const s = pickDropSpot(world, rng, placed, spawnPoints, dropZone)!;
      expect(s).not.toBeNull();
      expect(s.x % 1).toBeCloseTo(0.5);
      expect(s.z % 1).toBeCloseTo(0.5);
      expect(isStandable(world, Math.floor(s.x), s.y, Math.floor(s.z))).toBe(true);
      expect(s.x).toBeGreaterThanOrEqual(PLATEAU_MIN);
      expect(s.x).toBeLessThanOrEqual(PLATEAU_MAX + 1);
      expect(s.z).toBeGreaterThanOrEqual(PLATEAU_MIN);
      expect(s.z).toBeLessThanOrEqual(PLATEAU_MAX + 1);
      for (const p of placed) expect(Math.hypot(p.x - s.x, p.z - s.z)).toBeGreaterThanOrEqual(DROP_MIN_SPACING);
      placed.push(s);
    }
  });
  it('falls back to a spawn point when probes fail', () => {
    const s = pickDropSpot(world, () => 0.999, [], spawnPoints, dropZone, 0)!;
    expect(spawnPoints).toContainEqual(s);
    expect(pickDropSpot(world, () => 0.5, [], [], dropZone, 0)).toBeNull();
  });
});
