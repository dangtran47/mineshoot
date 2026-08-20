import { describe, expect, it } from 'vitest';
import { DROP_KINDS, DROP_MIN_SPACING, MELEE_KATANA, MELEE_SWORD } from '../src/melee';
import { dropName, dropPool, pickDropKind, pickDropSpot } from '../src/drops';
import { GRENADE_DROP_AMOUNT } from '../src/grenade';
import { GUN_SHOTGUN, GUN_TASER, PRIMARY_KINDS } from '../src/guns';
import { WEAPON_GRENADE, WEAPON_MELEE, WEAPON_PRIMARY, WEAPON_TASER } from '../src/protocol';
import { createRng } from '../src/rng';
import { PLATEAU_MAX, PLATEAU_MIN, generateWorld, isStandable } from '../src/worldgen';

describe('drops', () => {
  const { world, spawnPoints, dropZone } = generateWorld(42);
  it('dropPool follows the weapon mode: guns+taser+grenades+knives for all, knives only for sword rooms', () => {
    const all = dropPool('all');
    expect(all.filter((d) => d.slot === WEAPON_PRIMARY).map((d) => d.kind).sort()).toEqual([...PRIMARY_KINDS].sort());
    expect(all.filter((d) => d.slot === WEAPON_TASER)).toEqual([{ slot: WEAPON_TASER, kind: GUN_TASER }]);
    expect(all.filter((d) => d.slot === WEAPON_GRENADE)).toEqual([{ slot: WEAPON_GRENADE, kind: GRENADE_DROP_AMOUNT }]);
    expect(all.filter((d) => d.slot === WEAPON_MELEE).map((d) => d.kind).sort()).toEqual([...DROP_KINDS].sort());
    const sword = dropPool('sword');
    expect(sword.every((d) => d.slot === WEAPON_MELEE)).toBe(true);
    expect(sword.map((d) => d.kind).sort()).toEqual([...DROP_KINDS].sort());
    expect(all).toHaveLength(PRIMARY_KINDS.length + 2 + sword.length);
  });
  it('pickDropKind never yields the sword and covers the whole pool of the mode', () => {
    const rng = createRng(1);
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const k = pickDropKind(rng, 'all');
      expect(k.slot === WEAPON_MELEE && k.kind === MELEE_SWORD).toBe(false);
      seen.add(`${k.slot}:${k.kind}`);
    }
    expect(seen.size).toBe(dropPool('all').length);
    for (let i = 0; i < 50; i++) expect(pickDropKind(rng, 'sword').slot).toBe(WEAPON_MELEE);
  });
  it('names drops for toasts', () => {
    expect(dropName({ slot: WEAPON_GRENADE, kind: 2 })).toBe('Grenades ×2');
    expect(dropName({ slot: WEAPON_TASER, kind: GUN_TASER })).toBe('Taser');
    expect(dropName({ slot: WEAPON_MELEE, kind: MELEE_KATANA })).toBe('Katana');
    expect(dropName({ slot: WEAPON_PRIMARY, kind: GUN_SHOTGUN })).toBe('Shotgun');
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
