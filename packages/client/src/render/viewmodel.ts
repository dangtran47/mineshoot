import * as THREE from 'three';
import { WEAPON_SWORD } from '@mineshoot/shared';
import type { Weapon } from '@mineshoot/shared';

const box = (w: number, h: number, d: number, color: number): THREE.Mesh =>
  new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));

/** First-person weapon attached to the camera (bottom-right), with recoil / swing. */
export class ViewModel {
  readonly group = new THREE.Group();
  private readonly gun = new THREE.Group();
  private readonly sword = new THREE.Group();
  private readonly flash: THREE.Mesh;
  private recoil = 0;
  private swingT = -1;
  private charge = 0;
  private reload = 0;
  private bob = 0;

  constructor(camera: THREE.Camera) {
    // Gun: body + barrel + grip
    const body = box(0.06, 0.08, 0.26, 0x8a919c);
    const barrel = box(0.03, 0.03, 0.2, 0x4b5059);
    barrel.position.set(0, 0.02, -0.22);
    const grip = box(0.05, 0.11, 0.06, 0x8a5a2b);
    grip.position.set(0, -0.08, 0.08);
    grip.rotation.x = 0.3;
    this.flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd766, transparent: true, opacity: 0 }),
    );
    this.flash.position.set(0, 0.02, -0.34);
    this.gun.add(body, barrel, grip, this.flash);

    // Sword: blade + guard + handle
    const blade = box(0.04, 0.55, 0.015, 0xe3e8f0);
    blade.position.set(0, 0.33, 0);
    const guard = box(0.16, 0.04, 0.04, 0xc9a24a);
    const handle = box(0.04, 0.16, 0.04, 0x6b4423);
    handle.position.set(0, -0.1, 0);
    this.sword.add(blade, guard, handle);
    this.sword.rotation.set(-0.5, 0.2, 0.15);

    // Local light so Lambert materials on the view model read well.
    const light = new THREE.PointLight(0xffffff, 1.5, 3);
    light.position.set(-0.3, 0.6, 0.4);
    this.group.add(this.gun, this.sword, light);
    this.group.position.set(0.3, -0.26, -0.6);
    this.group.scale.setScalar(0.55);
    camera.add(this.group);
    this.setWeapon(0);
  }

  setWeapon(w: Weapon): void {
    this.gun.visible = w !== WEAPON_SWORD;
    this.sword.visible = w === WEAPON_SWORD;
  }

  fire(): void {
    this.recoil = 1;
    (this.flash.material as THREE.MeshBasicMaterial).opacity = 1;
  }

  swing(): void {
    this.swingT = 0;
    this.charge = 0;
  }

  /** 0..1 sword charge: the blade is drawn back and raised as it fills. */
  setCharge(fraction: number | null): void {
    this.charge = fraction ?? 0;
  }

  /** 0..1 gun reload: the gun dips out of view and tilts, then comes back up. */
  setReload(fraction: number | null): void {
    this.reload = fraction ?? 0;
  }

  update(dt: number, moving: boolean): void {
    // Recoil kick and muzzle flash decay
    this.recoil = Math.max(0, this.recoil - dt * 8);
    const flashMat = this.flash.material as THREE.MeshBasicMaterial;
    flashMat.opacity = Math.max(0, flashMat.opacity - dt * 14);
    const dip = Math.sin(Math.min(1, this.reload) * Math.PI); // 0 → 1 → 0 across the reload
    this.gun.position.z = this.recoil * 0.12;
    this.gun.position.y = -dip * 0.22;
    this.gun.rotation.x = this.recoil * 0.25 - dip * 0.6;
    this.gun.rotation.z = dip * 0.5;

    // Sword swing arc (~250 ms)
    if (this.swingT >= 0) {
      this.swingT += dt / 0.25;
      const p = Math.min(1, this.swingT);
      const arc = Math.sin(p * Math.PI);
      this.sword.rotation.set(-0.5 - arc * 1.6, 0.2 - arc * 0.9, 0.15);
      this.sword.position.set(-arc * 0.25, 0, -arc * 0.15);
      if (p >= 1) this.swingT = -1;
    } else {
      // Rest pose, wound back while charging.
      const c = this.charge;
      this.sword.rotation.set(-0.5 + c * 0.9, 0.2 + c * 0.5, 0.15 - c * 0.3);
      this.sword.position.set(c * 0.12, c * 0.08, c * 0.1);
    }

    // Walk bob
    if (moving) this.bob += dt * 9;
    const bobAmt = moving ? 1 : 0;
    this.group.position.x = 0.3 + Math.sin(this.bob) * 0.012 * bobAmt;
    this.group.position.y = -0.26 + Math.abs(Math.cos(this.bob)) * 0.015 * bobAmt;
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.group.removeFromParent();
  }
}
