import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GUN_SNIPER, MELEE_KINDS, WEAPON_GRENADE, WEAPON_MELEE, WEAPON_PRIMARY } from '@mineshoot/shared';
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

describe('ViewModel gun kick', () => {
  /** The visible gun holder group (pistol by default; the light and hidden slots are filtered out). */
  function visibleHolder(vm: ViewModel): THREE.Object3D {
    const holder = vm.group.children.find((o) => o.visible && o.type === 'Group');
    expect(holder).toBeDefined();
    return holder!;
  }

  it('fire intensity scales the prop kick (heavy guns punch harder than light ones)', () => {
    const light = new ViewModel(new THREE.PerspectiveCamera());
    light.fire(0.7);
    light.update(0.001, false);
    const heavy = new ViewModel(new THREE.PerspectiveCamera());
    heavy.fire(1.6);
    heavy.update(0.001, false);
    expect(visibleHolder(heavy).position.z).toBeGreaterThan(visibleHolder(light).position.z * 2);
  });

  it('fire without an intensity keeps the classic kick', () => {
    const vm = new ViewModel(new THREE.PerspectiveCamera());
    vm.fire();
    vm.update(0.001, false);
    expect(visibleHolder(vm).position.z).toBeCloseTo((1 - 0.001 * 8) * 0.12);
  });
});

describe('ViewModel muzzle', () => {
  it('muzzleWorld sits at the held gun, in front of and offset from the camera', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(3, 5, 7);
    const vm = new ViewModel(camera); // pistol out by default
    camera.updateMatrixWorld(true);
    const m = vm.muzzleWorld(new THREE.Vector3());
    expect(m).not.toBeNull();
    expect(m!.distanceTo(camera.position)).toBeLessThan(1.5); // in the hand, not at the hit point
    expect(m!.z).toBeLessThan(camera.position.z); // in front (camera looks down -z)
  });

  it('follows the primary gun prop when that slot is out', () => {
    const camera = new THREE.PerspectiveCamera();
    const vm = new ViewModel(camera);
    vm.setGun(GUN_SNIPER);
    vm.setWeapon(WEAPON_PRIMARY);
    camera.updateMatrixWorld(true);
    const pistolTip = new ViewModel(new THREE.PerspectiveCamera()).muzzleWorld(new THREE.Vector3());
    const sniperTip = vm.muzzleWorld(new THREE.Vector3());
    expect(sniperTip).not.toBeNull();
    expect(sniperTip!.z).toBeLessThan(pistolTip!.z); // longer barrel reaches further forward
  });

  it('is null with melee or a grenade in hand', () => {
    const vm = new ViewModel(new THREE.PerspectiveCamera());
    vm.setWeapon(WEAPON_MELEE);
    expect(vm.muzzleWorld(new THREE.Vector3())).toBeNull();
    vm.setWeapon(WEAPON_GRENADE);
    expect(vm.muzzleWorld(new THREE.Vector3())).toBeNull();
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
