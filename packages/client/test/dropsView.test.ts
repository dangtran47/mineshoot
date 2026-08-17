import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MELEE_KINDS } from '@mineshoot/shared';
import { DropsView } from '../src/render/dropsView';

/** World-space bounding box of everything under a drop's root (excluding the beacon/pad). */
function propBox(view: DropsView, id: string): THREE.Box3 {
  view.group.updateMatrixWorld(true);
  const box = new THREE.Box3();
  view.group.traverse((o) => {
    if (o instanceof THREE.Mesh && o.geometry instanceof THREE.BoxGeometry && o.material instanceof THREE.MeshLambertMaterial) {
      box.expandByObject(o);
    }
  });
  return box;
}

describe('DropsView', () => {
  it.each(MELEE_KINDS)('keeps melee kind %i fully above the ground while it bobs', (kind) => {
    const view = new DropsView();
    view.add('d', kind, 10, 5, 10);
    for (let t = 0; t < 4000; t += 250) {
      view.update(t);
      const box = propBox(view, 'd');
      // Ground is at y=5 (the drop's feet position); every part of the prop must float above it.
      expect(box.min.y).toBeGreaterThan(5.15);
      // ...but stay low enough to still read as lying near the ground (well under head height).
      expect(box.max.y).toBeLessThan(6.4);
    }
    view.dispose();
  });
});
