import * as THREE from 'three';
import { inBounds, raycastVoxels } from '@mineshoot/shared';
import type { Vec3, World } from '@mineshoot/shared';

const CAPACITY = 256;
/** How long a hole stays on the wall. */
export const BULLET_HOLE_TTL_MS = 15_000;
/** Tail of the lifetime spent shrinking away, so holes fade instead of popping. */
const FADE_MS = 600;
const RADIUS = 0.06;
/** Lift off the face so the decal never z-fights the block it sits on. */
const LIFT = 0.012;

interface Hole {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  /** Spin around the face normal, so repeated hits don't look stamped. */
  roll: number;
  bornAt: number;
}

/**
 * Where a shot that ended on a wall should leave its mark, or null when there is no wall face:
 * the ray stopped short (a body took it), flew its full range, or is degenerate.
 *
 * The wire only carries the impact point (`ShotRay.to`), not the block face — but every client
 * generates the same world from the seed, so we re-walk the ray locally to recover the normal.
 * Pass the server's ray origin (`ShotMsg.from`), not the cosmetic muzzle the tracers start at.
 */
export function bulletHoleAt(world: World, from: Vec3, to: Vec3): { point: Vec3; normal: Vec3 } | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return null;
  const dir = { x: dx / len, y: dy / len, z: dz / len };
  // Stop just past the reported impact: a block further away means this ray ended on something else.
  const hit = raycastVoxels(world, from, dir, len + 0.05);
  if (!hit.hit) return null;
  if (hit.normal.x === 0 && hit.normal.y === 0 && hit.normal.z === 0) return null; // origin inside a block
  // Out of bounds is solid to bullets (`getBlock` returns Bedrock at the sides and below) but is
  // never meshed, so a hole there would hang in the empty sky past the map edge.
  if (!inBounds(world, hit.bx, hit.by, hit.bz)) return null;
  return { point: hit.point, normal: hit.normal };
}

/**
 * Bullet holes on the voxels players shoot. One InstancedMesh with a fixed pool: the oldest hole is
 * evicted once the pool is full, so a long firefight costs the same as a single shot. Purely
 * cosmetic — blocks are never destroyed, so a hole stays on the face it was stamped on.
 */
export class BulletHoles {
  readonly mesh: THREE.InstancedMesh;
  private readonly live: Hole[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly target = new THREE.Vector3();

  constructor() {
    const geo = new THREE.CircleGeometry(RADIUS, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0x14100e, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  /**
   * @param point world position on the block face (as returned by `bulletHoleAt`)
   * @param normal outward face normal; the decal is lifted along it
   */
  spawn(point: Vec3, normal: Vec3, now = performance.now()): void {
    if (this.live.length >= CAPACITY) this.live.shift();
    this.live.push({
      x: point.x + normal.x * LIFT,
      y: point.y + normal.y * LIFT,
      z: point.z + normal.z * LIFT,
      nx: normal.x,
      ny: normal.y,
      nz: normal.z,
      roll: Math.random() * Math.PI * 2,
      bornAt: now,
    });
  }

  update(now: number): void {
    let count = 0;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const h = this.live[i];
      const age = now - h.bornAt;
      if (age >= BULLET_HOLE_TTL_MS) {
        this.live.splice(i, 1);
        continue;
      }
      const left = BULLET_HOLE_TTL_MS - age;
      const scale = left < FADE_MS ? left / FADE_MS : 1;
      this.dummy.position.set(h.x, h.y, h.z);
      this.dummy.lookAt(this.target.set(h.x + h.nx, h.y + h.ny, h.z + h.nz));
      this.dummy.rotateZ(h.roll);
      this.dummy.scale.setScalar(scale);
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
