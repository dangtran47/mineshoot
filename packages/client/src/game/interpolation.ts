/** Drop samples older than this; generous slack over the render delay. */
const MAX_AGE_MS = 1000;

export interface PoseSample {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}
export type Pose = Omit<PoseSample, 't'>;

/** Shortest-arc angle interpolation. */
export function lerpAngle(a: number, b: number, f: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * f;
}

/**
 * Time-stamped pose history for one remote player. Sampled at
 * (now - INTERP_DELAY_MS) so two 20Hz snapshots bracket the render time.
 */
export class SnapshotBuffer {
  private readonly list: PoseSample[] = [];

  push(s: PoseSample): void {
    this.list.push(s);
    const cutoff = s.t - MAX_AGE_MS;
    while (this.list.length > 2 && this.list[0].t < cutoff) this.list.shift();
  }

  /** Reset history (e.g. on teleport/respawn) so we don't lerp across the map. */
  clear(): void {
    this.list.length = 0;
  }

  sample(renderT: number): Pose | null {
    const list = this.list;
    if (list.length === 0) return null;
    if (renderT <= list[0].t) return strip(list[0]);
    const last = list[list.length - 1];
    if (renderT >= last.t) return strip(last);
    for (let i = 1; i < list.length; i++) {
      if (list[i].t >= renderT) {
        const a = list[i - 1];
        const b = list[i];
        const f = (renderT - a.t) / (b.t - a.t);
        return {
          x: a.x + (b.x - a.x) * f,
          y: a.y + (b.y - a.y) * f,
          z: a.z + (b.z - a.z) * f,
          yaw: lerpAngle(a.yaw, b.yaw, f),
          pitch: a.pitch + (b.pitch - a.pitch) * f,
        };
      }
    }
    return strip(last);
  }
}

function strip(s: PoseSample): Pose {
  return { x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch };
}
