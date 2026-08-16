import { describe, expect, it } from 'vitest';
import { parseBotCount, parseDurationMin, parsePose, parseShoot, sanitizeName, sanitizeRoomName } from '../src/rooms/validate';

describe('sanitizeName', () => {
  it('trims, strips junk, limits length, falls back', () => {
    expect(sanitizeName('  Bob  ', 'x')).toBe('Bob');
    expect(sanitizeName('<script>', 'x')).toBe('script');
    expect(sanitizeName('a'.repeat(40), 'x')).toHaveLength(12);
    expect(sanitizeName('', 'Fallback')).toBe('Fallback');
    expect(sanitizeName(42, 'Fallback')).toBe('Fallback');
  });
  it('sanitizeRoomName allows longer names', () => {
    expect(sanitizeRoomName('My Room!', 'x')).toBe('My Room!');
    expect(sanitizeRoomName(null, 'Arena')).toBe('Arena');
  });
});

describe('parseDurationMin', () => {
  it('accepts offered options, defaults otherwise', () => {
    expect(parseDurationMin(3)).toBe(3);
    expect(parseDurationMin(15)).toBe(15);
    expect(parseDurationMin(7)).toBe(10);
    expect(parseDurationMin('5')).toBe(10);
    expect(parseDurationMin(NaN)).toBe(10);
  });
});

describe('parsePose / parseShoot', () => {
  const good = { x: 10, y: 5, z: 10, yaw: 1, pitch: 0.2, epoch: 1, weapon: 1 };
  it('accepts a valid pose', () => {
    expect(parsePose(good)).toEqual(good);
  });
  it('rejects garbage', () => {
    expect(parsePose(null)).toBeNull();
    expect(parsePose({ ...good, x: 'a' })).toBeNull();
    expect(parsePose({ ...good, y: NaN })).toBeNull();
    expect(parsePose({ ...good, epoch: 1.5 })).toBeNull();
  });
  it('clamps position/pitch and normalises weapon', () => {
    const p = parsePose({ ...good, x: -50, z: 999, pitch: 9, weapon: 'sword' })!;
    expect(p.x).toBe(0.5);
    expect(p.z).toBe(63.5);
    expect(p.pitch).toBeCloseTo(Math.PI / 2);
    expect(p.weapon).toBe(0);
  });
  it('parseShoot ignores weapon', () => {
    const s = parseShoot(good)!;
    expect(s.epoch).toBe(1);
    expect((s as { weapon?: unknown }).weapon).toBeUndefined();
  });
});

describe('parseBotCount', () => {
  it('clamps to 0..7 integers, default 0', () => {
    expect(parseBotCount(undefined)).toBe(0);
    expect(parseBotCount(3)).toBe(3);
    expect(parseBotCount(99)).toBe(7);
    expect(parseBotCount(-1)).toBe(0);
    expect(parseBotCount(2.5)).toBe(0);
    expect(parseBotCount('2')).toBe(0);
  });
});
