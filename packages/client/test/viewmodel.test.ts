import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MELEE_KINDS } from '@mineshoot/shared';
import { ViewModel } from '../src/render/viewmodel';

/** World-space direction of one of the held prop's local axes. */
function propAxis(vm: ViewModel, axis: THREE.Vector3): THREE.Vector3 {
  const camera = new THREE.PerspectiveCamera();
  camera.add(vm.group);
  camera.updateMatrixWorld(true);
  let prop: THREE.Object3D | null = null;
  vm.group.traverse((o) => {
    if (!prop && o.userData.meleeProp) prop = o;
  });
  expect(prop).not.toBeNull();
  return axis.clone().transformDirection(prop!.matrixWorld);
}

describe('ViewModel melee mount', () => {
  it.each(MELEE_KINDS)('holds kind %i tip up with the edge / head facing forward', (kind) => {
    const vm = new ViewModel(new THREE.PerspectiveCamera());
    vm.setMelee(kind);
    vm.update(0, false);
    const edge = propAxis(vm, new THREE.Vector3(0, -1, 0));
    const tip = propAxis(vm, new THREE.Vector3(0, 0, -1));
    expect(edge.z).toBeLessThan(-0.7); // cutting edge / pick point / axe bit toward the target
    expect(Math.abs(edge.x)).toBeLessThan(0.5); // …not sideways across the screen
    expect(tip.y).toBeGreaterThan(0.8); // tip up
  });

  it.each(MELEE_KINDS)('holds kind %i with the tip above eye level, not pointing at the horizon', (kind) => {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    vm.setMelee(kind);
    vm.update(0, false);
    camera.updateMatrixWorld(true);
    const box = new THREE.Box3();
    vm.group.traverse((o) => {
      if (o.userData.meleeProp) box.setFromObject(o);
    });
    expect(box.max.y).toBeGreaterThan(0.08); // camera-relative: clearly above the horizon
    expect(box.min.x).toBeGreaterThan(0.05); // stays out of the crosshair
  });
});

describe('ViewModel overhead chop', () => {
  it('chops forward from a full charge: the tip never swings back behind the camera', () => {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    vm.setCharge(1);
    vm.update(0, false);
    vm.swing('overhead');
    let minZ = 1;
    let sawForward = false;
    for (let i = 0; i < 25; i++) {
      vm.update(0.01, false);
      camera.updateMatrixWorld(true);
      const tip = propAxis(vm, new THREE.Vector3(0, 0, -1));
      minZ = Math.min(minZ, tip.z);
      if (tip.z < -0.9) sawForward = true;
      // A tip pointing hard backwards (+z toward the camera) and down means the blade went the wrong way round.
      expect(!(tip.z > 0.5 && tip.y < -0.3)).toBe(true);
    }
    expect(sawForward).toBe(true);
    expect(minZ).toBeLessThan(-0.9);
  });
});
