import * as THREE from 'three';
import { MELEE_SWORD, WEAPON_SWORD } from '@mineshoot/shared';
import type { MeleeKind, SwingAnim, Weapon } from '@mineshoot/shared';
import { buildMeleeProp, disposeProp } from './meleeProps';
import type { MeleeProp } from './meleeProps';

/*
 * Melee rest pose (sword slot rotation): a slight forward lean plus an outward yaw/roll so the weapon
 * stands up in the hand at the bottom-right with its tip well above the horizon. A steeper lean puts
 * the tip at eye level, which reads as "lying flat on the ground, pointing at the crosshair".
 */
const REST_PITCH = -0.25;
const REST_YAW = -0.35;
const REST_ROLL = -0.3;

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Q_A = new THREE.Quaternion();
const Q_B = new THREE.Quaternion();
const Q_C = new THREE.Quaternion();
const Q_D = new THREE.Quaternion();
const TMP_V = new THREE.Vector3();
const easeIn = (t: number): number => t * t;
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

/** Rest / overhead key poses (sword-slot local): wound up behind the shoulder, then chopped down through the centre. */
const REST_POS = new THREE.Vector3(0, 0, 0);
const WINDUP_Q = new THREE.Quaternion().setFromAxisAngle(X_AXIS, REST_PITCH + 1.0)
  .multiply(new THREE.Quaternion().setFromAxisAngle(Y_AXIS, REST_YAW * 0.5));
const WINDUP_POS = new THREE.Vector3(0.1, 0.16, 0.12);
const CHOP_Q = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, 0.5)
  .multiply(new THREE.Quaternion().setFromAxisAngle(X_AXIS, -2.45));
/*
 * Wind-up → chop is a >180° turn; a single slerp would take the short way round (backwards over the
 * head), so the chop passes through this forward-pointing midpoint.
 */
const CHOP_MID_Q = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, 0.25)
  .multiply(new THREE.Quaternion().setFromAxisAngle(X_AXIS, -0.85));
const CHOP_MID_POS = new THREE.Vector3(-0.1, 0.06, -0.15);
const CHOP_POS = new THREE.Vector3(-0.32, -0.12, -0.28);

const box = (w: number, h: number, d: number, color: number): THREE.Mesh =>
  new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));

/** First-person weapon attached to the camera (bottom-right), with recoil / swing. */
export class ViewModel {
  readonly group = new THREE.Group();
  private readonly gun = new THREE.Group();
  /** Melee slot: rotated/bobbed as a whole; holds the current melee prop. */
  private readonly sword = new THREE.Group();
  private prop: MeleeProp;
  private melee: MeleeKind = MELEE_SWORD;
  private readonly restQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(REST_PITCH, REST_YAW, REST_ROLL));
  private readonly flash: THREE.Mesh;
  private recoil = 0;
  private swingT = -1;
  private swingAnim: SwingAnim = 'overhead';
  /** Pose the current swing started from (so a charged wind-up flows straight into the chop). */
  private readonly startQ = new THREE.Quaternion();
  private readonly startPos = new THREE.Vector3();
  /** Fraction of the overhead swing spent winding up; shrinks with the charge already held. */
  private swingWindup = 0.25;
  /** Which way the next slash goes (+1 = right-to-left, -1 = left-to-right); flips every slash. */
  private slashSide = 1;
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

    // Melee prop (modelled along -Z at humanoid scale): stand it up (+Y) and shrink it for the hand.
    this.prop = buildMeleeProp(MELEE_SWORD);
    this.sword.add(this.mount(this.prop));
    this.sword.rotation.set(REST_PITCH, REST_YAW, REST_ROLL);

    // Local light so Lambert materials on the view model read well.
    const light = new THREE.PointLight(0xffffff, 1.5, 3);
    light.position.set(-0.3, 0.6, 0.4);
    this.group.add(this.gun, this.sword, light);
    this.group.position.set(0.34, -0.22, -0.55);
    this.group.scale.setScalar(0.55);
    camera.add(this.group);
    this.setWeapon(0);
  }

  private mount(prop: MeleeProp): THREE.Group {
    const holder = new THREE.Group();
    // Stand the prop up: tip (-Z) → +Y, edge / head (-Y) → -Z, i.e. the cutting edge, axe bit and
    // pick point face forward, toward whatever we are about to hit; the flat of the blade is seen
    // three-quarter on thanks to the rest yaw/roll.
    holder.rotation.set(Math.PI / 2, 0, 0);
    holder.scale.setScalar(0.5);
    holder.add(prop.group);
    return holder;
  }

  setWeapon(w: Weapon): void {
    this.gun.visible = w !== WEAPON_SWORD;
    this.sword.visible = w === WEAPON_SWORD;
  }

  /** Swap the melee prop (sword ↔ a picked-up drop weapon). */
  setMelee(kind: MeleeKind): void {
    if (kind === this.melee) return;
    this.melee = kind;
    disposeProp(this.prop);
    this.sword.clear();
    this.prop = buildMeleeProp(kind);
    this.sword.add(this.mount(this.prop));
  }

  fire(): void {
    this.recoil = 1;
    (this.flash.material as THREE.MeshBasicMaterial).opacity = 1;
  }

  /** Play a melee attack: `slash` alternates sides, `overhead` chops down. */
  swing(anim: SwingAnim = 'overhead'): void {
    this.swingT = 0;
    this.swingAnim = anim;
    if (anim === 'slash') this.slashSide = -this.slashSide;
    this.startQ.copy(this.sword.quaternion);
    this.startPos.copy(this.sword.position);
    this.swingWindup = Math.max(0.02, 0.25 * (1 - easeOut(this.charge)));
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

    // Melee attack animation (~250 ms). Poses are built as quaternions: the holder gives tip = +Y,
    // edge = -Z, so Ry is a roll about the blade, Rx tips it forward, and an outer Ry sweeps it
    // around the vertical axis. Every swing starts from wherever the weapon currently is
    // (`startQ`/`startPos`, e.g. the charged wind-up), never from the rest pose.
    if (this.swingT >= 0) {
      this.swingT += dt / 0.25;
      const p = Math.min(1, this.swingT);
      if (this.swingAnim === 'slash') {
        // Horizontal cut: blade laid forward with its edge leading, swept wide across the view
        // around the vertical axis (~170°); side alternates each swing.
        const side = this.slashSide;
        const sweep = -side * 1.5 * Math.cos(p * Math.PI); // outboard → across the centre → far side
        const q = Q_A.setFromAxisAngle(Y_AXIS, sweep)
          .multiply(Q_B.setFromAxisAngle(X_AXIS, -1.35))
          .multiply(Q_C.setFromAxisAngle(Y_AXIS, side * Math.PI / 2));
        const w = p < 0.2 ? easeOut(p / 0.2) : p > 0.75 ? 1 - easeIn((p - 0.75) / 0.25) : 1;
        this.sword.quaternion.copy(p < 0.2 ? this.startQ : this.restQ).slerp(q, w);
        const from = p < 0.2 ? this.startPos : REST_POS;
        this.sword.position.lerpVectors(from, TMP_V.set(-0.28 + sweep * 0.12, 0.05, -0.2), w);
      } else {
        // Overhead chop: wind up high over the shoulder (skipped when already charged), then bring
        // the edge down hard through the centre and recover.
        const wind = this.swingWindup;
        const chopEnd = wind + 0.4;
        if (p < wind) {
          const t = easeOut(p / wind);
          this.sword.quaternion.copy(this.startQ).slerp(WINDUP_Q, t);
          this.sword.position.lerpVectors(this.startPos, WINDUP_POS, t);
        } else if (p < chopEnd) {
          const t = easeIn((p - wind) / 0.4);
          if (t < 0.5) {
            this.sword.quaternion.copy(WINDUP_Q).slerp(CHOP_MID_Q, t * 2);
            this.sword.position.lerpVectors(WINDUP_POS, CHOP_MID_POS, t * 2);
          } else {
            this.sword.quaternion.copy(CHOP_MID_Q).slerp(CHOP_Q, t * 2 - 1);
            this.sword.position.lerpVectors(CHOP_MID_POS, CHOP_POS, t * 2 - 1);
          }
        } else {
          const t = easeOut((p - chopEnd) / (1 - chopEnd));
          this.sword.quaternion.copy(CHOP_Q).slerp(this.restQ, t);
          this.sword.position.lerpVectors(CHOP_POS, REST_POS, t);
        }
      }
      if (p >= 1) this.swingT = -1;
    } else {
      // Rest pose; while charging the weapon is drawn up into the overhead wind-up so the release
      // continues straight into the chop.
      const c = easeOut(this.charge);
      this.sword.quaternion.copy(this.restQ).slerp(WINDUP_Q, c);
      this.sword.position.lerpVectors(REST_POS, WINDUP_POS, c);
    }

    // Walk bob
    if (moving) this.bob += dt * 9;
    const bobAmt = moving ? 1 : 0;
    this.group.position.x = 0.34 + Math.sin(this.bob) * 0.012 * bobAmt;
    this.group.position.y = -0.22 + Math.abs(Math.cos(this.bob)) * 0.015 * bobAmt;
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
