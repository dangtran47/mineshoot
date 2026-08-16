import * as THREE from 'three';
import { PLAYER_COLOR_COUNT, WEAPON_SWORD } from '@mineshoot/shared';
import type { Weapon } from '@mineshoot/shared';

export const PLAYER_COLORS: readonly number[] = [
  0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0xe67e22, 0x1abc9c, 0xecf0f1,
];

const SKIN = 0xf1c27d;
const box = (w: number, h: number, d: number, color: number): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  return m;
};

/**
 * Blocky player: legs, torso, arms, head + a held-weapon prop. Group origin
 * is at the feet; rotate the group for yaw and the head for pitch.
 */
export class Humanoid {
  readonly group = new THREE.Group();
  private readonly head: THREE.Mesh;
  private readonly legL: THREE.Mesh;
  private readonly legR: THREE.Mesh;
  private readonly armL: THREE.Mesh;
  private readonly armR: THREE.Group;
  private readonly gun: THREE.Mesh;
  private readonly sword: THREE.Mesh;
  private walkPhase = 0;
  private lastX = 0;
  private lastZ = 0;

  constructor(colorIndex: number) {
    const color = PLAYER_COLORS[colorIndex % PLAYER_COLOR_COUNT];
    const dark = new THREE.Color(color).multiplyScalar(0.55).getHex();

    this.legL = box(0.25, 0.7, 0.25, dark);
    this.legL.position.set(-0.15, 0.35, 0);
    this.legR = box(0.25, 0.7, 0.25, dark);
    this.legR.position.set(0.15, 0.35, 0);
    const torso = box(0.55, 0.65, 0.3, color);
    torso.position.set(0, 1.025, 0);
    this.armL = box(0.2, 0.6, 0.2, color);
    this.armL.position.set(-0.4, 1.05, 0);

    // Right arm is a pivot group at the shoulder so it can hold the weapon forward.
    this.armR = new THREE.Group();
    this.armR.position.set(0.4, 1.35, 0);
    const armMesh = box(0.2, 0.6, 0.2, color);
    armMesh.position.set(0, -0.3, 0);
    this.armR.add(armMesh);
    this.gun = box(0.08, 0.1, 0.5, 0x333333);
    this.gun.position.set(0, -0.6, -0.25);
    this.sword = box(0.05, 0.08, 0.9, 0xd8dde6);
    this.sword.position.set(0, -0.6, -0.45);
    this.armR.add(this.gun, this.sword);
    this.armR.rotation.x = -Math.PI / 2 + 0.3; // raised, pointing forward

    this.head = box(0.45, 0.45, 0.45, SKIN);
    this.head.position.set(0, 1.575, 0);
    const hair = box(0.47, 0.12, 0.47, dark);
    hair.position.set(0, 0.2, 0);
    const eyeL = box(0.08, 0.08, 0.02, 0x222222);
    eyeL.position.set(-0.1, 0.03, -0.23);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.1;
    this.head.add(hair, eyeL, eyeR);

    this.group.add(this.legL, this.legR, torso, this.armL, this.armR, this.head);
    this.setWeapon(0);
  }

  setWeapon(w: Weapon): void {
    this.gun.visible = w !== WEAPON_SWORD;
    this.sword.visible = w === WEAPON_SWORD;
  }

  setPose(x: number, y: number, z: number, yaw: number, pitch: number, dt: number): void {
    const moved = Math.hypot(x - this.lastX, z - this.lastZ);
    this.lastX = x;
    this.lastZ = z;
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
    this.head.rotation.x = pitch;
    // Walk cycle driven by actual displacement.
    if (moved > 0.001 && dt > 0) this.walkPhase += Math.min(moved / dt, 8) * dt * 2.2;
    const swing = moved > 0.001 ? Math.sin(this.walkPhase) * 0.6 : 0;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing;
    // Legs pivot at the hip: rotate around their top by offsetting.
    this.legL.position.y = 0.35;
    this.legR.position.y = 0.35;
  }

  /** Brief swing animation on the weapon arm. */
  swing(): void {
    this.armR.rotation.x = -Math.PI / 2 - 0.9;
    setTimeout(() => (this.armR.rotation.x = -Math.PI / 2 + 0.3), 180);
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
