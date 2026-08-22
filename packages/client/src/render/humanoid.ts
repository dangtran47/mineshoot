import * as THREE from 'three';
import { CROUCH_HEIGHT, GUN_NONE, GUN_PISTOL, GUN_TASER, MELEE_SWORD, PLAYER_COLOR_COUNT, PLAYER_HEIGHT, WEAPON_GRENADE, WEAPON_MELEE, WEAPON_PISTOL, WEAPON_PRIMARY, WEAPON_TASER } from '@mineshoot/shared';
import type { GunKind, MeleeKind, SwingAnim, Weapon } from '@mineshoot/shared';
import { HumanoidAnim } from './humanoidAnim';
import { buildGrenadeProp, buildGunProp } from './gunProps';
import { buildMeleeProp, disposeProp } from './meleeProps';
import type { MeleeProp } from './meleeProps';

export const PLAYER_COLORS: readonly number[] = [
  0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0xe67e22, 0x1abc9c, 0xecf0f1,
  0xc0392b, 0x2980b9, 0x27ae60, 0xd35400, 0x8e44ad, 0xf39c12, 0x16a085, 0x95a5a6,
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
/** Crouch squashes the body to this fraction of standing — the same factor playerHitboxes uses, so the model matches the boxes shots are tested against. */
const CROUCH_SQUASH = CROUCH_HEIGHT / PLAYER_HEIGHT;
/** Seconds-ish rate of the crouch ease (exponential approach). */
const CROUCH_RATE = 14;

export class Humanoid {
  readonly group = new THREE.Group();
  /**
   * All body parts live under this, so crouching is one scale.y on the group.
   * The nametag hangs off `group` instead and stays unsquashed.
   */
  private readonly body = new THREE.Group();
  private crouchTarget = 0;
  private crouchT = 0;
  private lastCrouchUpdate = 0;
  private readonly head: THREE.Mesh;
  private readonly legL: THREE.Mesh;
  private readonly legR: THREE.Mesh;
  private readonly armL: THREE.Mesh;
  private readonly armR: THREE.Group;
  /** Gun slot holders: the pistol and the primary (prop swapped by setGun); the grenade in hand. */
  private readonly pistol: THREE.Group;
  private readonly primary: THREE.Group;
  private readonly taserH: THREE.Group;
  private readonly nade: THREE.Group;
  private pistolProp: MeleeProp;
  private primaryProp: MeleeProp;
  private taserProp: MeleeProp;
  private nadeProp: MeleeProp;
  private gunKind: GunKind = GUN_NONE;
  private weapon: Weapon = WEAPON_PISTOL;
  /** Melee slot holder; contains the current melee prop. */
  private readonly sword: THREE.Group;
  private prop: MeleeProp;
  private melee: MeleeKind = MELEE_SWORD;
  private readonly anim = new HumanoidAnim();
  private walkPhase = 0;
  private lastX = 0;
  private lastZ = 0;
  private colorIndex: number;
  /** Body materials repainted on a colour change (team switch): full colour / darkened trim. */
  private readonly bodyMats: THREE.MeshLambertMaterial[] = [];
  private readonly trimMats: THREE.MeshLambertMaterial[] = [];

  constructor(colorIndex: number) {
    this.colorIndex = colorIndex;
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
    const gunHolder = (prop: MeleeProp): THREE.Group => {
      const h = new THREE.Group();
      h.position.set(0, -0.6, 0);
      h.rotation.x = -Math.PI / 2;
      h.add(prop.group);
      return h;
    };
    this.pistolProp = buildGunProp(GUN_PISTOL);
    this.pistol = gunHolder(this.pistolProp);
    this.primaryProp = buildGunProp(GUN_NONE);
    this.primary = gunHolder(this.primaryProp);
    this.taserProp = buildGunProp(GUN_TASER);
    this.taserH = gunHolder(this.taserProp);
    this.nadeProp = buildGrenadeProp();
    this.nade = new THREE.Group();
    this.nade.position.set(0, -0.55, 0);
    this.nade.add(this.nadeProp.group);

    // Melee slot: the sword (or a picked-up drop weapon); its blade glows while charging.
    this.sword = new THREE.Group();
    this.sword.position.set(0, -0.6, 0);
    this.sword.rotation.x = -Math.PI / 2;
    this.prop = buildMeleeProp(MELEE_SWORD);
    this.sword.add(this.prop.group);
    this.armR.add(this.pistol, this.primary, this.taserH, this.nade, this.sword);

    this.head = box(0.45, 0.45, 0.45, SKIN);
    this.head.position.set(0, 1.575, 0);
    const hair = box(0.47, 0.12, 0.47, dark);
    hair.position.set(0, 0.2, 0);
    const eyeL = box(0.08, 0.08, 0.02, 0x222222);
    eyeL.position.set(-0.1, 0.03, -0.23);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.1;
    this.head.add(hair, eyeL, eyeR);

    this.body.add(this.legL, this.legR, torso, this.armL, this.armR, this.head);
    this.group.add(this.body);
    for (const m of [torso, this.armL, armMesh]) this.bodyMats.push(m.material as THREE.MeshLambertMaterial);
    for (const m of [this.legL, this.legR, hair]) this.trimMats.push(m.material as THREE.MeshLambertMaterial);
    this.setWeapon(0);
  }

  /** Repaint body and trim (server-synced `color`; changes on a team switch). */
  setColor(colorIndex: number): void {
    if (colorIndex === this.colorIndex) return;
    this.colorIndex = colorIndex;
    const color = PLAYER_COLORS[colorIndex % PLAYER_COLOR_COUNT];
    const dark = new THREE.Color(color).multiplyScalar(0.55).getHex();
    for (const m of this.bodyMats) m.color.setHex(color);
    for (const m of this.trimMats) m.color.setHex(dark);
  }

  setWeapon(w: Weapon): void {
    this.weapon = w;
    this.pistol.visible = w === WEAPON_PISTOL;
    this.primary.visible = w === WEAPON_PRIMARY;
    this.taserH.visible = w === WEAPON_TASER;
    this.nade.visible = w === WEAPON_GRENADE;
    this.sword.visible = w === WEAPON_MELEE;
    this.anim.setWeapon(w);
  }

  /** Swap the primary gun prop (server-synced `gun` kind). */
  setGun(kind: GunKind): void {
    if (kind === this.gunKind) return;
    this.gunKind = kind;
    disposeProp(this.primaryProp);
    this.primary.clear();
    this.primaryProp = buildGunProp(kind);
    this.primary.add(this.primaryProp.group);
  }

  /** The gun holder + prop for the held slot (null for melee / grenades). */
  private activeGun(): { holder: THREE.Group; prop: MeleeProp } | null {
    if (this.weapon === WEAPON_PISTOL) return { holder: this.pistol, prop: this.pistolProp };
    if (this.weapon === WEAPON_PRIMARY) return { holder: this.primary, prop: this.primaryProp };
    if (this.weapon === WEAPON_TASER) return { holder: this.taserH, prop: this.taserProp };
    return null;
  }

  /** World position of the held gun's barrel tip (tracer origin), or null for melee / grenades. */
  muzzleWorld(out = new THREE.Vector3()): THREE.Vector3 | null {
    const muzzle = this.activeGun()?.prop.muzzle;
    return muzzle ? muzzle.getWorldPosition(out) : null;
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

  /** Server-synced `crouching`: eased in `update`, not snapped. */
  setCrouching(on: boolean): void {
    this.crouchTarget = on ? 1 : 0;
  }

  /** Apply the time-driven weapon-arm animation; call once per frame. */
  update(now: number): void {
    const dt = this.lastCrouchUpdate === 0 ? 0 : Math.min(0.1, (now - this.lastCrouchUpdate) / 1000);
    this.lastCrouchUpdate = now;
    this.crouchT += (this.crouchTarget - this.crouchT) * (1 - Math.exp(-CROUCH_RATE * dt));
    this.body.scale.y = 1 - this.crouchT * (1 - CROUCH_SQUASH);
    const p = this.anim.pose(now);
    this.armR.rotation.x = p.armPitch;
    this.armR.rotation.z = p.armRoll;
    // Wrist bend: the sword group maps prop -z onto the arm at rotation.x = -π/2;
    // adding the tilt swings the blade tip forward/up (same sense as arm pitch), so
    // the blade's absolute pitch is armPitch + bladeTilt.
    this.sword.rotation.x = -Math.PI / 2 + p.bladeTilt;
    for (const m of this.prop.glow) m.emissiveIntensity = p.swordGlow * 1.5;
    const gun = this.activeGun();
    if (gun) {
      gun.holder.position.y = -0.6 + p.gunKick * 0.12; // recoil: gun jolts back up the arm
      for (const m of gun.prop.glow) {
        m.opacity = p.muzzleFlash ? 1 : 0;
        m.emissiveIntensity = p.muzzleFlash ? 1 : 0;
      }
    }
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
