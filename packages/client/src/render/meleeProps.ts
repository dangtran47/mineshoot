import * as THREE from 'three';
import { MELEE_AXE, MELEE_KATANA, MELEE_PICKAXE, MELEE_SCYTHE } from '@mineshoot/shared';
import type { MeleeKind } from '@mineshoot/shared';

/*
 * Blocky melee weapon props shared by the first-person view model, the remote
 * humanoids and the ground drops. Every prop is modelled with the grip at the
 * origin and the business end pointing down -Z, at humanoid scale (~1.1–1.5
 * long); holders rotate/scale it into place. `glow` lists the materials that
 * light up while charging (blades / heads).
 *
 * Orientation convention: the swing plane is Y/Z (the humanoid arm pivots
 * about X; the view model stands the prop up along +Y). Blades are therefore
 * thin in X with their cutting edge on -Y (leading edge of a downward chop; in
 * first person -Y ends up pointing away from the camera), and heads
 * (pickaxe crossbar, axe bit, scythe blade) extend along ±Y, never sideways.
 */

export interface MeleeProp {
  group: THREE.Group;
  glow: THREE.MeshLambertMaterial[];
}

const WOOD = 0x3a2a1a;
const OAK = 0x8a5a2b;
const STEEL = 0xe8edf5;
const IRON = 0xb9c0cc;
const DARK_STEEL = 0x8a919c;
const BRASS = 0x8a6b2f;
const CHARGE_GLOW = 0xff8c1a;

const box = (w: number, h: number, d: number, color: number, glow?: THREE.MeshLambertMaterial[]): THREE.Mesh => {
  const mat = new THREE.MeshLambertMaterial({ color, emissive: CHARGE_GLOW, emissiveIntensity: 0 });
  glow?.push(mat);
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
};
const at = (m: THREE.Mesh, x: number, y: number, z: number): THREE.Mesh => {
  m.position.set(x, y, z);
  return m;
};

export function buildMeleeProp(kind: MeleeKind): MeleeProp {
  const group = new THREE.Group();
  group.userData.meleeProp = true;
  const glow: THREE.MeshLambertMaterial[] = [];
  switch (kind) {
    case MELEE_AXE: {
      // Long dark haft; a broad single bit hanging off the tip on -Y (edge leads a chop), a back spike on +Y, a top spike.
      group.add(at(box(0.08, 0.08, 1.2, WOOD), 0, 0, -0.55));
      group.add(at(box(0.08, 0.14, 0.14, DARK_STEEL), 0, 0, -0.98)); // socket
      group.add(at(box(0.07, 0.34, 0.36, IRON, glow), 0, -0.24, -0.98)); // bit
      group.add(at(box(0.05, 0.14, 0.5, IRON, glow), 0, -0.44, -0.98)); // flared edge
      group.add(at(box(0.06, 0.16, 0.08, IRON, glow), 0, 0.14, -0.98)); // back spike
      group.add(at(box(0.06, 0.06, 0.2, IRON, glow), 0, 0, -1.2)); // top spike
      break;
    }
    case MELEE_KATANA: {
      // Slim long blade with a slight bright edge, small square guard, wrapped grip.
      group.add(at(box(0.04, 0.09, 1.35, STEEL, glow), 0, -0.01, -0.85));
      group.add(at(box(0.05, 0.03, 1.3, 0xffffff, glow), 0, -0.055, -0.85)); // edge on -Y
      group.add(at(box(0.16, 0.16, 0.03, BRASS), 0, 0, -0.16));
      group.add(at(box(0.06, 0.06, 0.28, 0x2a1a2a), 0, 0, 0));
      group.add(at(box(0.065, 0.065, 0.06, 0x8b1e1e), 0, 0, -0.06));
      group.add(at(box(0.065, 0.065, 0.06, 0x8b1e1e), 0, 0, 0.08));
      break;
    }
    case MELEE_SCYTHE: {
      // Long pole; from the tip a blade juts out on -Y and hooks back toward the grip (three angled slabs in the Y/Z plane).
      group.add(at(box(0.07, 0.07, 1.5, OAK), 0, 0, -0.7));
      group.add(at(box(0.1, 0.12, 0.12, DARK_STEEL), 0, 0, -1.4)); // ferrule
      const b1 = at(box(0.04, 0.42, 0.12, STEEL, glow), 0, -0.2, -1.4);
      const b2 = at(box(0.04, 0.38, 0.1, STEEL, glow), 0, -0.5, -1.31);
      b2.rotation.x = -0.5;
      const b3 = at(box(0.04, 0.32, 0.08, STEEL, glow), 0, -0.7, -1.14);
      b3.rotation.x = -0.95;
      group.add(b1, b2, b3);
      break;
    }
    case MELEE_PICKAXE: {
      // Wooden handle; iron crossbar head across ±Y (one point leads a chop) with two tapered tips.
      group.add(at(box(0.08, 0.08, 1.05, OAK), 0, 0, -0.5));
      group.add(at(box(0.11, 0.9, 0.11, IRON, glow), 0, 0, -1.02));
      group.add(at(box(0.08, 0.2, 0.08, IRON, glow), 0, -0.55, -1.02));
      group.add(at(box(0.08, 0.2, 0.08, IRON, glow), 0, 0.55, -1.02));
      group.add(at(box(0.14, 0.14, 0.14, DARK_STEEL), 0, 0, -1.02));
      break;
    }
    default: {
      // Sword: long bright blade (edges on ±Y like the other props) + crossguard in the blade plane + handle.
      group.add(at(box(0.06, 0.1, 1.1, STEEL, glow), 0, 0, -0.7));
      group.add(at(box(0.06, 0.3, 0.06, BRASS), 0, 0, -0.12));
      group.add(at(box(0.06, 0.06, 0.2, WOOD), 0, 0, 0));
    }
  }
  return { group, glow };
}

export function disposeProp(prop: MeleeProp): void {
  prop.group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  prop.group.removeFromParent();
}
