import { describe, expect, it } from 'vitest';
import { SWORD_CHARGE_MS, WEAPON_PISTOL, WEAPON_MELEE } from '@mineshoot/shared';
import {
  CHARGE_PITCH,
  GUN_IDLE_PITCH,
  HumanoidAnim,
  MUZZLE_FLASH_MS,
  RELOAD_PITCH,
  SHOT_KICK_MS,
  SWING_MS,
  SWORD_IDLE_PITCH,
  SWORD_IDLE_TILT,
} from '../src/render/humanoidAnim';

describe('HumanoidAnim', () => {
  it('holds the gun and the sword at visibly different arm angles', () => {
    const a = new HumanoidAnim();
    a.setWeapon(WEAPON_PISTOL);
    expect(a.pose(0).armPitch).toBe(GUN_IDLE_PITCH);
    a.setWeapon(WEAPON_MELEE);
    expect(a.pose(0).armPitch).toBe(SWORD_IDLE_PITCH);
    expect(Math.abs(GUN_IDLE_PITCH - SWORD_IDLE_PITCH)).toBeGreaterThan(0.5);
  });

  it('rests the sword in a guard stance: arm forward, blade tilted up off the arm', () => {
    const a = new HumanoidAnim();
    a.setWeapon(WEAPON_MELEE);
    // Arm reaches forward (not hanging), blade bent up at the wrist so it stands in front of the body.
    expect(SWORD_IDLE_PITCH).toBeGreaterThan(Math.PI / 4);
    expect(SWORD_IDLE_TILT).toBeGreaterThan(0.6);
    expect(a.pose(0).bladeTilt).toBe(SWORD_IDLE_TILT);
    a.setWeapon(WEAPON_PISTOL);
    expect(a.pose(0).bladeTilt).toBe(0);
  });

  it('straightens the wrist for the wind-up and the swings so chops follow the arm', () => {
    const a = new HumanoidAnim();
    a.setWeapon(WEAPON_MELEE);
    a.setCharging(true, 1000);
    expect(a.pose(1000).bladeTilt).toBeCloseTo(SWORD_IDLE_TILT, 5);
    expect(a.pose(1000 + SWORD_CHARGE_MS).bladeTilt).toBe(0);
    a.setCharging(false, 1000 + SWORD_CHARGE_MS);
    a.swing(1000 + SWORD_CHARGE_MS, 'overhead', true);
    expect(a.pose(1000 + SWORD_CHARGE_MS + SWING_MS / 2).bladeTilt).toBe(0);
    expect(a.pose(1000 + SWORD_CHARGE_MS + SWING_MS + 1).bladeTilt).toBe(SWORD_IDLE_TILT);
  });

  it('winds the sword arm back and glows while charging, reaching full at SWORD_CHARGE_MS', () => {
    const a = new HumanoidAnim();
    a.setWeapon(WEAPON_MELEE);
    a.setCharging(true, 1000);
    const start = a.pose(1000);
    const mid = a.pose(1000 + SWORD_CHARGE_MS / 2);
    const full = a.pose(1000 + SWORD_CHARGE_MS);
    expect(start.swordGlow).toBe(0);
    expect(mid.swordGlow).toBeGreaterThan(0.3);
    expect(mid.swordGlow).toBeLessThan(0.7);
    expect(full.swordGlow).toBe(1);
    expect(a.pose(1000 + SWORD_CHARGE_MS * 3).swordGlow).toBe(1);
    // Arm travels from idle towards the wind-up angle.
    expect(Math.abs(mid.armPitch - CHARGE_PITCH)).toBeLessThan(Math.abs(start.armPitch - CHARGE_PITCH));
    expect(full.armPitch).toBeCloseTo(CHARGE_PITCH, 5);
    // Letting go returns to idle.
    a.setCharging(false, 5000);
    expect(a.pose(5000).armPitch).toBe(SWORD_IDLE_PITCH);
    expect(a.pose(5000).swordGlow).toBe(0);
  });

  it('overhead: sweeps the arm forward over SWING_MS then returns to idle', () => {
    const a = new HumanoidAnim();
    a.setWeapon(WEAPON_MELEE);
    a.swing(2000, 'overhead', false);
    const p0 = a.pose(2000);
    const p1 = a.pose(2000 + SWING_MS / 2);
    const p2 = a.pose(2000 + SWING_MS - 1);
    // Starts wound back, ends swept forward-down (pitch decreases monotonically).
    expect(p0.armPitch).toBeGreaterThan(p1.armPitch);
    expect(p1.armPitch).toBeGreaterThan(p2.armPitch);
    expect(p2.armPitch).toBeLessThan(SWORD_IDLE_PITCH);
    expect(a.pose(2000 + SWING_MS + 1).armPitch).toBe(SWORD_IDLE_PITCH);
  });

  it('overhead: gives a heavy swing a wider arc than a light one', () => {
    const light = new HumanoidAnim();
    light.setWeapon(WEAPON_MELEE);
    light.swing(0, 'overhead', false);
    const heavy = new HumanoidAnim();
    heavy.setWeapon(WEAPON_MELEE);
    heavy.swing(0, 'overhead', true);
    const arc = (a: HumanoidAnim): number => a.pose(0).armPitch - a.pose(SWING_MS - 1).armPitch;
    expect(arc(heavy)).toBeGreaterThan(arc(light));
    expect(heavy.pose(0).swordGlow).toBe(1);
    expect(light.pose(0).swordGlow).toBe(0);
  });

  it('a swing takes precedence over a still-set charging flag', () => {
    const a = new HumanoidAnim();
    a.setWeapon(WEAPON_MELEE);
    a.setCharging(true, 0);
    a.swing(SWORD_CHARGE_MS, 'overhead', true);
    const during = a.pose(SWORD_CHARGE_MS + SWING_MS - 1);
    expect(during.armPitch).toBeLessThan(CHARGE_PITCH - 0.5);
  });

  it('slash: rolls the arm sideways, alternating direction on consecutive slashes, then rests', () => {
    const a = new HumanoidAnim();
    a.setWeapon(WEAPON_MELEE);
    expect(a.pose(0).armRoll).toBe(0);
    a.swing(1000, 'slash', false);
    const first = a.pose(1000);
    const mid = a.pose(1000 + SWING_MS / 2);
    expect(Math.abs(first.armRoll)).toBeGreaterThan(0.3);
    expect(Math.sign(first.armRoll)).not.toBe(Math.sign(a.pose(1000 + SWING_MS - 1).armRoll)); // sweeps across
    expect(Math.abs(mid.armRoll)).toBeLessThan(Math.abs(first.armRoll));
    expect(a.pose(1000 + SWING_MS + 1).armRoll).toBe(0);
    expect(a.pose(1000 + SWING_MS + 1).armPitch).toBe(SWORD_IDLE_PITCH);
    a.swing(2000, 'slash', false);
    expect(Math.sign(a.pose(2000).armRoll)).toBe(-Math.sign(first.armRoll));
    a.swing(3000, 'slash', true); // a heavy slash starts glowing
    expect(a.pose(3000).swordGlow).toBe(1);
    expect(Math.sign(a.pose(3000).armRoll)).toBe(Math.sign(first.armRoll));
  });

  it('kicks the gun and flashes the muzzle briefly after a shot', () => {
    const a = new HumanoidAnim();
    a.setWeapon(WEAPON_PISTOL);
    a.shot(3000);
    const p0 = a.pose(3000);
    expect(p0.gunKick).toBeGreaterThan(0);
    expect(p0.muzzleFlash).toBe(true);
    expect(a.pose(3000 + MUZZLE_FLASH_MS + 1).muzzleFlash).toBe(false);
    expect(a.pose(3000 + SHOT_KICK_MS / 2).gunKick).toBeLessThan(p0.gunKick);
    const after = a.pose(3000 + SHOT_KICK_MS + 1);
    expect(after.gunKick).toBe(0);
    expect(after.armPitch).toBe(GUN_IDLE_PITCH);
  });

  it('lowers the gun while reloading and bobs it', () => {
    const a = new HumanoidAnim();
    a.setWeapon(WEAPON_PISTOL);
    a.setReloading(true);
    const p0 = a.pose(0);
    const p1 = a.pose(120);
    expect(RELOAD_PITCH).toBeLessThan(GUN_IDLE_PITCH); // arm hangs lower than the aiming pose
    expect(Math.abs(p0.armPitch - RELOAD_PITCH)).toBeLessThan(0.3);
    expect(p0.armPitch).not.toBe(p1.armPitch);
    a.setReloading(false);
    expect(a.pose(200).armPitch).toBe(GUN_IDLE_PITCH);
  });
});
