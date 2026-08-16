import { describe, expect, it } from 'vitest';
import { swordVictims } from '../src/sword';
import { Block } from '../src/types';
import { createWorld, setBlock } from '../src/world';

const w = createWorld(32, 16, 32);
const attacker = { x: 16, y: 1, z: 20, yaw: 0, pitch: 0 }; // facing -Z

describe('swordVictims', () => {
  it('hits a target in range and in front', () => {
    expect(swordVictims(w, attacker, [{ id: 'a', pose: { x: 16, y: 1, z: 18 } }])).toEqual(['a']);
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
  it('can hit multiple targets', () => {
    const r = swordVictims(w, attacker, [
      { id: 'a', pose: { x: 16, y: 1, z: 18 } },
      { id: 'b', pose: { x: 16.5, y: 1, z: 18.5 } },
    ]);
    expect(r.sort()).toEqual(['a', 'b']);
  });
});
