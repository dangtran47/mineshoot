import { describe, expect, it } from 'vitest';
import {
  ATTACK_HEAVY,
  ATTACK_LIGHT,
  GUN_COOLDOWN_MS,
  GUN_MAG_SIZE,
  GUN_RELOAD_MS,
  MELEE_AXE,
  MELEE_KATANA,
  MELEE_SCYTHE,
  MELEE_STATS,
  MELEE_MIN_CHARGE_FRACTION,
  MELEE_SWORD,
  SWORD_CHARGE_MAX_MS,
  SWORD_CHARGE_MS,
  SWORD_COOLDOWN_MS,
  WEAPON_PISTOL,
  WEAPON_MELEE,
  meleeChargeMaxMs,
} from '@mineshoot/shared';
import type { AttackKind, Weapon } from '@mineshoot/shared';
import { GRENADE_THROW_CHARGE_MS, GRENADE_THROW_COOLDOWN_MS, GUN_NONE, GUN_RIFLE, GUN_SHOTGUN, GUN_SNIPER, GUN_TASER, WEAPON_GRENADE, WEAPON_PRIMARY, WEAPON_TASER, gunSpec } from '@mineshoot/shared';
import { Weapons } from '../src/game/weapons';

function make(allowed?: Weapon[]): { w: Weapons; log: string[] } {
  const log: string[] = [];
  const w = new Weapons(
    {
      onFire: (slot) => log.push(slot === WEAPON_PISTOL ? 'fire' : `fire:${slot}`),
      onThrow: (c) => log.push(`throw:${c.toFixed(2)}`),
      onChargeStart: () => log.push('charge'),
      onChargeCancel: () => log.push('chargeCancel'),
      onSwing: (a: AttackKind) => log.push(a === ATTACK_HEAVY ? 'swing:heavy' : 'swing'),
      onSwitch: (wp) => log.push(`switch:${wp}`),
      onReload: (slot) => log.push(slot === WEAPON_PISTOL ? 'reload' : `reload:${slot}`),
      onMeleeChange: (k) => log.push(`melee:${k}`),
      onGunChange: (k) => log.push(`gun:${k}`),
      onTaserChange: (k) => log.push(`taser:${k}`),
      onGrenadesChange: (n) => log.push(`nades:${n}`),
    },
    allowed,
  );
  return { w, log };
}

describe('Weapons', () => {
  it('pistol fires on press, once per press (no auto-repeat), gated by the cooldown', () => {
    const { w, log } = make();
    w.mouseDown(0);
    w.update(GUN_COOLDOWN_MS / 2);
    w.update(GUN_COOLDOWN_MS + 1); // held: no auto-repeat
    w.mouseUp(GUN_COOLDOWN_MS + 2);
    w.mouseDown(GUN_COOLDOWN_MS / 3); // inside the cooldown (clock is only advisory here): ignored
    w.mouseUp(GUN_COOLDOWN_MS / 3 + 1);
    w.mouseDown(GUN_COOLDOWN_MS + 3);
    w.mouseUp(GUN_COOLDOWN_MS + 4);
    expect(log).toEqual(['fire', 'fire']);
  });
  it('sword: LMB press is an immediate light swing, gated by the cooldown', () => {
    const { w, log } = make();
    w.select(WEAPON_MELEE);
    w.mouseDown(1000);
    w.mouseUp(1001);
    expect(log).toEqual([`switch:${WEAPON_MELEE}`, 'swing']);
    w.mouseDown(1000 + SWORD_COOLDOWN_MS - 1); // inside cooldown → ignored
    w.mouseUp(1000 + SWORD_COOLDOWN_MS);
    w.mouseDown(1000 + SWORD_COOLDOWN_MS + 1); // cooldown over → another light swing
    w.mouseUp(1000 + SWORD_COOLDOWN_MS + 2);
    expect(log).toEqual([`switch:${WEAPON_MELEE}`, 'swing', 'swing']);
    expect(w.cooldownFraction(1000 + SWORD_COOLDOWN_MS + 1 + SWORD_COOLDOWN_MS)).toBe(1);
    expect(w.chargeFraction(1000 + SWORD_COOLDOWN_MS + 2)).toBeNull();
  });
  it('sword: holding LMB keeps swinging light every cooldown until released; never charges', () => {
    const { w, log } = make();
    w.select(WEAPON_MELEE);
    w.mouseDown(0);
    w.update(SWORD_COOLDOWN_MS - 1);
    expect(log).toEqual([`switch:${WEAPON_MELEE}`, 'swing']);
    w.update(SWORD_COOLDOWN_MS);
    w.update(SWORD_COOLDOWN_MS + 10);
    expect(log).toEqual([`switch:${WEAPON_MELEE}`, 'swing', 'swing']);
    w.update(SWORD_COOLDOWN_MS * 2);
    expect(log).toEqual([`switch:${WEAPON_MELEE}`, 'swing', 'swing', 'swing']);
    expect(w.charging).toBe(false);
    w.mouseUp(SWORD_COOLDOWN_MS * 2 + 1);
    w.update(SWORD_COOLDOWN_MS * 5);
    expect(log).toEqual([`switch:${WEAPON_MELEE}`, 'swing', 'swing', 'swing']);
  });
  it('sword: RMB press starts a charge at once; a tap shorter than the minimum fraction cancels it without a swing', () => {
    const { w, log } = make();
    w.select(WEAPON_MELEE);
    w.altDown(1000);
    expect(log).toEqual([`switch:${WEAPON_MELEE}`, 'charge']);
    expect(w.charging).toBe(true);
    expect(w.chargeFraction(1000 + SWORD_CHARGE_MS / 2)).toBeCloseTo(0.5);
    w.altUp(1000 + SWORD_CHARGE_MS * MELEE_MIN_CHARGE_FRACTION - 1);
    expect(log).toEqual([`switch:${WEAPON_MELEE}`, 'charge', 'chargeCancel']);
    expect(w.chargeFraction(1000 + SWORD_CHARGE_MS)).toBeNull();
    expect(w.charging).toBe(false);
  });
  it('sword: letting go after at least the minimum fraction (but before fully charged) still swings the heavy', () => {
    const { w, log } = make();
    w.select(WEAPON_MELEE);
    w.altDown(1000);
    w.altUp(1000 + SWORD_CHARGE_MS / 2);
    expect(log).toEqual([`switch:${WEAPON_MELEE}`, 'charge', 'swing:heavy']);
    expect(w.charging).toBe(false);
    // …unless the previous swing's recovery is still running: then it is only a cancel.
    w.mouseDown(5000);
    w.mouseUp(5001);
    w.altDown(5002);
    w.altUp(5002 + SWORD_CHARGE_MS / 2);
    expect(log.slice(-3)).toEqual(['swing', 'charge', 'chargeCancel']);
  });
  it('sword: holding RMB at least chargeMs then releasing is the heavy swing', () => {
    const { w, log } = make();
    w.select(WEAPON_MELEE);
    w.altDown(0);
    w.update(SWORD_CHARGE_MS); // holding never swings by itself before the max
    expect(w.chargeFraction(SWORD_CHARGE_MS * 2)).toBe(1);
    w.altUp(SWORD_CHARGE_MS + 5);
    expect(log).toEqual([`switch:${WEAPON_MELEE}`, 'charge', 'swing:heavy']);
    expect(w.chargeFraction(SWORD_CHARGE_MS + 6)).toBeNull();
  });
  it('sword: RMB right after a light swing charges immediately (a full charge outlasts the cooldown)', () => {
    const { w, log } = make();
    w.select(WEAPON_MELEE);
    w.mouseDown(0);
    w.mouseUp(5);
    w.altDown(20);
    expect(log).toEqual([`switch:${WEAPON_MELEE}`, 'swing', 'charge']);
    w.altUp(20 + SWORD_CHARGE_MS);
    expect(log).toEqual([`switch:${WEAPON_MELEE}`, 'swing', 'charge', 'swing:heavy']);
  });
  it('sword: a charge held past meleeChargeMaxMs auto-releases the heavy once; a new press is needed to charge again', () => {
    const { w, log } = make();
    w.select(WEAPON_MELEE);
    w.altDown(0);
    w.update(SWORD_CHARGE_MAX_MS - 1);
    expect(log).toEqual([`switch:${WEAPON_MELEE}`, 'charge']);
    w.update(SWORD_CHARGE_MAX_MS);
    expect(log).toEqual([`switch:${WEAPON_MELEE}`, 'charge', 'swing:heavy']);
    expect(w.chargeFraction(SWORD_CHARGE_MAX_MS)).toBeNull();
    expect(w.cooldownFraction(SWORD_CHARGE_MAX_MS)).toBe(0);
    // Still holding: no new charge, and releasing does not swing again.
    w.update(SWORD_CHARGE_MAX_MS * 2);
    w.altUp(SWORD_CHARGE_MAX_MS * 2 + 1);
    expect(log).toEqual([`switch:${WEAPON_MELEE}`, 'charge', 'swing:heavy']);
    // A fresh press charges again.
    w.altDown(SWORD_CHARGE_MAX_MS * 2 + 2);
    expect(log).toEqual([`switch:${WEAPON_MELEE}`, 'charge', 'swing:heavy', 'charge']);
  });
  it('sword: LMB is ignored while charging (held LMB resumes swinging after the heavy); RMB while charging does nothing', () => {
    const { w, log } = make();
    w.select(WEAPON_MELEE);
    w.altDown(0);
    w.mouseDown(100);
    w.update(SWORD_COOLDOWN_MS + 200);
    w.altDown(300);
    expect(log).toEqual([`switch:${WEAPON_MELEE}`, 'charge']);
    expect(w.chargeFraction(SWORD_CHARGE_MS)).toBe(1);
    w.altUp(SWORD_CHARGE_MS + 1);
    expect(log).toEqual([`switch:${WEAPON_MELEE}`, 'charge', 'swing:heavy']);
    // LMB still held: light swings resume once the heavy has recovered.
    w.update(SWORD_CHARGE_MS + 1 + SWORD_COOLDOWN_MS - 1);
    expect(log).toEqual([`switch:${WEAPON_MELEE}`, 'charge', 'swing:heavy']);
    w.update(SWORD_CHARGE_MS + 1 + SWORD_COOLDOWN_MS);
    expect(log).toEqual([`switch:${WEAPON_MELEE}`, 'charge', 'swing:heavy', 'swing']);
  });
  it('gun: RMB does nothing; holding LMB fires, never charges', () => {
    const { w, log } = make();
    w.altDown(0);
    w.altUp(1);
    w.mouseDown(2);
    w.update(2 + SWORD_CHARGE_MS);
    w.mouseUp(2 + SWORD_CHARGE_MS + 1);
    expect(log.filter((e) => e !== 'fire')).toEqual([]);
    expect(w.chargeFraction(10)).toBeNull();
  });
  it('cancel and weapon switch drop a charge without swinging (and tell the server)', () => {
    const { w, log } = make();
    w.select(WEAPON_MELEE);
    w.altDown(0);
    w.cancel();
    w.altUp(SWORD_CHARGE_MS * 2);
    expect(log).toEqual([`switch:${WEAPON_MELEE}`, 'charge', 'chargeCancel']);
    w.altDown(SWORD_CHARGE_MS * 3);
    w.select(WEAPON_PISTOL);
    w.altUp(SWORD_CHARGE_MS * 5);
    expect(log).toEqual([`switch:${WEAPON_MELEE}`, 'charge', 'chargeCancel', 'charge', 'chargeCancel', `switch:${WEAPON_PISTOL}`]);
    expect(w.chargeFraction(SWORD_CHARGE_MS * 6)).toBeNull();
    // A cancel with no charge going says nothing.
    w.select(WEAPON_MELEE);
    w.mouseDown(SWORD_CHARGE_MS * 7);
    w.cancel();
    expect(log[log.length - 1]).toBe('swing');
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
    w.select(WEAPON_MELEE);
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
    w.select(WEAPON_MELEE);
    w.select(WEAPON_PISTOL);
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
    const sword = make([WEAPON_MELEE]);
    expect(sword.w.current).toBe(WEAPON_MELEE);
    expect(sword.w.canSwitch).toBe(false);
    sword.w.select(WEAPON_PISTOL);
    sword.w.toggle();
    expect(sword.w.current).toBe(WEAPON_MELEE);
    sword.w.mouseDown(0);
    sword.w.mouseUp(10);
    sword.w.altDown(SWORD_COOLDOWN_MS + 1);
    expect(sword.log).toEqual(['swing', 'charge']);

    const gun = make([WEAPON_PISTOL]);
    expect(gun.w.current).toBe(WEAPON_PISTOL);
    gun.w.toggle();
    gun.w.select(WEAPON_MELEE);
    expect(gun.w.current).toBe(WEAPON_PISTOL);
    expect(gun.log).toEqual([]);

    const both = make();
    expect(both.w.canSwitch).toBe(true);
    both.w.toggle();
    expect(both.w.current).toBe(WEAPON_MELEE);
  });
});

describe('Weapons: melee kinds', () => {
  it('starts with the sword; setMelee swaps stats (cooldown, charge, speed scale) and reports it', () => {
    const { w, log } = make();
    expect(w.melee).toBe(MELEE_SWORD);
    expect(w.chargeSpeedScale).toBe(MELEE_STATS[MELEE_SWORD].chargeSpeedScale);
    w.setMelee(MELEE_KATANA);
    expect(log).toEqual([`melee:${MELEE_KATANA}`]);
    expect(w.chargeSpeedScale).toBe(MELEE_STATS[MELEE_KATANA].chargeSpeedScale);
    w.select(WEAPON_MELEE);
    const cd = MELEE_STATS[MELEE_KATANA].attacks[ATTACK_LIGHT].cooldownMs;
    w.mouseDown(1000);
    w.mouseUp(1001);
    w.mouseDown(1000 + cd - 1); // katana cooldown not yet over
    w.mouseUp(1000 + cd);
    w.mouseDown(1000 + cd + 1);
    w.mouseUp(1000 + cd + 2);
    expect(log.filter((e) => e === 'swing')).toHaveLength(2);
    expect(w.cooldownFraction(1000 + cd + 1 + cd / 2)).toBeCloseTo(0.5);
    // Charge threshold follows the kind.
    const charge = MELEE_STATS[MELEE_KATANA].chargeMs;
    const t0 = 5000;
    w.altDown(t0);
    expect(w.chargeFraction(t0 + charge / 2)).toBeCloseTo(0.5);
    w.altUp(t0 + charge + 1);
    expect(log[log.length - 1]).toBe('swing:heavy');
    // A slow weapon: the same hold is only a quarter of its charge → below the minimum, cancelled.
    w.setMelee(MELEE_AXE);
    const t1 = 9000;
    w.altDown(t1);
    w.altUp(t1 + MELEE_STATS[MELEE_AXE].chargeMs * MELEE_MIN_CHARGE_FRACTION - 1);
    expect(log[log.length - 1]).toBe('chargeCancel');
    // Auto-release after chargeMs + hold window.
    const t2 = 12000;
    w.altDown(t2);
    w.update(t2 + meleeChargeMaxMs(MELEE_AXE) - 1);
    expect(log[log.length - 1]).toBe('charge');
    w.update(t2 + meleeChargeMaxMs(MELEE_AXE));
    expect(log[log.length - 1]).toBe('swing:heavy');
    // The heavy's own cooldown gates the next light.
    expect(w.cooldownFraction(t2 + meleeChargeMaxMs(MELEE_AXE) + MELEE_STATS[MELEE_AXE].attacks[ATTACK_HEAVY].cooldownMs)).toBe(1);
  });
  it('setMelee with the same kind is a no-op; changing kind mid-charge drops the charge', () => {
    const { w, log } = make();
    w.setMelee(MELEE_SWORD);
    expect(log).toEqual([]);
    w.select(WEAPON_MELEE);
    w.altDown(0);
    w.setMelee(MELEE_SCYTHE);
    w.altUp(5000);
    expect(log).toEqual([`switch:${WEAPON_MELEE}`, 'charge', 'chargeCancel', `melee:${MELEE_SCYTHE}`]);
    expect(w.chargeFraction(6000)).toBeNull();
  });

  describe('flag carrier lock (CTF)', () => {
    it('locking forces the melee weapon out and ignores gun selection until unlocked', () => {
      const { w, log } = make();
      expect(w.current).toBe(WEAPON_PISTOL);
      w.setLockedToMelee(true);
      expect(w.current).toBe(WEAPON_MELEE);
      expect(log).toEqual([`switch:${WEAPON_MELEE}`]);
      w.select(WEAPON_PISTOL);
      w.toggle();
      expect(w.current).toBe(WEAPON_MELEE);
      w.mouseDown(0);
      expect(log).toContain('swing'); // melee still works
      w.setLockedToMelee(false);
      w.select(WEAPON_PISTOL);
      expect(w.current).toBe(WEAPON_PISTOL);
    });
    it('with no melee in the allowed list the carrier keeps the gun but cannot fire', () => {
      const { w, log } = make([WEAPON_PISTOL]);
      w.setLockedToMelee(true);
      expect(w.current).toBe(WEAPON_PISTOL);
      w.mouseDown(0);
      w.update(GUN_COOLDOWN_MS + 1);
      expect(log).not.toContain('fire');
      w.mouseUp(GUN_COOLDOWN_MS + 2);
      w.setLockedToMelee(false);
      w.mouseDown(GUN_COOLDOWN_MS + 3);
      expect(log).toContain('fire');
    });
    it('locking again is a no-op and does not re-emit switch', () => {
      const { w, log } = make();
      w.setLockedToMelee(true);
      w.setLockedToMelee(true);
      expect(log.filter((l) => l.startsWith('switch'))).toHaveLength(1);
    });
  });
});

describe('Weapons: four slots', () => {
  it('starts on the pistol; the empty primary and empty grenade slot cannot be selected', () => {
    const { w, log } = make();
    expect(w.current).toBe(WEAPON_PISTOL);
    w.select(WEAPON_PRIMARY);
    expect(w.current).toBe(WEAPON_PISTOL);
    w.setGun(GUN_RIFLE);
    w.select(WEAPON_PRIMARY);
    expect(w.current).toBe(WEAPON_PRIMARY);
    expect(log).toEqual([`gun:${GUN_RIFLE}`, `switch:${WEAPON_PRIMARY}`]);
    w.setGrenades(0);
    w.select(WEAPON_GRENADE);
    expect(w.current).toBe(WEAPON_PRIMARY);
  });
  it('next() cycles through usable slots in key order and skips empty ones', () => {
    const { w } = make();
    // primary empty, grenades 2 → pistol → melee → grenade → pistol
    w.next(1);
    expect(w.current).toBe(WEAPON_MELEE);
    w.next(1);
    expect(w.current).toBe(WEAPON_GRENADE);
    w.next(1);
    expect(w.current).toBe(WEAPON_PISTOL);
    w.next(-1);
    expect(w.current).toBe(WEAPON_GRENADE);
  });
  it('the primary has its own magazine, auto-fires while held and reloads with its own timing', () => {
    const { w, log } = make();
    w.setGun(GUN_RIFLE);
    w.select(WEAPON_PRIMARY);
    const s = gunSpec(GUN_RIFLE);
    expect(w.ammo).toBe(s.magSize);
    w.mouseDown(0);
    w.update(s.cooldownMs + 1);
    w.update(s.cooldownMs * 2 + 2);
    w.mouseUp(s.cooldownMs * 2 + 3);
    expect(log.filter((l) => l === `fire:${WEAPON_PRIMARY}`)).toHaveLength(3);
    expect(w.ammo).toBe(s.magSize - 3);
    expect(w.ammoOf(WEAPON_PISTOL)).toBe(GUN_MAG_SIZE);
    w.reload(1000);
    expect(log.at(-1)).toBe(`reload:${WEAPON_PRIMARY}`);
    w.update(1000 + s.reloadMs - 1);
    expect(w.ammo).toBe(s.magSize - 3);
    w.update(1000 + s.reloadMs);
    expect(w.ammo).toBe(s.magSize);
  });
  it('taser: its own slot (key 5), two shots then it empties and we fall back to the pistol', () => {
    const { w, log } = make();
    w.setGun(GUN_RIFLE); // the primary slot is untouched by the taser
    w.setTaser(GUN_TASER);
    w.select(WEAPON_TASER);
    w.mouseDown(0);
    w.mouseUp(1);
    w.mouseDown(2000);
    w.mouseUp(2001);
    expect(log.filter((l) => l === `fire:${WEAPON_TASER}`)).toHaveLength(2);
    expect(w.taser).toBe(GUN_NONE);
    expect(w.gun).toBe(GUN_RIFLE);
    expect(w.current).toBe(WEAPON_PISTOL);
    w.reload(3000); // nothing to reload on the pistol (full)
    expect(log.filter((l) => l.startsWith('reload'))).toHaveLength(0);
  });
  it('grenades: hold LMB to charge the throw, release throws; switching away cancels; empty slot switches away', () => {
    const { w, log } = make();
    w.select(WEAPON_GRENADE);
    w.mouseDown(0);
    w.update(300);
    expect(log.filter((l) => l.startsWith('throw'))).toHaveLength(0); // still held: no auto-release
    w.mouseUp(GRENADE_THROW_CHARGE_MS); // full charge
    expect(log.at(-2)).toBe('throw:1.00');
    expect(w.grenades).toBe(1);
    // tap released inside the cooldown: put back, not thrown
    w.mouseDown(GRENADE_THROW_CHARGE_MS + 10);
    w.mouseUp(GRENADE_THROW_CHARGE_MS + 20);
    expect(log.filter((l) => l.startsWith('throw'))).toHaveLength(1);
    expect(w.grenades).toBe(1);
    // hold, then switch away: nothing thrown, stock kept
    const t2 = GRENADE_THROW_CHARGE_MS + GRENADE_THROW_COOLDOWN_MS + 100;
    w.mouseDown(t2);
    w.select(WEAPON_PISTOL);
    w.mouseUp(t2 + 500);
    expect(log.filter((l) => l.startsWith('throw'))).toHaveLength(1);
    expect(w.grenades).toBe(1);
    // back on the slot: a quick tap is a weak throw
    w.select(WEAPON_GRENADE);
    w.mouseDown(5000);
    w.mouseUp(5090);
    // Events: throw → nades:0 → switch (the emptied slot falls back)
    expect(log.at(-3)).toBe(`throw:${(90 / GRENADE_THROW_CHARGE_MS).toFixed(2)}`);
    expect(w.grenades).toBe(0);
    expect(w.current).toBe(WEAPON_PISTOL); // empty slot switches away
    w.setGrenades(2);
    expect(log.at(-1)).toBe('nades:2');
  });
  it('sniper zooms while RMB is held', () => {
    const { w } = make();
    w.setGun(GUN_SNIPER);
    w.select(WEAPON_PRIMARY);
    w.altDown(0);
    expect(w.zooming).toBe(true);
    expect(w.zoomFactor).toBe(gunSpec(GUN_SNIPER).zoom);
    w.altUp(1);
    expect(w.zooming).toBe(false);
    w.select(WEAPON_PISTOL);
    w.altDown(2);
    expect(w.zooming).toBe(false);
  });
  it('setGun/setGrenades come from the server (pickup / respawn) and are idempotent', () => {
    const { w, log } = make();
    w.setGun(GUN_SHOTGUN);
    w.setGun(GUN_SHOTGUN);
    w.setGrenades(2); // already 2
    expect(log).toEqual([`gun:${GUN_SHOTGUN}`]);
    w.select(WEAPON_PRIMARY);
    w.setGun(GUN_NONE); // died / consumed
    expect(w.current).toBe(WEAPON_PISTOL);
  });
});
