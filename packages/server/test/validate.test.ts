import { describe, expect, it } from 'vitest';
import {
  parseBotCount,
  parseBotSkill,
  parseCaptureLimit,
  parseCharge,
  parseChargeCancel,
  parseDropFlag,
  parseDurationMin,
  parsePose,
  parseReload,
  parseRoomMode,
  parseSelectMelee,
  parseShoot,
  parseSwing,
  parseTeam,
  parseWeaponMode,
  sanitizeName,
  sanitizeRoomName,
} from '../src/rooms/validate';
import { ATTACK_HEAVY, ATTACK_LIGHT, CTF_DEFAULT_CAPTURE_LIMIT, MAX_BOTS, MELEE_KATANA, MELEE_SWORD, TEAM_BLUE, TEAM_NONE, TEAM_RED } from '@mineshoot/shared';

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
  it('clamps to the given world bounds (the CTF map is 96 wide)', () => {
    const p = parsePose({ ...good, x: 200, z: 200 }, { sx: 96, sz: 48 })!;
    expect(p.x).toBe(95.5);
    expect(p.z).toBe(47.5);
    expect(parseShoot({ ...good, x: 200 }, { sx: 96, sz: 48 })!.x).toBe(95.5);
    expect(parseSwing({ ...good, x: 200, attack: ATTACK_LIGHT }, { sx: 96, sz: 48 })!.x).toBe(95.5);
  });
  it('parseShoot ignores weapon', () => {
    const s = parseShoot(good)!;
    expect(s.epoch).toBe(1);
    expect((s as { weapon?: unknown }).weapon).toBeUndefined();
  });
  it('parseSwing reads attack as a known AttackKind (garbage → light)', () => {
    expect(parseSwing(good)!.attack).toBe(ATTACK_LIGHT);
    expect(parseSwing({ ...good, attack: ATTACK_HEAVY })!.attack).toBe(ATTACK_HEAVY);
    expect(parseSwing({ ...good, attack: 2 })!.attack).toBe(ATTACK_LIGHT);
    expect(parseSwing({ ...good, attack: 7 })!.attack).toBe(ATTACK_LIGHT);
    expect(parseSwing({ ...good, attack: '2' })!.attack).toBe(ATTACK_LIGHT);
    expect(parseSwing({ ...good, attack: true })!.attack).toBe(ATTACK_LIGHT);
    expect(parseSwing({ ...good, x: 'no' })).toBeNull();
  });
  it('parseCharge accepts only an integer epoch', () => {
    expect(parseCharge(3)).toBe(3);
    expect(parseCharge(1.5)).toBeNull();
    expect(parseCharge('1')).toBeNull();
    expect(parseCharge(undefined)).toBeNull();
    expect(parseReload(2)).toBe(2);
    expect(parseReload('2')).toBeNull();
    expect(parseChargeCancel(4)).toBe(4);
    expect(parseChargeCancel(null)).toBeNull();
  });
});

describe('parseBotCount', () => {
  it('clamps to 0..MAX_BOTS integers, default 0', () => {
    expect(parseBotCount(undefined)).toBe(0);
    expect(parseBotCount(3)).toBe(3);
    expect(parseBotCount(99)).toBe(MAX_BOTS);
    expect(parseBotCount(-1)).toBe(0);
    expect(parseBotCount(2.5)).toBe(0);
    expect(parseBotCount('2')).toBe(0);
  });

  it('parseBotSkill accepts only known levels, default normal', () => {
    expect(parseBotSkill('easy')).toBe('easy');
    expect(parseBotSkill('hard')).toBe('hard');
    expect(parseBotSkill('normal')).toBe('normal');
    expect(parseBotSkill(undefined)).toBe('normal');
    expect(parseBotSkill('EASY')).toBe('normal');
    expect(parseBotSkill(2)).toBe('normal');
  });

  it('parseWeaponMode accepts only known modes', () => {
    expect(parseWeaponMode('gun')).toBe('gun');
    expect(parseWeaponMode('sword')).toBe('sword');
    expect(parseWeaponMode('all')).toBe('all');
    expect(parseWeaponMode('laser')).toBe('all');
    expect(parseWeaponMode(undefined)).toBe('all');
    expect(parseWeaponMode(1)).toBe('all');
  });

  it('parseRoomMode accepts only known modes, default match', () => {
    expect(parseRoomMode('training')).toBe('training');
    expect(parseRoomMode('match')).toBe('match');
    expect(parseRoomMode('ctf')).toBe('ctf');
    expect(parseRoomMode('sandbox')).toBe('match');
    expect(parseRoomMode(undefined)).toBe('match');
    expect(parseRoomMode(2)).toBe('match');
  });
});

describe('parseSelectMelee', () => {
  it('needs an integer epoch and a known melee kind', () => {
    expect(parseSelectMelee({ epoch: 3, melee: MELEE_KATANA })).toEqual({ epoch: 3, melee: MELEE_KATANA });
    expect(parseSelectMelee({ epoch: 0, melee: MELEE_SWORD })).toEqual({ epoch: 0, melee: MELEE_SWORD });
    expect(parseSelectMelee({ epoch: 1.5, melee: MELEE_KATANA })).toBeNull();
    expect(parseSelectMelee({ epoch: 1, melee: 99 })).toBeNull();
    expect(parseSelectMelee({ epoch: 1, melee: '2' })).toBeNull();
    expect(parseSelectMelee({ epoch: 1 })).toBeNull();
    expect(parseSelectMelee(null)).toBeNull();
    expect(parseSelectMelee(2)).toBeNull();
  });
});

describe('ctf options', () => {
  it('parseCaptureLimit accepts only the offered options', () => {
    expect(parseCaptureLimit(5)).toBe(5);
    expect(parseCaptureLimit(10)).toBe(10);
    expect(parseCaptureLimit(4)).toBe(CTF_DEFAULT_CAPTURE_LIMIT);
    expect(parseCaptureLimit('3')).toBe(CTF_DEFAULT_CAPTURE_LIMIT);
    expect(parseCaptureLimit(undefined)).toBe(CTF_DEFAULT_CAPTURE_LIMIT);
  });
  it('parseTeam knows red and blue, everything else is no preference', () => {
    expect(parseTeam(TEAM_RED)).toBe(TEAM_RED);
    expect(parseTeam(TEAM_BLUE)).toBe(TEAM_BLUE);
    expect(parseTeam(TEAM_NONE)).toBe(TEAM_NONE);
    expect(parseTeam(3)).toBe(TEAM_NONE);
    expect(parseTeam('1')).toBe(TEAM_NONE);
    expect(parseTeam(undefined)).toBe(TEAM_NONE);
  });
  it('parseDropFlag wants an integer epoch', () => {
    expect(parseDropFlag(2)).toBe(2);
    expect(parseDropFlag(1.5)).toBeNull();
    expect(parseDropFlag('2')).toBeNull();
  });
});
