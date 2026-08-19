import { describe, expect, it } from 'vitest';
import { SWORD_CHARGE_MS, SWORD_COOLDOWN_MS, SWORD_DAMAGE, SWORD_HALF_ANGLE_DEG, SWORD_HEAVY_HALF_ANGLE_DEG, SWORD_RANGE } from '../src/constants';
import {
  ATTACK_HEAVY,
  ATTACK_KINDS,
  ATTACK_LIGHT,
  DROP_KINDS,
  MELEE_AXE,
  MELEE_KATANA,
  MELEE_KINDS,
  MELEE_PICKAXE,
  MELEE_SCYTHE,
  MELEE_STATS,
  MELEE_SWORD,
  attackSpec,
  canPickUp,
  isAttackKind,
  isMeleeKind,
  MELEE_MIN_CHARGE_FRACTION,
  chargeFraction,
  meleeChargeMaxMs,
  meleeStats,
} from '../src/melee';

describe('melee stats', () => {
  it('the sword light/heavy attacks mirror the sword constants', () => {
    const s = MELEE_STATS[MELEE_SWORD];
    const light = s.attacks[ATTACK_LIGHT];
    const heavy = s.attacks[ATTACK_HEAVY];
    expect(light.range).toBe(SWORD_RANGE);
    expect(light.halfAngleDeg).toBe(SWORD_HALF_ANGLE_DEG);
    expect(light.cooldownMs).toBe(SWORD_COOLDOWN_MS);
    expect(light.damage).toEqual(SWORD_DAMAGE.normal);
    expect(light.sweep).toBe(false);
    expect(heavy.halfAngleDeg).toBe(SWORD_HEAVY_HALF_ANGLE_DEG);
    expect(heavy.damage).toEqual(SWORD_DAMAGE.charged);
    expect(heavy.sweep).toBe(true);
    expect(s.chargeMs).toBe(SWORD_CHARGE_MS);
  });
  it('every weapon has a light slash and a heavy with a distinct name', () => {
    for (const k of MELEE_KINDS) {
      const s = MELEE_STATS[k];
      expect(Object.keys(s.attacks)).toHaveLength(2);
      expect(s.attacks[ATTACK_LIGHT].anim).toBe('slash');
      expect(['overhead', 'slash']).toContain(s.attacks[ATTACK_HEAVY].anim);
      const names = new Set(ATTACK_KINDS.map((a) => s.attacks[a].name));
      expect(names.size).toBe(2);
    }
  });
  it('every drop weapon beats the sword somewhere and pays for it somewhere', () => {
    const sword = MELEE_STATS[MELEE_SWORD];
    const sl = sword.attacks[ATTACK_LIGHT];
    for (const k of DROP_KINDS) {
      const s = MELEE_STATS[k];
      const l = s.attacks[ATTACK_LIGHT];
      const better =
        l.range > sl.range ||
        l.damage.head > sl.damage.head ||
        l.damage.body > sl.damage.body ||
        s.attacks[ATTACK_HEAVY].damage.body > sword.attacks[ATTACK_HEAVY].damage.body ||
        l.cooldownMs < sl.cooldownMs ||
        (l.sweep && !sl.sweep);
      const worse =
        l.cooldownMs > sl.cooldownMs ||
        s.chargeMs > sword.chargeMs ||
        l.halfAngleDeg < sl.halfAngleDeg ||
        l.damage.body < sl.damage.body ||
        s.chargeSpeedScale < sword.chargeSpeedScale;
      expect(better, `${s.name} is stronger`).toBe(true);
      expect(worse, `${s.name} has a trade-off`).toBe(true);
    }
  });
  it('sane ranges/damage per attack and a server interval a bit under each cooldown', () => {
    for (const k of MELEE_KINDS) {
      const s = MELEE_STATS[k];
      for (const a of ATTACK_KINDS) {
        const spec = s.attacks[a];
        expect(spec.range).toBeGreaterThanOrEqual(2.5);
        expect(spec.range).toBeLessThanOrEqual(5);
        expect(spec.halfAngleDeg).toBeGreaterThan(0);
        expect(spec.halfAngleDeg).toBeLessThanOrEqual(180);
        expect(spec.serverMinIntervalMs).toBeLessThan(spec.cooldownMs);
        expect(spec.serverMinIntervalMs).toBeGreaterThan(spec.cooldownMs * 0.8);
        for (const d of [spec.damage.head, spec.damage.body]) {
          expect(d).toBeGreaterThan(0);
          expect(d).toBeLessThanOrEqual(100);
        }
      }
      expect(s.attacks[ATTACK_HEAVY].halfAngleDeg).toBeLessThanOrEqual(s.attacks[ATTACK_LIGHT].halfAngleDeg);
      // A fully charged release is never blocked by the previous swing's cooldown.
      expect(s.chargeMs).toBeGreaterThan(s.attacks[ATTACK_LIGHT].cooldownMs);
      expect(s.chargeMs).toBeGreaterThan(s.attacks[ATTACK_HEAVY].cooldownMs);
      expect(meleeChargeMaxMs(k)).toBeGreaterThan(s.chargeMs);
    }
  });
  it('character sheet: axe cleaves & one-shots on charge, katana fast/long/narrow, scythe wide sweep, pickaxe head-hunter', () => {
    const light = (k: (typeof MELEE_KINDS)[number]) => MELEE_STATS[k].attacks[ATTACK_LIGHT];
    expect(light(MELEE_AXE).sweep).toBe(true);
    expect(MELEE_STATS[MELEE_AXE].attacks[ATTACK_HEAVY].damage.body).toBe(100);
    expect(light(MELEE_KATANA).cooldownMs).toBeLessThan(SWORD_COOLDOWN_MS);
    expect(light(MELEE_KATANA).range).toBeGreaterThan(SWORD_RANGE);
    expect(light(MELEE_KATANA).halfAngleDeg).toBeLessThan(light(MELEE_SWORD).halfAngleDeg);
    expect(light(MELEE_SCYTHE).sweep).toBe(true);
    expect(light(MELEE_SCYTHE).halfAngleDeg).toBeGreaterThan(40);
    expect(light(MELEE_PICKAXE).damage.head).toBeGreaterThanOrEqual(75);
    expect(light(MELEE_PICKAXE).damage.body).toBeLessThanOrEqual(SWORD_DAMAGE.normal.body);
  });
  it('isMeleeKind / isAttackKind / meleeStats / attackSpec fall back safely', () => {
    expect(isMeleeKind(0)).toBe(true);
    expect(isMeleeKind(4)).toBe(true);
    expect(isMeleeKind(5)).toBe(false);
    expect(isMeleeKind('1')).toBe(false);
    expect(isAttackKind(0)).toBe(true);
    expect(isAttackKind(1)).toBe(true);
    expect(isAttackKind(2)).toBe(false);
    expect(isAttackKind(true)).toBe(false);
    expect(meleeStats(99 as never)).toBe(MELEE_STATS[MELEE_SWORD]);
    expect(attackSpec(MELEE_AXE, ATTACK_HEAVY)).toBe(MELEE_STATS[MELEE_AXE].attacks[ATTACK_HEAVY]);
    expect(attackSpec(99 as never, 7 as never)).toBe(MELEE_STATS[MELEE_SWORD].attacks[ATTACK_LIGHT]);
  });
});

describe('canPickUp', () => {
  const drop = { x: 10.5, y: 5, z: 10.5 };
  it('needs to be close horizontally and roughly at the same height', () => {
    expect(canPickUp({ x: 10.5, y: 5, z: 10.5 }, drop)).toBe(true);
    expect(canPickUp({ x: 11.5, y: 5, z: 10.5 }, drop)).toBe(true);
    expect(canPickUp({ x: 12, y: 5, z: 10.5 }, drop)).toBe(false);
    expect(canPickUp({ x: 10.5, y: 8, z: 10.5 }, drop)).toBe(false);
    expect(canPickUp({ x: 10.5, y: 4, z: 10.5 }, drop)).toBe(true);
  });

  it('chargeFraction: held / chargeMs clamped to 0..1; below MELEE_MIN_CHARGE_FRACTION a release is only a cancel', () => {
    expect(chargeFraction(MELEE_SWORD, 0)).toBe(0);
    expect(chargeFraction(MELEE_SWORD, SWORD_CHARGE_MS / 2)).toBeCloseTo(0.5);
    expect(chargeFraction(MELEE_SWORD, SWORD_CHARGE_MS)).toBe(1);
    expect(chargeFraction(MELEE_SWORD, SWORD_CHARGE_MS * 3)).toBe(1);
    expect(chargeFraction(MELEE_AXE, 550)).toBeCloseTo(0.5);
    expect(chargeFraction(MELEE_SWORD, -10)).toBe(0);
    expect(MELEE_MIN_CHARGE_FRACTION).toBeGreaterThan(0);
    expect(MELEE_MIN_CHARGE_FRACTION).toBeLessThan(0.5);
  });
});
