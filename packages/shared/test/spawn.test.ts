import { describe, expect, it } from 'vitest';
import { createRng } from '../src/rng';
import { pickSpawn } from '../src/spawn';

const spawns = [
  { x: 0, y: 1, z: 0 },
  { x: 10, y: 1, z: 0 },
  { x: 20, y: 1, z: 0 },
  { x: 30, y: 1, z: 0 },
  { x: 40, y: 1, z: 0 },
];

describe('pickSpawn', () => {
  it('never picks the spawn nearest to an enemy when farther ones exist', () => {
    const rng = createRng(1);
    for (let i = 0; i < 50; i++) {
      const s = pickSpawn(spawns, [{ x: 0, z: 0 }], rng);
      expect(s.x).toBeGreaterThanOrEqual(20);
    }
  });
  it('is deterministic with a seeded rng', () => {
    const a = pickSpawn(spawns, [{ x: 20, z: 0 }], createRng(5));
    const b = pickSpawn(spawns, [{ x: 20, z: 0 }], createRng(5));
    expect(a).toEqual(b);
  });
  it('picks any spawn when there are no enemies', () => {
    expect(spawns).toContainEqual(pickSpawn(spawns, [], createRng(3)));
  });
});
