import { describe, expect, it } from 'vitest';
import { EYE_HEIGHT, PLAYER_HALF_W, SWORD_DAMAGE } from '../src/constants';
import { swordDamage, swordVictims } from '../src/sword';
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
    expect(swordVictims(w, attacker, t, false)).toHaveLength(1);
    expect(swordVictims(w, attacker, t, true)).toEqual([]);
    // 0.5 blocks to the side (~14°) is inside both.
    const near = [{ id: 'a', pose: { x: 16.5, y: 1, z: 18 } }];
    expect(swordVictims(w, attacker, near, true)).toHaveLength(1);
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
    expect(ids(swordVictims(w, attacker, targets, false))).toEqual(['b']); // b is closer (z 18.5 vs 18)
    expect(ids(swordVictims(w, attacker, [...targets].reverse(), false))).toEqual(['b']); // order-independent
    expect(ids(swordVictims(w, attacker, targets, true))).toEqual(['a', 'b']);
  });
});

describe('swordDamage', () => {
  it('light: 45 head / 30 body; charged: 100 head / 70 body', () => {
    expect(swordDamage('head', false)).toBe(45);
    expect(swordDamage('body', false)).toBe(30);
    expect(swordDamage('head', true)).toBe(100);
    expect(swordDamage('body', true)).toBe(70);
    expect(SWORD_DAMAGE.charged.head).toBe(100);
  });
});
