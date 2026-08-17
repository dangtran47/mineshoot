import * as THREE from 'three';
import type { Vec3 } from '@mineshoot/shared';
import { BLOOD_TTL_MS, bloodParticleCount } from './bloodParams';

const CAPACITY = 256;
const GRAVITY = 14; // blocks/s²
const CHUNK = 0.09; // edge length of one blood cube

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  bornAt: number;
  size: number;
}

/**
 * Voxel blood spray at the point a player got hit. One InstancedMesh; chunks fly out along the
 * blow direction, fall under gravity and shrink away. Nothing here is gameplay: purely cosmetic
 * feedback so the attacker (and bystanders) can see a hit land and roughly how hard.
 */
export class BloodFx {
  readonly mesh: THREE.InstancedMesh;
  private readonly live: Particle[] = [];
  private readonly dummy = new THREE.Object3D();
  private lastFrame = 0;

  constructor() {
    const geo = new THREE.BoxGeometry(CHUNK, CHUNK, CHUNK);
    const mat = new THREE.MeshLambertMaterial({ color: 0xb3121a });
    this.mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  /**
   * @param at    world position of the wound
   * @param damage HP lost — sets how many chunks fly
   * @param dir   direction the blow travelled (need not be normalized); chunks spray away along it
   */
  burst(at: Vec3, damage: number, dir: Vec3, now = performance.now()): void {
    const n = bloodParticleCount(damage);
    if (n === 0) return;
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const dx = dir.x / len;
    const dy = dir.y / len;
    const dz = dir.z / len;
    for (let i = 0; i < n; i++) {
      // Mostly along the blow, with a wide random cone and an upward kick so it arcs.
      const spread = 0.9;
      const speed = 2 + Math.random() * 3;
      const rx = (Math.random() - 0.5) * 2 * spread;
      const ry = (Math.random() - 0.5) * 2 * spread;
      const rz = (Math.random() - 0.5) * 2 * spread;
      const p: Particle = {
        x: at.x,
        y: at.y,
        z: at.z,
        vx: (dx * 0.6 + rx) * speed,
        vy: (dy * 0.6 + ry) * speed + 2.5,
        vz: (dz * 0.6 + rz) * speed,
        bornAt: now,
        size: 0.6 + Math.random() * 0.8,
      };
      if (this.live.length >= CAPACITY) this.live.shift();
      this.live.push(p);
    }
  }

  update(now: number): void {
    const dt = this.lastFrame ? Math.min(0.05, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    let count = 0;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      const age = now - p.bornAt;
      if (age >= BLOOD_TTL_MS) {
        this.live.splice(i, 1);
        continue;
      }
      p.vy -= GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const life = 1 - age / BLOOD_TTL_MS;
      this.dummy.position.set(p.x, p.y, p.z);
      this.dummy.scale.setScalar(p.size * (0.4 + 0.6 * life));
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(count++, this.dummy.matrix);
    }
    this.mesh.count = count;
    if (count) this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.live.length = 0;
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
