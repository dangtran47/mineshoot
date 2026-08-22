import { describe, expect, it } from 'vitest';
import { isLockSpike } from '../src/input/pointerLock';

describe('isLockSpike', () => {
  it('drops the huge bogus delta Chrome fires right after locking', () => {
    expect(isLockSpike(10, 800, 0)).toBe(true);
    expect(isLockSpike(10, 0, -500)).toBe(true);
  });
  it('keeps fast high-DPI flicks once the lock has settled', () => {
    expect(isLockSpike(1000, 800, 0)).toBe(false);
    expect(isLockSpike(1000, 0, 2000)).toBe(false);
  });
  it('keeps ordinary movement even inside the settle window', () => {
    expect(isLockSpike(10, 50, 20)).toBe(false);
  });
});
