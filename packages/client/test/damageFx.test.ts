import { describe, expect, it } from 'vitest';
import { MAX_HP } from '@mineshoot/shared';
import { DMG_FLASH_MAX_MS, DMG_FLASH_MIN_MS, damageFlashParams } from '../src/hud/damageFx';

describe('damageFlashParams', () => {
  it('scales opacity and duration with damage', () => {
    const legs = damageFlashParams(15);
    const torso = damageFlashParams(30);
    const lethal = damageFlashParams(MAX_HP);
    expect(legs.opacity).toBeLessThan(torso.opacity);
    expect(torso.opacity).toBeLessThan(lethal.opacity);
    expect(legs.durationMs).toBeLessThan(torso.durationMs);
    expect(torso.durationMs).toBeLessThan(lethal.durationMs);
  });
  it('is still visible for the smallest hit and never exceeds 1', () => {
    expect(damageFlashParams(1).opacity).toBeGreaterThan(0.2);
    expect(damageFlashParams(MAX_HP).opacity).toBeLessThanOrEqual(1);
    expect(damageFlashParams(MAX_HP * 5).opacity).toBeLessThanOrEqual(1);
  });
  it('clamps duration between min and max', () => {
    expect(damageFlashParams(0).durationMs).toBe(DMG_FLASH_MIN_MS);
    expect(damageFlashParams(-5).durationMs).toBe(DMG_FLASH_MIN_MS);
    expect(damageFlashParams(MAX_HP).durationMs).toBe(DMG_FLASH_MAX_MS);
    expect(damageFlashParams(MAX_HP * 5).durationMs).toBe(DMG_FLASH_MAX_MS);
  });
});
