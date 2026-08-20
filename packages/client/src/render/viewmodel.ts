import * as THREE from 'three';
import { GUN_NONE, GUN_PISTOL, GUN_TASER, MELEE_SWORD, WEAPON_GRENADE, WEAPON_MELEE, WEAPON_PISTOL, WEAPON_PRIMARY, WEAPON_TASER } from '@mineshoot/shared';
import type { GunKind, MeleeKind, SwingAnim, Weapon } from '@mineshoot/shared';
import { buildGrenadeProp, buildGunProp } from './gunProps';
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
  /** Gun slots: the pistol (slot 2) and the primary (slot 1, prop swapped by setGun). */
  private readonly pistol = new THREE.Group();
  private readonly primary = new THREE.Group();
  private readonly taserH = new THREE.Group();
  private readonly nade = new THREE.Group();
  private pistolProp: MeleeProp;
  private primaryProp: MeleeProp;
  private taserProp: MeleeProp;
  private nadeProp: MeleeProp;
  private gunKind: GunKind = GUN_NONE;
  private slot: Weapon = WEAPON_PISTOL;
  /** Melee slot: rotated/bobbed as a whole; holds the current melee prop. */
  private readonly sword = new THREE.Group();
  private prop: MeleeProp;
  private melee: MeleeKind = MELEE_SWORD;
  private readonly restQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(REST_PITCH, REST_YAW, REST_ROLL));
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
    // Gun props (grip at origin, barrel down -Z, humanoid scale): shrink into the hand.
    this.pistolProp = buildGunProp(GUN_PISTOL);
    this.pistol.add(this.mountGun(this.pistolProp));
    this.primaryProp = buildGunProp(GUN_NONE);
    this.primary.add(this.mountGun(this.primaryProp));
    this.taserProp = buildGunProp(GUN_TASER);
    this.taserH.add(this.mountGun(this.taserProp));
    this.nadeProp = buildGrenadeProp();
    const nadeHolder = new THREE.Group();
    nadeHolder.scale.setScalar(0.5);
    nadeHolder.position.set(-0.05, -0.05, 0.05);
    nadeHolder.add(this.nadeProp.group);
    this.nade.add(nadeHolder);

    // Melee prop (modelled along -Z at humanoid scale): stand it up (+Y) and shrink it for the hand.
    this.prop = buildMeleeProp(MELEE_SWORD);
    this.sword.add(this.mount(this.prop));
    this.sword.rotation.set(REST_PITCH, REST_YAW, REST_ROLL);

    // Local light so Lambert materials on the view model read well.
    const light = new THREE.PointLight(0xffffff, 1.5, 3);
    light.position.set(-0.3, 0.6, 0.4);
    this.group.add(this.pistol, this.primary, this.taserH, this.nade, this.sword, light);
    this.group.position.set(0.34, -0.22, -0.55);
    this.group.scale.setScalar(0.55);
    camera.add(this.group);
    this.setWeapon(WEAPON_PISTOL);
  }

  private mountGun(prop: MeleeProp): THREE.Group {
    const holder = new THREE.Group();
    holder.scale.setScalar(0.5);
    holder.position.set(0, -0.02, 0.05);
    holder.add(prop.group);
    return holder;
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
    this.slot = w;
    this.pistol.visible = w === WEAPON_PISTOL;
    this.primary.visible = w === WEAPON_PRIMARY;
    this.taserH.visible = w === WEAPON_TASER;
    this.nade.visible = w === WEAPON_GRENADE;
    this.sword.visible = w === WEAPON_MELEE;
  }

  /** Swap the primary gun prop (server-driven: pickup / respawn / spent taser). */
  setGun(kind: GunKind): void {
    if (kind === this.gunKind) return;
    this.gunKind = kind;
    disposeProp(this.primaryProp);
    this.primary.clear();
    this.primaryProp = buildGunProp(kind);
    this.primary.add(this.mountGun(this.primaryProp));
  }

  /** The gun holder + prop the current slot shows (null for melee / grenades). */
  private activeGun(): { holder: THREE.Group; prop: MeleeProp } | null {
    if (this.slot === WEAPON_PISTOL) return { holder: this.pistol, prop: this.pistolProp };
    if (this.slot === WEAPON_PRIMARY) return { holder: this.primary, prop: this.primaryProp };
    if (this.slot === WEAPON_TASER) return { holder: this.taserH, prop: this.taserProp };
    return null;
  }

  /** World position of the held gun's barrel tip (tracer origin), or null for melee / grenades. */
  muzzleWorld(out = new THREE.Vector3()): THREE.Vector3 | null {
    const muzzle = this.activeGun()?.prop.muzzle;
    return muzzle ? muzzle.getWorldPosition(out) : null;
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

  /** `intensity` scales the kick (heavy guns punch harder; 1 = the classic pistol kick). */
  fire(intensity = 1): void {
    this.recoil = intensity;
    for (const m of this.activeGun()?.prop.glow ?? []) {
      m.opacity = 1;
      m.emissiveIntensity = 1;
    }
  }

  /** Grenade throw: quick forward flick of the hand. */
  throwAnim(): void {
    this.recoil = 1;
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
    for (const prop of [this.pistolProp, this.primaryProp, this.taserProp]) {
      for (const m of prop.glow) {
        m.opacity = Math.max(0, m.opacity - dt * 14);
        m.emissiveIntensity = m.opacity;
      }
    }
    const dip = Math.sin(Math.min(1, this.reload) * Math.PI); // 0 → 1 → 0 across the reload
    const gun = this.activeGun()?.holder;
    if (gun) {
      gun.position.z = this.recoil * 0.12;
      gun.position.y = -dip * 0.22;
      gun.rotation.x = this.recoil * 0.25 - dip * 0.6;
      gun.rotation.z = dip * 0.5;
    }
    // Grenade in hand: the throw flick reuses the recoil envelope.
    this.nade.position.z = -this.recoil * 0.25;
    this.nade.rotation.x = this.recoil * 0.8;

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
