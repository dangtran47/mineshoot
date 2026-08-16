import { describe, expect, it } from 'vitest';
import { createRng, hashSeed } from '../src/rng';

describe('rng', () => {
  it('same seed gives same sequence', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });
  it('different seeds differ', () => {
    expect(createRng(1)()).not.toBe(createRng(2)());
  });
  it('hashSeed is stable uint32', () => {
    expect(hashSeed('abc')).toBe(hashSeed('abc'));
    expect(hashSeed('abc')).not.toBe(hashSeed('abd'));
    const h = hashSeed('room:1');
    expect(Number.isInteger(h) && h >= 0 && h <= 0xffffffff).toBe(true);
  });
});
