import { describe, expect, it } from 'vitest';
import { MAX_HP } from '@mineshoot/shared';
import { BLOOD_MAX_PARTICLES, BLOOD_MIN_PARTICLES, bloodParticleCount } from '../src/render/bloodParams';

describe('bloodParticleCount', () => {
  it('grows with damage', () => {
    expect(bloodParticleCount(15)).toBeLessThan(bloodParticleCount(30));
    expect(bloodParticleCount(30)).toBeLessThan(bloodParticleCount(MAX_HP));
  });
  it('clamps to the min/max and never spawns for a miss', () => {
    expect(bloodParticleCount(0)).toBe(0);
    expect(bloodParticleCount(1)).toBe(BLOOD_MIN_PARTICLES);
    expect(bloodParticleCount(MAX_HP)).toBe(BLOOD_MAX_PARTICLES);
    expect(bloodParticleCount(MAX_HP * 3)).toBe(BLOOD_MAX_PARTICLES);
  });
});
