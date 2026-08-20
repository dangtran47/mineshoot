import { describe, expect, it } from 'vitest';
import { GUN_KINDS, GUN_NONE, GUN_RIFLE, GUN_SMG, GUN_SNIPER, GUN_TASER, gunSpec } from '../src/guns';
import type { GunKind } from '../src/guns';
import { RECOIL_PATTERNS, RECOIL_RECOVER_DEG_PER_S, recoilKick, recoilResetMs } from '../src/recoil';

describe('recoil', () => {
  it('every gun kind (and empty) has a non-empty pattern of finite upward kicks', () => {
    for (const k of [GUN_NONE, ...GUN_KINDS] as readonly GunKind[]) {
      const pattern = RECOIL_PATTERNS[k];
      expect(pattern.length).toBeGreaterThan(0);
      for (const kick of pattern) {
        expect(Number.isFinite(kick.pitchDeg)).toBe(true);
        expect(Number.isFinite(kick.yawDeg)).toBe(true);
        expect(kick.pitchDeg).toBeGreaterThanOrEqual(0);
      }
    }
  });
  it('lookup is deterministic and clamps past the end of the pattern', () => {
    const last = RECOIL_PATTERNS[GUN_RIFLE][RECOIL_PATTERNS[GUN_RIFLE].length - 1];
    expect(recoilKick(GUN_RIFLE, 0)).toEqual(RECOIL_PATTERNS[GUN_RIFLE][0]);
    expect(recoilKick(GUN_RIFLE, 999)).toEqual(last);
    expect(recoilKick(GUN_RIFLE, 3)).toEqual(recoilKick(GUN_RIFLE, 3));
  });
  it('the rifle spray climbs first, then drifts right, then left (the masterable S-curve)', () => {
    const p = RECOIL_PATTERNS[GUN_RIFLE];
    expect(p.length).toBeGreaterThanOrEqual(10);
    // Opening shots: straight up.
    expect(p[0].yawDeg).toBe(0);
    expect(p[1].yawDeg).toBe(0);
    expect(p[0].pitchDeg).toBeGreaterThan(0);
    // Middle: right drift (negative yaw turns right — yaw decreases turning right).
    const mid = p[5];
    const late = p[p.length - 1];
    expect(mid.yawDeg).toBeLessThan(0);
    // Tail: back across to the left.
    expect(late.yawDeg).toBeGreaterThan(0);
  });
  it('the smg kicks less per shot than the rifle; single-shot guns punch once; the taser has no kick', () => {
    expect(recoilKick(GUN_SMG, 0).pitchDeg).toBeLessThan(recoilKick(GUN_RIFLE, 0).pitchDeg);
    expect(RECOIL_PATTERNS[GUN_SNIPER]).toHaveLength(1);
    expect(recoilKick(GUN_SNIPER, 0).pitchDeg).toBeGreaterThan(recoilKick(GUN_RIFLE, 0).pitchDeg);
    expect(recoilKick(GUN_TASER, 0)).toEqual({ pitchDeg: 0, yawDeg: 0 });
    expect(recoilKick(GUN_NONE, 0)).toEqual({ pitchDeg: 0, yawDeg: 0 });
  });
  it('unknown kinds kick like nothing at all', () => {
    expect(recoilKick(42 as never, 0)).toEqual({ pitchDeg: 0, yawDeg: 0 });
  });
  it('the burst resets after a gap of at least two cooldowns, never sooner than 300 ms', () => {
    expect(recoilResetMs(gunSpec(GUN_SMG))).toBe(300); // 2 × 80 < 300
    expect(recoilResetMs(gunSpec(GUN_SNIPER))).toBe(2400); // 2 × 1200
  });
  it('recovery speed is a sane positive constant', () => {
    expect(RECOIL_RECOVER_DEG_PER_S).toBeGreaterThan(0);
  });
});
