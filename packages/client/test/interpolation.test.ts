import { describe, expect, it } from 'vitest';
import { SnapshotBuffer, lerpAngle } from '../src/game/interpolation';

describe('lerpAngle', () => {
  it('takes the shortest arc across ±π', () => {
    const r = lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5);
    expect(Math.cos(r)).toBeCloseTo(-1, 3);
  });
});

describe('SnapshotBuffer', () => {
  it('lerps between bracketing samples and clamps at the ends', () => {
    const b = new SnapshotBuffer();
    b.push({ t: 100, x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });
    b.push({ t: 200, x: 10, y: 2, z: -4, yaw: 1, pitch: 0.5 });
    const mid = b.sample(150)!;
    expect(mid.x).toBeCloseTo(5);
    expect(mid.y).toBeCloseTo(1);
    expect(mid.z).toBeCloseTo(-2);
    expect(mid.yaw).toBeCloseTo(0.5);
    expect(b.sample(50)!.x).toBe(0);
    expect(b.sample(500)!.x).toBe(10);
  });
  it('returns null when empty and clears', () => {
    const b = new SnapshotBuffer();
    expect(b.sample(1)).toBeNull();
    b.push({ t: 1, x: 1, y: 1, z: 1, yaw: 0, pitch: 0 });
    b.clear();
    expect(b.sample(1)).toBeNull();
  });
});
