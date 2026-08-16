import { describe, expect, it } from 'vitest';
import { GUN_COOLDOWN_MS, GUN_MAG_SIZE, GUN_RELOAD_MS, SWORD_CHARGE_MAX_MS, SWORD_CHARGE_MS, SWORD_COOLDOWN_MS, WEAPON_GUN, WEAPON_SWORD } from '@mineshoot/shared';
import type { Weapon } from '@mineshoot/shared';
import { Weapons } from '../src/game/weapons';

function make(allowed?: Weapon[]): { w: Weapons; log: string[] } {
  const log: string[] = [];
  const w = new Weapons(
    {
      onFire: () => log.push('fire'),
      onChargeStart: () => log.push('charge'),
      onSwing: (charged) => log.push(charged ? 'swing:charged' : 'swing'),
      onSwitch: (wp) => log.push(`switch:${wp}`),
      onReload: () => log.push('reload'),
    },
    allowed,
  );
  return { w, log };
}

describe('Weapons', () => {
  it('gun fires on press and auto-repeats after the cooldown', () => {
    const { w, log } = make();
    w.mouseDown(0);
    w.update(GUN_COOLDOWN_MS / 2);
    w.update(GUN_COOLDOWN_MS + 1);
    w.mouseUp(GUN_COOLDOWN_MS + 2);
    expect(log).toEqual(['fire', 'fire']);
  });
  it('sword: LMB press is an immediate light swing, gated by the cooldown; holding never charges', () => {
    const { w, log } = make();
    w.select(WEAPON_SWORD);
    w.mouseDown(1000);
    expect(log).toEqual([`switch:${WEAPON_SWORD}`, 'swing']);
    expect(w.chargeFraction(1000 + SWORD_CHARGE_MS)).toBeNull();
    w.update(1000 + SWORD_CHARGE_MAX_MS); // holding LMB does nothing more
    w.mouseUp(1000 + SWORD_CHARGE_MAX_MS + 1);
    w.mouseDown(1000 + SWORD_CHARGE_MAX_MS + 2); // cooldown long over → another light swing
    w.mouseUp(1000 + SWORD_CHARGE_MAX_MS + 3);
    w.mouseDown(1000 + SWORD_CHARGE_MAX_MS + 4); // inside cooldown → ignored
    expect(log).toEqual([`switch:${WEAPON_SWORD}`, 'swing', 'swing']);
    expect(w.cooldownFraction(1000 + SWORD_CHARGE_MAX_MS + 2 + SWORD_COOLDOWN_MS)).toBe(1);
  });
  it('sword: RMB press starts a charge, an early release is only a light swing', () => {
    const { w, log } = make();
    w.select(WEAPON_SWORD);
    w.altDown(1000);
    expect(w.chargeFraction(1000 + SWORD_CHARGE_MS / 2)).toBeCloseTo(0.5);
    w.altUp(1100);
    expect(log).toEqual([`switch:${WEAPON_SWORD}`, 'charge', 'swing']);
    expect(w.chargeFraction(1200)).toBeNull();
  });
  it('sword: LMB during a charge is ignored; the charge keeps going', () => {
    const { w, log } = make();
    w.select(WEAPON_SWORD);
    w.altDown(0);
    w.mouseDown(100);
    w.mouseUp(110);
    expect(log).toEqual([`switch:${WEAPON_SWORD}`, 'charge']);
    expect(w.chargeFraction(SWORD_CHARGE_MS)).toBe(1);
    w.altUp(SWORD_CHARGE_MS + 1);
    expect(log).toEqual([`switch:${WEAPON_SWORD}`, 'charge', 'swing:charged']);
  });
  it('sword: holding RMB past SWORD_CHARGE_MAX_MS auto-releases a charged swing once; a new press is needed to charge again', () => {
    const { w, log } = make();
    w.select(WEAPON_SWORD);
    w.altDown(0);
    w.update(SWORD_CHARGE_MAX_MS - 1);
    expect(log).toEqual([`switch:${WEAPON_SWORD}`, 'charge']);
    w.update(SWORD_CHARGE_MAX_MS);
    expect(log).toEqual([`switch:${WEAPON_SWORD}`, 'charge', 'swing:charged']);
    expect(w.chargeFraction(SWORD_CHARGE_MAX_MS)).toBeNull();
    expect(w.cooldownFraction(SWORD_CHARGE_MAX_MS)).toBe(0);
    // Still holding: nothing more happens, and releasing does not swing again.
    w.update(SWORD_CHARGE_MAX_MS * 2);
    w.altUp(SWORD_CHARGE_MAX_MS * 2 + 1);
    expect(log).toEqual([`switch:${WEAPON_SWORD}`, 'charge', 'swing:charged']);
    // A fresh press after the cooldown starts a new charge.
    w.altDown(SWORD_CHARGE_MAX_MS * 2 + SWORD_COOLDOWN_MS + 2);
    expect(log).toEqual([`switch:${WEAPON_SWORD}`, 'charge', 'swing:charged', 'charge']);
  });
  it('sword: holding RMB at least SWORD_CHARGE_MS then releasing is a charged swing', () => {
    const { w, log } = make();
    w.select(WEAPON_SWORD);
    w.altDown(0);
    w.update(SWORD_CHARGE_MS); // holding never swings by itself before the max
    expect(w.chargeFraction(SWORD_CHARGE_MS * 2)).toBe(1);
    w.altUp(SWORD_CHARGE_MS + 5);
    expect(log).toEqual([`switch:${WEAPON_SWORD}`, 'charge', 'swing:charged']);
  });
  it('sword: RMB during the swing cooldown does not start a charge', () => {
    const { w, log } = make();
    w.select(WEAPON_SWORD);
    w.mouseDown(0);
    w.mouseUp(10);
    w.altDown(20);
    expect(w.chargeFraction(30)).toBeNull();
    w.altUp(40);
    w.altDown(SWORD_COOLDOWN_MS + 1);
    expect(log).toEqual([`switch:${WEAPON_SWORD}`, 'swing', 'charge']);
  });
  it('gun: RMB does nothing', () => {
    const { w, log } = make();
    w.altDown(0);
    w.update(SWORD_CHARGE_MAX_MS);
    w.altUp(SWORD_CHARGE_MAX_MS + 1);
    expect(log).toEqual([]);
    expect(w.chargeFraction(10)).toBeNull();
  });
  it('cancel and weapon switch drop the charge without swinging', () => {
    const { w, log } = make();
    w.select(WEAPON_SWORD);
    w.altDown(0);
    w.cancel();
    w.altUp(SWORD_CHARGE_MS * 2);
    w.altDown(SWORD_CHARGE_MS * 3);
    w.select(WEAPON_GUN);
    w.altUp(SWORD_CHARGE_MS * 5);
    expect(log).toEqual([`switch:${WEAPON_SWORD}`, 'charge', 'charge', `switch:${WEAPON_GUN}`]);
    expect(w.chargeFraction(SWORD_CHARGE_MS * 6)).toBeNull();
  });

  it('gun: each shot spends a round; an empty magazine auto-reloads instead of firing', () => {
    const { w, log } = make();
    expect(w.ammo).toBe(GUN_MAG_SIZE);
    let t = 0;
    for (let i = 0; i < GUN_MAG_SIZE; i++, t += GUN_COOLDOWN_MS) {
      w.mouseDown(t);
      w.mouseUp(t + 1);
    }
    expect(w.ammo).toBe(0);
    expect(log.filter((e) => e === 'fire')).toHaveLength(GUN_MAG_SIZE);
    // Empty: the trigger starts a reload, no shot; further pulls during the reload do nothing.
    w.mouseDown(t);
    w.mouseUp(t + 1);
    expect(log[log.length - 1]).toBe('reload');
    expect(w.reloadFraction(t + GUN_RELOAD_MS / 2)).toBeCloseTo(0.5);
    w.mouseDown(t + GUN_RELOAD_MS / 2);
    w.update(t + GUN_RELOAD_MS / 2 + 1);
    w.mouseUp(t + GUN_RELOAD_MS / 2 + 2);
    expect(log.filter((e) => e === 'fire')).toHaveLength(GUN_MAG_SIZE);
    // Reload completes on update; the magazine is full and the gun fires again.
    w.update(t + GUN_RELOAD_MS);
    expect(w.reloadFraction(t + GUN_RELOAD_MS)).toBeNull();
    expect(w.ammo).toBe(GUN_MAG_SIZE);
    w.mouseDown(t + GUN_RELOAD_MS + 1);
    w.mouseUp(t + GUN_RELOAD_MS + 2);
    expect(w.ammo).toBe(GUN_MAG_SIZE - 1);
    expect(log.filter((e) => e === 'fire')).toHaveLength(GUN_MAG_SIZE + 1);
  });
  it('gun: manual reload tops up a partial magazine; a full one or a sword ignores it', () => {
    const { w, log } = make();
    w.reload(0);
    expect(log).toEqual([]);
    w.mouseDown(0);
    w.mouseUp(1);
    w.reload(10);
    expect(log).toEqual(['fire', 'reload']);
    w.reload(20); // already reloading
    expect(log).toEqual(['fire', 'reload']);
    w.update(10 + GUN_RELOAD_MS);
    expect(w.ammo).toBe(GUN_MAG_SIZE);
    w.select(WEAPON_SWORD);
    w.mouseDown(GUN_RELOAD_MS + 100);
    w.mouseUp(GUN_RELOAD_MS + 110);
    w.reload(GUN_RELOAD_MS + 200);
    expect(log.filter((e) => e === 'reload')).toHaveLength(1);
  });
  it('gun: switching weapons cancels a reload (rounds kept); resetAmmo refills on respawn', () => {
    const { w, log } = make();
    w.mouseDown(0);
    w.mouseUp(1);
    w.mouseDown(GUN_COOLDOWN_MS);
    w.mouseUp(GUN_COOLDOWN_MS + 1);
    w.reload(1000);
    w.select(WEAPON_SWORD);
    w.select(WEAPON_GUN);
    expect(w.reloadFraction(1100)).toBeNull();
    expect(w.ammo).toBe(GUN_MAG_SIZE - 2);
    w.mouseDown(1200);
    w.mouseUp(1201);
    expect(w.ammo).toBe(GUN_MAG_SIZE - 3);
    expect(log.filter((e) => e === 'fire')).toHaveLength(3);
    w.resetAmmo();
    expect(w.ammo).toBe(GUN_MAG_SIZE);
    expect(w.reloadFraction(1300)).toBeNull();
  });

  it('room weapon rules: starts on the only allowed weapon and refuses to switch away', () => {
    const sword = make([WEAPON_SWORD]);
    expect(sword.w.current).toBe(WEAPON_SWORD);
    expect(sword.w.canSwitch).toBe(false);
    sword.w.select(WEAPON_GUN);
    sword.w.toggle();
    expect(sword.w.current).toBe(WEAPON_SWORD);
    sword.w.mouseDown(0);
    sword.w.mouseUp(10);
    sword.w.altDown(SWORD_COOLDOWN_MS + 1);
    expect(sword.log).toEqual(['swing', 'charge']);

    const gun = make([WEAPON_GUN]);
    expect(gun.w.current).toBe(WEAPON_GUN);
    gun.w.toggle();
    gun.w.select(WEAPON_SWORD);
    expect(gun.w.current).toBe(WEAPON_GUN);
    expect(gun.log).toEqual([]);

    const both = make();
    expect(both.w.canSwitch).toBe(true);
    both.w.toggle();
    expect(both.w.current).toBe(WEAPON_SWORD);
  });
});
