import * as THREE from 'three';
import { GUN_NONE, GUN_PISTOL, GUN_RIFLE, GUN_SHOTGUN, GUN_SMG, GUN_SNIPER, GUN_TASER, WEAPON_GRENADE, WEAPON_PRIMARY } from '@mineshoot/shared';
import type { GunKind, MeleeKind, Weapon } from '@mineshoot/shared';
import { buildMeleeProp } from './meleeProps';
import type { MeleeProp } from './meleeProps';

/*
 * Blocky gun props (and the grenade), shared by the first-person view model,
 * the remote humanoids and the ground drops. Grip at the origin, barrel down
 * -Z, at humanoid scale; holders rotate/scale them into place. `glow` = the
 * muzzle-flash material(s), lit up for a frame or two on a shot.
 */

const DARK = 0x2b2b2b;
const GUNMETAL = 0x555a63;
const STEEL = 0x8a919c;
const WOOD = 0x6b4423;
const OLIVE = 0x4f5b3a;
const YELLOW = 0xd9c22a;
const MUZZLE = 0xffd36b;

const box = (w: number, h: number, d: number, color: number): THREE.Mesh =>
  new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
const at = (m: THREE.Mesh, x: number, y: number, z: number): THREE.Mesh => {
  m.position.set(x, y, z);
  return m;
};
/** Muzzle flash cube at the barrel tip; invisible until a shot lights it (opacity / emissive driven by the holder). */
const muzzleFlash = (glow: THREE.MeshLambertMaterial[], z: number): THREE.Mesh => {
  const mat = new THREE.MeshLambertMaterial({ color: MUZZLE, emissive: MUZZLE, emissiveIntensity: 0, transparent: true, opacity: 0 });
  glow.push(mat);
  return at(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), mat), 0, 0.03, z);
};

/** Overall length (blocks) of each prop along -Z; used to centre drops on their spin axis. */
export const PROP_LENGTH: Record<GunKind, number> = {
  [GUN_NONE]: 0,
  [GUN_PISTOL]: 0.5,
  [GUN_RIFLE]: 1.05,
  [GUN_SMG]: 0.7,
  [GUN_SHOTGUN]: 1.0,
  [GUN_SNIPER]: 1.3,
  [GUN_TASER]: 0.45,
};

export function buildGunProp(kind: GunKind): MeleeProp {
  const group = new THREE.Group();
  group.userData.gunProp = true;
  const glow: THREE.MeshLambertMaterial[] = [];
  switch (kind) {
    case GUN_PISTOL:
      // Chunky dark body, short barrel, wooden grip (today's gun).
      group.add(at(box(0.12, 0.16, 0.45, DARK), 0, 0, -0.15), at(box(0.06, 0.06, 0.2, GUNMETAL), 0, 0.03, -0.45), at(box(0.08, 0.16, 0.08, WOOD), 0, -0.14, 0.02), muzzleFlash(glow, -0.6));
      break;
    case GUN_RIFLE:
      // Long body + barrel, wooden stock behind the grip, magazine under the body.
      group.add(
        at(box(0.12, 0.16, 0.7, DARK), 0, 0, -0.35),
        at(box(0.06, 0.06, 0.4, GUNMETAL), 0, 0.03, -0.9),
        at(box(0.1, 0.22, 0.25, WOOD), 0, -0.05, 0.15),
        at(box(0.08, 0.16, 0.08, WOOD), 0, -0.16, -0.05),
        at(box(0.06, 0.2, 0.08, DARK), 0, -0.18, -0.35),
        muzzleFlash(glow, -1.15),
      );
      break;
    case GUN_SMG:
      // Short gunmetal body, stubby barrel, long magazine, wire stock.
      group.add(
        at(box(0.12, 0.14, 0.5, GUNMETAL), 0, 0, -0.25),
        at(box(0.05, 0.05, 0.25, DARK), 0, 0.03, -0.6),
        at(box(0.08, 0.14, 0.08, DARK), 0, -0.13, 0),
        at(box(0.06, 0.26, 0.06, DARK), 0, -0.2, -0.3),
        at(box(0.04, 0.04, 0.3, STEEL), 0, 0.02, 0.15),
        muzzleFlash(glow, -0.78),
      );
      break;
    case GUN_SHOTGUN:
      // Wooden body and pump, twin barrels stacked.
      group.add(
        at(box(0.12, 0.14, 0.45, WOOD), 0, 0, -0.1),
        at(box(0.09, 0.09, 0.75, GUNMETAL), 0, 0.03, -0.62),
        at(box(0.09, 0.09, 0.75, GUNMETAL), 0, -0.06, -0.62),
        at(box(0.1, 0.18, 0.2, WOOD), 0, -0.06, 0.15),
        at(box(0.1, 0.1, 0.25, WOOD), 0, -0.1, -0.55),
        muzzleFlash(glow, -1.05),
      );
      break;
    case GUN_SNIPER:
      // Olive body, very long thin barrel, scope on top, bipod foot under the barrel.
      group.add(
        at(box(0.11, 0.15, 0.7, OLIVE), 0, 0, -0.3),
        at(box(0.05, 0.05, 0.75, GUNMETAL), 0, 0.03, -1.0),
        at(box(0.07, 0.07, 0.3, DARK), 0, 0.14, -0.35),
        at(box(0.09, 0.2, 0.25, OLIVE), 0, -0.05, 0.15),
        at(box(0.06, 0.16, 0.06, DARK), 0, -0.14, -0.05),
        at(box(0.04, 0.16, 0.04, DARK), 0, -0.15, -0.9),
        muzzleFlash(glow, -1.4),
      );
      break;
    case GUN_TASER:
      // Yellow pistol body with two steel prongs.
      group.add(
        at(box(0.12, 0.14, 0.3, YELLOW), 0, 0, -0.1),
        at(box(0.1, 0.06, 0.15, DARK), 0, 0.03, -0.32),
        at(box(0.03, 0.03, 0.12, STEEL), -0.03, 0.03, -0.42),
        at(box(0.03, 0.03, 0.12, STEEL), 0.03, 0.03, -0.42),
        at(box(0.08, 0.16, 0.08, DARK), 0, -0.14, 0.02),
        muzzleFlash(glow, -0.5),
      );
      break;
    default:
      break; // GUN_NONE: nothing in the hand
  }
  return { group, glow };
}

/** A grenade: olive body, dark cap, small lever; ~0.3 tall, centred at the origin. */
export function buildGrenadeProp(): MeleeProp {
  const group = new THREE.Group();
  group.userData.grenadeProp = true;
  group.add(at(box(0.22, 0.26, 0.22, OLIVE), 0, 0, 0), at(box(0.1, 0.08, 0.1, DARK), 0, 0.17, 0), at(box(0.03, 0.14, 0.06, STEEL), 0.06, 0.12, 0));
  return { group, glow: [] };
}

/** The prop for a ground drop, by slot. */
export function buildDropProp(slot: Weapon, kind: number): MeleeProp {
  if (slot === WEAPON_PRIMARY) return buildGunProp(kind as GunKind);
  if (slot === WEAPON_GRENADE) return buildGrenadeProp();
  return buildMeleeProp(kind as MeleeKind);
}
