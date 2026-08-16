import { GUN_COOLDOWN_MS, GUN_MAG_SIZE, GUN_RELOAD_MS, SWORD_CHARGE_MAX_MS, SWORD_CHARGE_MS, SWORD_COOLDOWN_MS, WEAPON_GUN, WEAPON_SWORD } from '@mineshoot/shared';
import type { Weapon } from '@mineshoot/shared';

export interface WeaponEvents {
  onFire(): void;
  /** Sword RMB pressed: a charge begins (release swings). */
  onChargeStart(): void;
  onSwing(charged: boolean): void;
  onSwitch(w: Weapon): void;
  /** Gun reload started (finishes GUN_RELOAD_MS later unless cancelled by a weapon switch). */
  onReload(): void;
}

/**
 * Local weapon state: selection, cooldowns, ammo, mouse handling. The gun
 * fires on LMB press and auto-repeats while held, spending one round per shot
 * from a GUN_MAG_SIZE magazine (unlimited reloads). The sword swings light on
 * LMB press; RMB charges while held and swings on release (charged if held for
 * SWORD_CHARGE_MS, light otherwise). Holding RMB past SWORD_CHARGE_MAX_MS
 * releases the swing by itself; RMB must then be pressed again to charge anew.
 */
export class Weapons {
  current: Weapon;
  /** Rounds left in the gun magazine. */
  ammo = GUN_MAG_SIZE;
  private readonly allowed: readonly Weapon[];
  private lastFireAt = -Infinity;
  private lastSwingAt = -Infinity;
  private holding = false;
  private chargeStartAt: number | null = null;
  private reloadStartAt: number | null = null;

  /** `allowed` = the room's weapon rule (default: gun and sword); the first entry is the starting weapon. */
  constructor(
    private readonly events: WeaponEvents,
    allowed: readonly Weapon[] = [WEAPON_GUN, WEAPON_SWORD],
  ) {
    this.allowed = allowed.length > 0 ? allowed : [WEAPON_GUN];
    this.current = this.allowed[0];
  }

  /** False when the room allows a single weapon (switch keys / wheel do nothing). */
  get canSwitch(): boolean {
    return this.allowed.length > 1;
  }

  select(w: Weapon): void {
    if (w === this.current || !this.allowed.includes(w)) return;
    this.cancel();
    this.reloadStartAt = null;
    this.current = w;
    this.events.onSwitch(w);
  }

  toggle(): void {
    this.select(this.current === WEAPON_GUN ? WEAPON_SWORD : WEAPON_GUN);
  }

  /** Primary button (LMB): gun fires, sword swings light (unless a charge is in progress). */
  mouseDown(now: number): void {
    this.holding = true;
    if (this.current === WEAPON_GUN) {
      this.tryFire(now);
    } else if (this.chargeStartAt === null && this.swordReady(now)) {
      this.lastSwingAt = now;
      this.events.onSwing(false);
    }
  }

  mouseUp(_now: number = performance.now()): void {
    this.holding = false;
  }

  /** Secondary button (RMB): starts a sword charge; nothing with the gun. */
  altDown(now: number): void {
    if (this.current !== WEAPON_SWORD || this.chargeStartAt !== null || !this.swordReady(now)) return;
    this.chargeStartAt = now;
    this.events.onChargeStart();
  }

  altUp(now: number = performance.now()): void {
    if (this.chargeStartAt !== null) this.swing(now);
  }

  /** Drop any held state without attacking (pointer unlock, death, weapon switch). */
  cancel(): void {
    this.holding = false;
    this.chargeStartAt = null;
  }

  /** True while a sword charge is held (used to slow movement). */
  get charging(): boolean {
    return this.chargeStartAt !== null;
  }

  /** Start a gun reload (R key, or automatically on an empty magazine). No-op if full, reloading, or holding the sword. */
  reload(now: number): void {
    if (this.current !== WEAPON_GUN || this.reloadStartAt !== null || this.ammo >= GUN_MAG_SIZE) return;
    this.reloadStartAt = now;
    this.events.onReload();
  }

  /** Full magazine, no reload in progress (respawn). */
  resetAmmo(): void {
    this.ammo = GUN_MAG_SIZE;
    this.reloadStartAt = null;
  }

  /** Finish a due reload; auto-repeat while the gun button is held; auto-release an over-held sword charge. */
  update(now: number): void {
    if (this.reloadStartAt !== null && now - this.reloadStartAt >= GUN_RELOAD_MS) {
      this.reloadStartAt = null;
      this.ammo = GUN_MAG_SIZE;
    }
    if (this.holding && this.current === WEAPON_GUN) this.tryFire(now);
    if (this.chargeStartAt !== null && now - this.chargeStartAt >= SWORD_CHARGE_MAX_MS) this.swing(now);
  }

  /** 0..1 while the gun is reloading, null otherwise. */
  reloadFraction(now: number): number | null {
    if (this.reloadStartAt === null) return null;
    return Math.min(1, (now - this.reloadStartAt) / GUN_RELOAD_MS);
  }

  /** 0..1 while a sword charge is held (1 = charged), null otherwise. */
  chargeFraction(now: number): number | null {
    if (this.chargeStartAt === null) return null;
    return Math.min(1, (now - this.chargeStartAt) / SWORD_CHARGE_MS);
  }

  cooldownFraction(now: number): number {
    const cd = this.current === WEAPON_GUN ? GUN_COOLDOWN_MS : SWORD_COOLDOWN_MS;
    const last = this.current === WEAPON_GUN ? this.lastFireAt : this.lastSwingAt;
    return Math.min(1, (now - last) / cd);
  }

  private swordReady(now: number): boolean {
    return now - this.lastSwingAt >= SWORD_COOLDOWN_MS;
  }

  /** Release the current charge as a swing (charged if held long enough). */
  private swing(now: number): void {
    const charged = now - this.chargeStartAt! >= SWORD_CHARGE_MS;
    this.chargeStartAt = null;
    this.lastSwingAt = now;
    this.events.onSwing(charged);
  }

  private tryFire(now: number): void {
    if (this.reloadStartAt !== null) return;
    if (this.ammo <= 0) {
      this.reload(now);
      return;
    }
    if (now - this.lastFireAt < GUN_COOLDOWN_MS) return;
    this.lastFireAt = now;
    this.ammo--;
    this.events.onFire();
  }
}
