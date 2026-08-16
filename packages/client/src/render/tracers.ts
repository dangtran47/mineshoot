import * as THREE from 'three';
import type { Vec3 } from '@mineshoot/shared';

const TRACER_MS = 90;

interface Tracer {
  line: THREE.Line;
  material: THREE.LineBasicMaterial;
  bornAt: number;
}

/** Short-lived bullet tracer lines. */
export class Tracers {
  readonly group = new THREE.Group();
  private readonly live: Tracer[] = [];

  spawn(from: Vec3, to: Vec3, color = 0xffe680): void {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from.x, from.y, from.z),
      new THREE.Vector3(to.x, to.y, to.z),
    ]);
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });
    const line = new THREE.Line(geo, material);
    this.group.add(line);
    this.live.push({ line, material, bornAt: performance.now() });
  }

  update(now: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const t = this.live[i];
      const age = now - t.bornAt;
      if (age >= TRACER_MS) {
        this.group.remove(t.line);
        t.line.geometry.dispose();
        t.material.dispose();
        this.live.splice(i, 1);
      } else {
        t.material.opacity = 1 - age / TRACER_MS;
      }
    }
  }

  dispose(): void {
    for (const t of this.live) {
      t.line.geometry.dispose();
      t.material.dispose();
    }
    this.live.length = 0;
  }
}
