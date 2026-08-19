import { describe, expect, it } from 'vitest';
import { EYE_HEIGHT, PLAYER_HALF_W, SWORD_DAMAGE } from '../src/constants';
import { swordDamage, swordVictims } from '../src/sword';
import { ATTACK_HEAVY, ATTACK_LIGHT, MELEE_AXE, MELEE_KATANA, MELEE_PICKAXE, MELEE_SCYTHE, MELEE_STATS, MELEE_SWORD } from '../src/melee';
import { Block } from '../src/types';
import { createWorld, setBlock } from '../src/world';

const w = createWorld(32, 16, 32);
const attacker = { x: 16, y: 1, z: 20, yaw: 0, pitch: 0 }; // facing -Z
const ids = (hits: { id: string }[]): string[] => hits.map((h) => h.id).sort();
/** Pitch that puts the aim ray `height` above the feet of a target `dz` blocks ahead. */
const pitchFor = (height: number, dz: number): number => Math.atan2(height - EYE_HEIGHT, dz - PLAYER_HALF_W);

describe('swordVictims', () => {
  it('hits a target in range and in front; a level aim lands on the head', () => {
    expect(swordVictims(w, attacker, [{ id: 'a', pose: { x: 16, y: 1, z: 18 } }])).toEqual([{ id: 'a', part: 'head' }]);
  });
  it('aiming at the chest or legs counts as body', () => {
    const t = [{ id: 'a', pose: { x: 16, y: 1, z: 18 } }];
    expect(swordVictims(w, { ...attacker, pitch: pitchFor(1.0, 2) }, t)).toEqual([{ id: 'a', part: 'body' }]);
    expect(swordVictims(w, { ...attacker, pitch: pitchFor(0.3, 2) }, t)).toEqual([{ id: 'a', part: 'body' }]);
  });
  it('a target inside the cone but off the aim ray is a body hit', () => {
    // 0.9 blocks to the side (~24°): within the light cone at 2 blocks, but the ray passes beside the head.
    expect(swordVictims(w, attacker, [{ id: 'a', pose: { x: 16.9, y: 1, z: 18 } }])).toEqual([{ id: 'a', part: 'body' }]);
  });
  it('the heavy (charged) cone is narrower than the light one', () => {
    // 0.9 blocks to the side at 2 blocks is ~24°: inside the light cone, outside the heavy cone.
    const t = [{ id: 'a', pose: { x: 16.9, y: 1, z: 18 } }];
    expect(swordVictims(w, attacker, t, ATTACK_LIGHT)).toHaveLength(1);
    expect(swordVictims(w, attacker, t, ATTACK_HEAVY)).toEqual([]);
    // 0.5 blocks to the side (~14°) is inside both.
    const near = [{ id: 'a', pose: { x: 16.5, y: 1, z: 18 } }];
    expect(swordVictims(w, attacker, near, ATTACK_HEAVY)).toHaveLength(1);
  });
  it('misses targets behind, too far, or outside the cone', () => {
    expect(swordVictims(w, attacker, [{ id: 'a', pose: { x: 16, y: 1, z: 22 } }])).toEqual([]);
    expect(swordVictims(w, attacker, [{ id: 'a', pose: { x: 16, y: 1, z: 16 } }])).toEqual([]);
    expect(swordVictims(w, attacker, [{ id: 'a', pose: { x: 18.5, y: 1, z: 18.5 } }])).toEqual([]);
  });
  it('is blocked by a wall', () => {
    const w2 = createWorld(32, 16, 32);
    for (let y = 0; y < 5; y++) for (let x = 14; x < 19; x++) setBlock(w2, x, y, 19, Block.Brick);
    expect(swordVictims(w2, attacker, [{ id: 'a', pose: { x: 16, y: 1, z: 18 } }])).toEqual([]);
  });
  it('a light swing hits only the nearest target; a charged swing sweeps everyone in the cone', () => {
    const targets = [
      { id: 'a', pose: { x: 16, y: 1, z: 18 } },
      { id: 'b', pose: { x: 16.5, y: 1, z: 18.5 } },
    ];
    expect(ids(swordVictims(w, attacker, targets, ATTACK_LIGHT))).toEqual(['b']); // b is closer (z 18.5 vs 18)
    expect(ids(swordVictims(w, attacker, [...targets].reverse(), ATTACK_LIGHT))).toEqual(['b']); // order-independent
    expect(ids(swordVictims(w, attacker, targets, ATTACK_HEAVY))).toEqual(['a', 'b']);
  });
});

describe('swordDamage', () => {
  it('light: 45 head / 30 body; charged: 100 head / 70 body', () => {
    expect(swordDamage('head', ATTACK_LIGHT)).toBe(45);
    expect(swordDamage('body', ATTACK_LIGHT)).toBe(30);
    expect(swordDamage('head', ATTACK_HEAVY)).toBe(100);
    expect(swordDamage('body', ATTACK_HEAVY)).toBe(70);
    expect(SWORD_DAMAGE.charged.head).toBe(100);
  });

  it('a heavy released before it is fully charged does damage in proportion to the hold; a light never scales', () => {
    expect(swordDamage('head', ATTACK_HEAVY, MELEE_SWORD, 0.5)).toBe(50);
    expect(swordDamage('body', ATTACK_HEAVY, MELEE_SWORD, 0.5)).toBe(35);
    expect(swordDamage('body', ATTACK_HEAVY, MELEE_SWORD, 0.3)).toBe(21);
    expect(swordDamage('head', ATTACK_HEAVY, MELEE_SWORD, 1)).toBe(100);
    expect(swordDamage('head', ATTACK_HEAVY, MELEE_AXE, 0.25)).toBe(25);
    expect(swordDamage('head', ATTACK_LIGHT, MELEE_SWORD, 0.5)).toBe(45);
  });
});

describe('swordVictims with drop weapons', () => {
  const t = (x: number, z: number, id = 'a'): { id: string; pose: { x: number; y: number; z: number } } => ({ id, pose: { x, y: 1, z } });
  it('katana reaches further than the sword', () => {
    const far = [t(16, 20 - 3.5)]; // 3.5 blocks ahead: past the sword, inside the katana
    expect(swordVictims(w, attacker, far, ATTACK_LIGHT, MELEE_SWORD)).toEqual([]);
    expect(swordVictims(w, attacker, far, ATTACK_LIGHT, MELEE_KATANA)).toEqual([{ id: 'a', part: 'head' }]);
  });
  it('katana cone is narrower', () => {
    const side = [t(16.9, 18)]; // ~24°: inside the sword's light cone, outside the katana's
    expect(swordVictims(w, attacker, side, ATTACK_LIGHT, MELEE_SWORD)).toHaveLength(1);
    expect(swordVictims(w, attacker, side, ATTACK_LIGHT, MELEE_KATANA)).toEqual([]);
  });
  it('axe and scythe cleave: a light swing hits everyone in the cone, the sword only the nearest', () => {
    const two = [t(16.3, 18, 'near'), t(15.7, 17.5, 'far')];
    expect(ids(swordVictims(w, attacker, two, ATTACK_LIGHT, MELEE_SWORD))).toEqual(['near']);
    expect(ids(swordVictims(w, attacker, two, ATTACK_LIGHT, MELEE_AXE))).toEqual(['far', 'near']);
    expect(ids(swordVictims(w, attacker, two, ATTACK_LIGHT, MELEE_SCYTHE))).toEqual(['far', 'near']);
    expect(ids(swordVictims(w, attacker, two, ATTACK_LIGHT, MELEE_PICKAXE))).toEqual(['near']);
  });
  it('scythe cone is wide enough to catch a target far to the side', () => {
    const wide = [t(17.4, 18)]; // ~35° off axis at 2.4 blocks
    expect(swordVictims(w, attacker, wide, ATTACK_LIGHT, MELEE_SWORD)).toEqual([]);
    expect(swordVictims(w, attacker, wide, ATTACK_LIGHT, MELEE_SCYTHE)).toHaveLength(1);
  });
  it('swordDamage takes the kind and the attack into account', () => {
    expect(swordDamage('head', ATTACK_LIGHT)).toBe(SWORD_DAMAGE.normal.head);
    expect(swordDamage('head', ATTACK_LIGHT, MELEE_PICKAXE)).toBe(MELEE_STATS[MELEE_PICKAXE].attacks[ATTACK_LIGHT].damage.head);
    expect(swordDamage('body', ATTACK_HEAVY, MELEE_AXE)).toBe(100);
  });
});
