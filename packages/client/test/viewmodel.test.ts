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
  it.each(MELEE_KINDS)('shows kind %i in profile: edge (-y) sideways, flat (x) facing the camera', (kind) => {
    const vm = new ViewModel(new THREE.PerspectiveCamera());
    vm.setMelee(kind);
    vm.update(0, false);
    const edge = propAxis(vm, new THREE.Vector3(0, -1, 0));
    const flat = propAxis(vm, new THREE.Vector3(1, 0, 0));
    const tip = propAxis(vm, new THREE.Vector3(0, 0, -1));
    expect(Math.abs(edge.x)).toBeGreaterThan(0.7); // edge/head runs across the screen…
    expect(Math.abs(flat.z)).toBeGreaterThan(0.7); // …so the broad side faces the viewer
    expect(tip.y).toBeGreaterThan(0.5); // tip up
  });
});
