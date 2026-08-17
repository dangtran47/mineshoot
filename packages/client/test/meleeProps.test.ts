import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MELEE_KINDS } from '@mineshoot/shared';
import { buildMeleeProp } from '../src/render/meleeProps';

describe('melee props', () => {
  // Every prop is modelled grip-at-origin along -z with its edge / head / profile in the Y/Z plane
  // (edge on -y): holders rely on this to lead a chop with the edge and to face the profile at the camera.
  it.each(MELEE_KINDS)('kind %i is long along -z and flat across x', (kind) => {
    const { group } = buildMeleeProp(kind);
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    expect(box.min.z).toBeLessThan(-1.0);
    expect(box.max.z).toBeLessThan(0.2);
    expect(box.max.x - box.min.x).toBeLessThan(0.2); // no wide part sticks out sideways
    expect(box.max.y - box.min.y).toBeGreaterThanOrEqual(box.max.x - box.min.x); // profile spans y, not x
  });
});
