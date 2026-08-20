import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GUN_KINDS, GUN_NONE, GUN_SHOTGUN, MELEE_AXE, WEAPON_GRENADE, WEAPON_MELEE, WEAPON_PRIMARY } from '@mineshoot/shared';
import { PROP_LENGTH, buildDropProp, buildGrenadeProp, buildGunProp } from '../src/render/gunProps';
import { disposeProp } from '../src/render/meleeProps';

describe('gunProps', () => {
  it('builds a distinct mesh group for every gun kind, pointing down -Z', () => {
    const seen = new Set<number>();
    for (const k of GUN_KINDS) {
      const p = buildGunProp(k);
      let meshes = 0;
      p.group.traverse((o) => {
        if (o instanceof THREE.Mesh) meshes++;
      });
      expect(meshes).toBeGreaterThan(1);
      const box = new THREE.Box3().setFromObject(p.group);
      expect(box.min.z).toBeLessThan(-0.3);
      expect(box.max.z).toBeLessThanOrEqual(0.31);
      seen.add(meshes * 100 + Math.round(-box.min.z * 100));
      disposeProp(p);
    }
    expect(seen.size).toBe(GUN_KINDS.length); // no two kinds look identical
    expect(buildGunProp(GUN_NONE).group.children).toHaveLength(0);
  });
  it('exposes the muzzle at the barrel tip of every real gun (tracers start there)', () => {
    for (const k of GUN_KINDS) {
      const p = buildGunProp(k);
      expect(p.muzzle, `gun kind ${k}`).toBeDefined();
      // The tip sits at (or just past) the end of the prop, on the barrel axis.
      expect(p.muzzle!.position.z).toBeLessThanOrEqual(-(PROP_LENGTH[k] - 0.15));
      disposeProp(p);
    }
    expect(buildGunProp(GUN_NONE).muzzle).toBeUndefined();
  });
  it('grenade prop is a small ball; buildDropProp routes by slot', () => {
    const g = buildGrenadeProp();
    const box = new THREE.Box3().setFromObject(g.group);
    expect(box.max.y - box.min.y).toBeLessThan(0.5);
    expect(buildDropProp(WEAPON_PRIMARY, GUN_SHOTGUN).group.userData.gunProp).toBe(true);
    expect(buildDropProp(WEAPON_MELEE, MELEE_AXE).group.userData.meleeProp).toBe(true);
    expect(buildDropProp(WEAPON_GRENADE, 2).group.userData.grenadeProp).toBe(true);
  });
});
