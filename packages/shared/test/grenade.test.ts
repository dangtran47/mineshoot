import { describe, expect, it } from 'vitest';
import { CROUCH_EYE_HEIGHT, EYE_HEIGHT } from '../src/constants';
import { GRENADE_BLAST_RADIUS, GRENADE_DAMAGE_CENTER, GRENADE_DAMAGE_EDGE, GRENADE_FUSE_MS, GRENADE_RADIUS, GRENADE_THROW_MAX_SPEED, GRENADE_THROW_MIN_SPEED, blastDamage, explosionVictims, grenadeFuseDone, stepGrenade, throwGrenade, throwSpeed } from '../src/grenade';
import { Block } from '../src/types';
import { createWorld, setBlock } from '../src/world';

/** Flat 32×16×32 world: stone floor at y=0, air above. */
function flat(): ReturnType<typeof createWorld> {
  const w = createWorld(32, 16, 32);
  for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) setBlock(w, x, 0, z, Block.Stone);
  return w;
}
const pose = { x: 16, y: 1, z: 16, yaw: 0, pitch: 0 };

describe('grenade', () => {
  it('leaves the eye along the view direction at the speed of the hold', () => {
    const g = throwGrenade(pose, 1000);
    expect(g.bornAt).toBe(1000);
    expect(g.y).toBeCloseTo(1 + EYE_HEIGHT - 0.1, 1);
    expect(g.vz).toBeCloseTo(-GRENADE_THROW_MAX_SPEED, 5); // yaw 0 looks down -Z; default = full hold
    expect(g.vx).toBeCloseTo(0, 5);
    expect(throwGrenade(pose, 0, 0).vz).toBeCloseTo(-GRENADE_THROW_MIN_SPEED, 5); // a tap lobs short
    expect(throwSpeed(0.5)).toBeCloseTo((GRENADE_THROW_MIN_SPEED + GRENADE_THROW_MAX_SPEED) / 2, 5);
    expect(throwSpeed(7)).toBe(GRENADE_THROW_MAX_SPEED); // clamped
    expect(throwSpeed(-1)).toBe(GRENADE_THROW_MIN_SPEED);
  });
  it('falls under gravity, bounces off the floor and comes to rest', () => {
    const w = flat();
    let g = throwGrenade({ ...pose, pitch: 0.4 }, 0);
    let maxY = g.y;
    let bounced = false;
    for (let i = 0; i < 400; i++) {
      const prev = g;
      g = stepGrenade(w, g, 1 / 80);
      maxY = Math.max(maxY, g.y);
      if (prev.vy < 0 && g.vy > 0) bounced = true;
      expect(g.y).toBeGreaterThan(0.9); // never inside the floor
    }
    expect(maxY).toBeGreaterThan(2);
    expect(bounced).toBe(true);
    expect(Math.abs(g.vy)).toBeLessThan(0.5);
    expect(g.y).toBeLessThan(1 + GRENADE_RADIUS + 0.05); // resting on the floor
  });
  it('bounces back off a wall', () => {
    const w = flat();
    for (let y = 1; y < 6; y++) for (let x = 0; x < 32; x++) setBlock(w, x, y, 10, Block.Stone);
    let g = throwGrenade({ ...pose, pitch: 0.2 }, 0); // toward -Z, wall at z=10
    for (let i = 0; i < 60; i++) g = stepGrenade(w, g, 1 / 80);
    expect(g.z).toBeGreaterThan(11);
    expect(g.vz).toBeGreaterThan(0);
  });
  it('fuse and damage falloff', () => {
    const g = throwGrenade(pose, 0);
    expect(grenadeFuseDone(g, GRENADE_FUSE_MS - 1)).toBe(false);
    expect(grenadeFuseDone(g, GRENADE_FUSE_MS)).toBe(true);
    expect(blastDamage(0)).toBe(GRENADE_DAMAGE_CENTER);
    expect(blastDamage(GRENADE_BLAST_RADIUS)).toBe(GRENADE_DAMAGE_EDGE);
    expect(blastDamage(GRENADE_BLAST_RADIUS / 2)).toBe(Math.round((GRENADE_DAMAGE_CENTER + GRENADE_DAMAGE_EDGE) / 2));
    expect(blastDamage(GRENADE_BLAST_RADIUS + 0.1)).toBe(0);
  });
  it('explosionVictims: by distance, out of range ignored, walls block', () => {
    const w = flat();
    const at = { x: 16, y: 1.5, z: 16 };
    const near = { id: 'near', pose: { x: 16, y: 1, z: 17 } };
    const far = { id: 'far', pose: { x: 16, y: 1, z: 16 + GRENADE_BLAST_RADIUS + 2 } };
    const behind = { id: 'behind', pose: { x: 19, y: 1, z: 16 } };
    for (let y = 1; y < 4; y++) setBlock(w, 18, y, 16, Block.Stone); // wall between `at` and `behind`
    const v = explosionVictims(w, at, [near, far, behind]);
    expect(v.map((x) => x.id)).toEqual(['near']);
    expect(v[0].damage).toBeGreaterThan(70);
  });
});

describe('throwGrenade while crouching', () => {
  it('leaves from the crouched eye', () => {
    const pose = { x: 5, y: 2, z: 5, yaw: 0, pitch: 0 };
    const standing = throwGrenade(pose, 0);
    const crouched = throwGrenade({ ...pose, crouch: true }, 0);
    expect(standing.y).toBeCloseTo(2 + EYE_HEIGHT - 0.1);
    expect(crouched.y).toBeCloseTo(2 + CROUCH_EYE_HEIGHT - 0.1);
    expect(standing.y - crouched.y).toBeCloseTo(EYE_HEIGHT - CROUCH_EYE_HEIGHT);
  });
  it('does not change the throw direction or speed', () => {
    const pose = { x: 5, y: 2, z: 5, yaw: 0.4, pitch: 0.2 };
    const standing = throwGrenade(pose, 0);
    const crouched = throwGrenade({ ...pose, crouch: true }, 0);
    expect(crouched.vx).toBeCloseTo(standing.vx);
    expect(crouched.vy).toBeCloseTo(standing.vy);
    expect(crouched.vz).toBeCloseTo(standing.vz);
  });
});
