import * as THREE from 'three';
import { MELEE_SWORD, PLAYER_COLOR_COUNT, WEAPON_SWORD } from '@mineshoot/shared';
import type { MeleeKind, SwingAnim, Weapon } from '@mineshoot/shared';
import { HumanoidAnim } from './humanoidAnim';
import { buildMeleeProp, disposeProp } from './meleeProps';
import type { MeleeProp } from './meleeProps';

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
  private readonly gun: THREE.Group;
  private readonly muzzle: THREE.Mesh;
  /** Melee slot holder; contains the current melee prop. */
  private readonly sword: THREE.Group;
  private prop: MeleeProp;
  private melee: MeleeKind = MELEE_SWORD;
  private readonly anim = new HumanoidAnim();
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
    // Props are modelled along -z and the holder groups are rotated so -z runs along the
    // arm (local -y): a level arm points the weapon forward, a raised arm points it up.
    // Gun: chunky dark body + barrel + a muzzle flash that only shows for a frame or two.
    this.gun = new THREE.Group();
    this.gun.position.set(0, -0.6, 0);
    this.gun.rotation.x = -Math.PI / 2;
    const gunBody = box(0.12, 0.16, 0.45, 0x2b2b2b);
    gunBody.position.set(0, 0, -0.15);
    const barrel = box(0.06, 0.06, 0.4, 0x555555);
    barrel.position.set(0, 0.03, -0.55);
    const grip = box(0.08, 0.16, 0.08, 0x3a2a1a);
    grip.position.set(0, -0.14, 0.02);
    this.muzzle = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.22, 0.22),
      new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.95 }),
    );
    this.muzzle.position.set(0, 0.03, -0.85);
    this.muzzle.visible = false;
    this.gun.add(gunBody, barrel, grip, this.muzzle);

    // Melee slot: the sword (or a picked-up drop weapon); its blade glows while charging.
    this.sword = new THREE.Group();
    this.sword.position.set(0, -0.6, 0);
    this.sword.rotation.x = -Math.PI / 2;
    this.prop = buildMeleeProp(MELEE_SWORD);
    this.sword.add(this.prop.group);
    this.armR.add(this.gun, this.sword);

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
    this.anim.setWeapon(w);
  }

  /** Swap the melee prop (server-synced `melee` kind). */
  setMelee(kind: MeleeKind): void {
    if (kind === this.melee) return;
    this.melee = kind;
    disposeProp(this.prop);
    this.prop = buildMeleeProp(kind);
    this.sword.add(this.prop.group);
    this.anim.setMelee(kind);
  }

  /** Sword charge held (server-synced flag). */
  setCharging(on: boolean, now: number): void {
    this.anim.setCharging(on, now);
  }

  /** Gun reload in progress (server-synced flag). */
  setReloading(on: boolean): void {
    this.anim.setReloading(on);
  }

  /** Melee attack (hit or miss). */
  swing(now: number, anim: SwingAnim, heavy: boolean): void {
    this.anim.swing(now, anim, heavy);
  }

  /** Gun fired: recoil kick + muzzle flash. */
  shot(now: number): void {
    this.anim.shot(now);
  }

  /** Apply the time-driven weapon-arm animation; call once per frame. */
  update(now: number): void {
    const p = this.anim.pose(now);
    this.armR.rotation.x = p.armPitch;
    this.armR.rotation.z = p.armRoll;
    for (const m of this.prop.glow) m.emissiveIntensity = p.swordGlow * 1.5;
    this.gun.position.y = -0.6 + p.gunKick * 0.12; // recoil: gun jolts back up the arm
    this.muzzle.visible = p.muzzleFlash;
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

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
