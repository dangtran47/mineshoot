import * as THREE from 'three';
import { WEAPON_GRENADE, WEAPON_MELEE } from '@mineshoot/shared';
import type { GunKind, Weapon } from '@mineshoot/shared';
import { PROP_LENGTH, buildDropProp } from './gunProps';
import { disposeProp } from './meleeProps';
import type { MeleeProp } from './meleeProps';

interface DropView {
  root: THREE.Group;
  prop: MeleeProp;
  /** Tilted, centred holder for the prop; bobs up and down. */
  pivot: THREE.Group;
  beacon: THREE.Mesh;
  phase: number;
}

const BEACON_COLOR = 0xffd766;
/** Grenade packs glow green so they read differently from weapons. */
const NADE_COLOR = 0x9be36b;
/** Hover height of the weapon's centre above the drop's feet position. */
const HOVER_Y = 0.75;
const BOB_AMP = 0.08;
/** Lying almost flat, tip raised a little so it reads as a weapon and never dips into the ground. */
const TILT = 0.35;
/** Props are modelled grip-at-origin along -z (~1.2–1.5 long); shift so the middle sits on the spin axis. */
const CENTER_Z = 0.7;
/**
 * Roll the prop onto its side: heads/edges are modelled on ±y (down when held), so a quarter
 * turn lays axe bits, scythe blades and pick points flat — visible in profile as the drop
 * spins, and not hanging down into the ground.
 */
const ROLL = Math.PI / 2;

/** The light column peeks just above the hovering weapon — a marker, not a skyline beacon. */
const BEACON_HEIGHT = 1.5;

/**
 * Weapon drops lying in the arena: the weapon prop hovering just above the
 * ground, slowly spinning and bobbing, inside a short translucent light
 * column that rises just past the weapon itself.
 */
export class DropsView {
  readonly group = new THREE.Group();
  private readonly drops = new Map<string, DropView>();
  private readonly beaconGeo = new THREE.BoxGeometry(0.35, BEACON_HEIGHT, 0.35);
  private readonly beaconMat = new THREE.MeshBasicMaterial({ color: BEACON_COLOR, transparent: true, opacity: 0.3, depthWrite: false });
  private readonly nadeBeaconMat = new THREE.MeshBasicMaterial({ color: NADE_COLOR, transparent: true, opacity: 0.3, depthWrite: false });
  private readonly padGeo = new THREE.BoxGeometry(1.0, 0.06, 1.0);
  private readonly padMat = new THREE.MeshBasicMaterial({ color: BEACON_COLOR, transparent: true, opacity: 0.55, depthWrite: false });
  private readonly nadePadMat = new THREE.MeshBasicMaterial({ color: NADE_COLOR, transparent: true, opacity: 0.55, depthWrite: false });

  has(id: string): boolean {
    return this.drops.has(id);
  }

  add(id: string, slot: Weapon, kind: number, x: number, y: number, z: number): void {
    if (this.drops.has(id)) return;
    const root = new THREE.Group();
    root.position.set(x, y, z);
    const prop = buildDropProp(slot, kind);
    // Lay the weapon nearly flat (tip slightly up), centred on the spin axis, hovering at knee height.
    // Grenade packs just hover upright a little lower.
    const pivot = new THREE.Group();
    pivot.position.set(0, slot === WEAPON_GRENADE ? HOVER_Y - 0.2 : HOVER_Y, 0);
    if (slot !== WEAPON_GRENADE) {
      pivot.rotation.x = TILT;
      prop.group.position.z = slot === WEAPON_MELEE ? CENTER_Z : PROP_LENGTH[kind as GunKind] / 2;
    }
    if (slot === WEAPON_MELEE) prop.group.rotation.z = ROLL;
    pivot.add(prop.group);
    root.add(pivot);
    const nade = slot === WEAPON_GRENADE;
    const beacon = new THREE.Mesh(this.beaconGeo, nade ? this.nadeBeaconMat : this.beaconMat);
    beacon.position.set(0, BEACON_HEIGHT / 2, 0);
    const pad = new THREE.Mesh(this.padGeo, nade ? this.nadePadMat : this.padMat);
    pad.position.set(0, 0.04, 0);
    root.add(beacon, pad);
    this.group.add(root);
    this.drops.set(id, { root, prop, pivot, beacon, phase: (x * 7 + z * 13) % 6.28 });
  }

  remove(id: string): void {
    const d = this.drops.get(id);
    if (!d) return;
    this.group.remove(d.root);
    disposeProp(d.prop);
    this.drops.delete(id);
  }

  /** Drop everything not in `ids` (state diff). */
  retain(ids: Set<string>): void {
    for (const id of [...this.drops.keys()]) if (!ids.has(id)) this.remove(id);
  }

  update(now: number): void {
    const t = now / 1000;
    for (const d of this.drops.values()) {
      d.root.rotation.y = t * 1.6 + d.phase;
      d.pivot.position.y = HOVER_Y + Math.sin(t * 2.2 + d.phase) * BOB_AMP;
    }
  }

  dispose(): void {
    for (const id of [...this.drops.keys()]) this.remove(id);
    this.beaconGeo.dispose();
    this.beaconMat.dispose();
    this.nadeBeaconMat.dispose();
    this.padGeo.dispose();
    this.padMat.dispose();
    this.nadePadMat.dispose();
  }
}
