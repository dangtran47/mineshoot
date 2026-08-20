import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MELEE_KATANA, MELEE_SWORD, WEAPON_PISTOL, WEAPON_MELEE } from '@mineshoot/shared';
import type { MeleeKind } from '@mineshoot/shared';
import { Humanoid, PLAYER_COLORS } from '../src/render/humanoid';

/** World-space tip of the held weapon: the deepest -z child in the visible weapon holder. */
function tipZ(h: Humanoid): number {
  h.group.updateMatrixWorld(true);
  let minZ = Infinity;
  h.group.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.visible) return;
    let p: THREE.Object3D | null = o;
    while (p && p.visible) p = p.parent;
    if (p) return; // some ancestor hidden
    const g = o.geometry as THREE.BoxGeometry;
    const depth = g.parameters.depth;
    // Both ends of the box along its local z.
    for (const zEnd of [-depth / 2, depth / 2]) {
      const v = new THREE.Vector3(0, 0, zEnd).applyMatrix4(o.matrixWorld);
      minZ = Math.min(minZ, v.z);
    }
  });
  return minZ;
}

describe('Humanoid weapon orientation', () => {
  // The humanoid faces local -z (eyes are on the -z face of the head; yaw 0 → world -z).
  it('points the gun forward (toward -z) at idle', () => {
    const h = new Humanoid(0);
    h.setWeapon(WEAPON_PISTOL);
    h.setPose(0, 0, 0, 0, 0, 0);
    h.update(0);
    expect(tipZ(h)).toBeLessThan(-0.5);
  });

  it.each<MeleeKind>([MELEE_SWORD, MELEE_KATANA])('points melee kind %i forward/down, not behind the back', (kind) => {
    const h = new Humanoid(0);
    h.setWeapon(WEAPON_MELEE);
    h.setMelee(kind);
    h.setPose(0, 0, 0, 0, 0, 0);
    h.update(0);
    expect(tipZ(h)).toBeLessThan(-0.3);
  });
});

describe('Humanoid.muzzleWorld', () => {
  it('returns the rendered gun tip: forward of the body, moving with the pose', () => {
    const h = new Humanoid(0);
    h.setWeapon(WEAPON_PISTOL);
    h.setPose(10, 2, 5, 0, 0, 0);
    h.update(0);
    const m = h.muzzleWorld();
    expect(m).not.toBeNull();
    expect(m!.z).toBeLessThan(5 - 0.3); // yaw 0 → the humanoid faces world -z
    expect(m!.y).toBeGreaterThan(2); // held up in the arm, not at the feet
    expect(Math.hypot(m!.x - 10, m!.z - 5)).toBeLessThan(1.6); // still in the hand
  });

  it('is null while melee is held', () => {
    const h = new Humanoid(0);
    h.setWeapon(WEAPON_MELEE);
    expect(h.muzzleWorld()).toBeNull();
  });
});

describe('Humanoid.setColor', () => {
  const meshColors = (h: Humanoid): Set<number> => {
    const colors = new Set<number>();
    h.group.traverse((o) => {
      if (o instanceof THREE.Mesh) colors.add((o.material as THREE.MeshLambertMaterial).color.getHex());
    });
    return colors;
  };

  it('repaints body and trim to the new colour', () => {
    const h = new Humanoid(0);
    h.setColor(2);
    const colors = meshColors(h);
    const dark = (i: number): number => new THREE.Color(PLAYER_COLORS[i]).multiplyScalar(0.55).getHex();
    expect(colors).toContain(PLAYER_COLORS[2]);
    expect(colors).toContain(dark(2));
    expect(colors).not.toContain(PLAYER_COLORS[0]);
    expect(colors).not.toContain(dark(0));
  });
});
