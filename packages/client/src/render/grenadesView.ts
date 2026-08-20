import * as THREE from 'three';
import type { Vec3 } from '@mineshoot/shared';
import type { NetGrenade, NetMap } from '../net';
import { buildGrenadeProp } from './gunProps';
import { disposeProp } from './meleeProps';
import type { MeleeProp } from './meleeProps';

interface Blast {
  mesh: THREE.Mesh;
  bornAt: number;
}

const BLAST_MS = 350;
const BLAST_COLOR = 0xffb347;

/** Live grenades from the room state (server-simulated) plus a short expanding blast on MSG.explode. */
export class GrenadesView {
  readonly group = new THREE.Group();
  private readonly live = new Map<string, MeleeProp>();
  private readonly blasts: Blast[] = [];
  private readonly blastGeo = new THREE.SphereGeometry(1, 8, 6);

  /** Mirror the state's grenade map (add new, move existing, drop gone). */
  sync(grenades: NetMap<NetGrenade> | undefined): void {
    const seen = new Set<string>();
    grenades?.forEach((g, id) => {
      seen.add(id);
      let p = this.live.get(id);
      if (!p) {
        p = buildGrenadeProp();
        this.live.set(id, p);
        this.group.add(p.group);
      }
      p.group.position.set(g.x, g.y, g.z);
    });
    for (const [id, p] of [...this.live]) {
      if (!seen.has(id)) {
        this.live.delete(id);
        disposeProp(p);
      }
    }
  }

  /** Play a burst at `at` (MSG.explode). */
  burst(at: Vec3, now: number): void {
    const mesh = new THREE.Mesh(this.blastGeo, new THREE.MeshBasicMaterial({ color: BLAST_COLOR, transparent: true, opacity: 0.9, depthWrite: false }));
    mesh.position.set(at.x, at.y, at.z);
    mesh.scale.setScalar(0.3);
    this.group.add(mesh);
    this.blasts.push({ mesh, bornAt: now });
  }

  update(now: number): void {
    for (const p of this.live.values()) p.group.rotation.y = now / 200;
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      const t = (now - b.bornAt) / BLAST_MS;
      if (t >= 1) {
        this.group.remove(b.mesh);
        (b.mesh.material as THREE.Material).dispose();
        this.blasts.splice(i, 1);
        continue;
      }
      b.mesh.scale.setScalar(0.3 + t * 4);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
    }
  }

  dispose(): void {
    for (const p of this.live.values()) disposeProp(p);
    this.live.clear();
    for (const b of this.blasts) {
      this.group.remove(b.mesh);
      (b.mesh.material as THREE.Material).dispose();
    }
    this.blasts.length = 0;
    this.blastGeo.dispose();
    this.group.removeFromParent();
  }
}
