import {
  ATTACK_HEAVY,
  ATTACK_LIGHT,
  GUN_COOLDOWN_MS,
  GUN_MAG_SIZE,
  GUN_RELOAD_MS,
  MELEE_MIN_CHARGE_FRACTION,
  MELEE_SWORD,
  WEAPON_GUN,
  WEAPON_SWORD,
  attackSpec,
  chargeFraction,
  meleeChargeMaxMs,
  meleeStats,
} from '@mineshoot/shared';
import type { AttackKind, MeleeKind, MeleeStats, Weapon } from '@mineshoot/shared';

export interface WeaponEvents {
  onFire(): void;
  /** RMB pressed with melee: a charge begins (release = heavy). */
  onChargeStart(): void;
  /** RMB was let go (or the charge dropped) before the heavy was ready: no swing. Only after onChargeStart. */
  onChargeCancel(): void;
  onSwing(attack: AttackKind): void;
  onSwitch(w: Weapon): void;
  /** Gun reload started (finishes GUN_RELOAD_MS later unless cancelled by a weapon switch). */
  onReload(): void;
  /** The melee slot now holds a different weapon (picked up a drop / lost it on death). */
  onMeleeChange(kind: MeleeKind): void;
}

/**
 * Local weapon state: selection, cooldowns, ammo, mouse handling. The gun
 * fires on LMB press and auto-repeats while held, spending one round per shot
 * from a GUN_MAG_SIZE magazine (unlimited reloads). Melee: LMB swings light on
 * press and keeps swinging every cooldown while held (the animation alternates
 * left/right); RMB charges while held and releases the heavy — fully charged
 * after chargeMs, at proportional damage (server-decided) if let go earlier but
 * past MELEE_MIN_CHARGE_FRACTION of it; a shorter tap cancels. Holding past the
 * grace window releases the heavy by itself and RMB must be pressed again to
 * charge anew. LMB is ignored while charging. Every attack's own recovery
 * (cooldownMs) gates the next one.
 * Timings come from the melee weapon currently in the slot (sword by default,
 * or a picked-up drop: see setMelee).
 */
export class Weapons {
  current: Weapon;
  /** Rounds left in the gun magazine. */
  ammo = GUN_MAG_SIZE;
  /** Melee weapon in slot 2. */
  melee: MeleeKind = MELEE_SWORD;
  private stats: MeleeStats = meleeStats(MELEE_SWORD);
  private readonly allowed: readonly Weapon[];
  private lastFireAt = -Infinity;
  private lastSwingAt = -Infinity;
  private lastAttack: AttackKind = ATTACK_LIGHT;
  private holding = false;
  private chargeStartAt: number | null = null;
  private reloadStartAt: number | null = null;
  /** CTF flag carrier: melee only (the gun cannot be selected or fired). */
  private lockedToMelee = false;

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

  /**
   * CTF: while carrying a flag the player is melee-only. Locking brings the
   * melee weapon out where the room allows it; in a gun-only room the gun
   * stays out but will not fire. Unlocking just lifts the restriction.
   */
  setLockedToMelee(locked: boolean): void {
    if (locked === this.lockedToMelee) return;
    this.lockedToMelee = locked;
    if (locked && this.allowed.includes(WEAPON_SWORD)) this.select(WEAPON_SWORD);
  }

  get meleeLocked(): boolean {
    return this.lockedToMelee;
  }

  select(w: Weapon): void {
    if (w === this.current || !this.allowed.includes(w)) return;
    if (w === WEAPON_GUN && this.lockedToMelee) return;
    this.cancel();
    this.reloadStartAt = null;
    this.current = w;
    this.events.onSwitch(w);
  }

  toggle(): void {
    this.select(this.current === WEAPON_GUN ? WEAPON_SWORD : WEAPON_GUN);
  }

  /** Put a different melee weapon in slot 2 (server-driven: pickup or respawn). Drops any held charge. */
  setMelee(kind: MeleeKind): void {
    if (kind === this.melee) return;
    this.melee = kind;
    this.stats = meleeStats(kind);
    this.dropCharge();
    this.events.onMeleeChange(kind);
  }

  /** Walk-speed multiplier to apply while charging the current melee weapon. */
  get chargeSpeedScale(): number {
    return this.stats.chargeSpeedScale;
  }

  /** Primary button (LMB): gun fires; melee swings light (repeats while held, see update). Ignored while charging. */
  mouseDown(now: number): void {
    this.holding = true;
    if (this.current === WEAPON_GUN) this.tryFire(now);
    else this.tryLight(now);
  }

  mouseUp(_now: number = performance.now()): void {
    this.holding = false;
  }

  /** Secondary button (RMB): starts a melee charge (release = heavy); nothing with the gun or while already charging. */
  altDown(now: number): void {
    if (this.current !== WEAPON_SWORD || this.chargeStartAt !== null) return;
    this.chargeStartAt = now;
    this.events.onChargeStart();
  }

  altUp(now: number = performance.now()): void {
    if (this.chargeStartAt !== null) this.release(now);
  }

  /** Drop any held state without attacking (pointer unlock, death, weapon switch). */
  cancel(): void {
    this.holding = false;
    this.dropCharge();
  }

  /** True while a melee charge is held (used to slow movement). */
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

  /** Finish a due reload; auto-repeat while LMB is held (gun shots / light swings); auto-release an over-held charge. */
  update(now: number): void {
    if (this.reloadStartAt !== null && now - this.reloadStartAt >= GUN_RELOAD_MS) {
      this.reloadStartAt = null;
      this.ammo = GUN_MAG_SIZE;
    }
    if (this.holding) {
      if (this.current === WEAPON_GUN) this.tryFire(now);
      else this.tryLight(now);
    }
    if (this.chargeStartAt !== null && now - this.chargeStartAt >= meleeChargeMaxMs(this.melee)) this.release(now);
  }

  /** 0..1 while the gun is reloading, null otherwise. */
  reloadFraction(now: number): number | null {
    if (this.reloadStartAt === null) return null;
    return Math.min(1, (now - this.reloadStartAt) / GUN_RELOAD_MS);
  }

  /** 0..1 while a melee charge is held (1 = charged), null otherwise. */
  chargeFraction(now: number): number | null {
    if (this.chargeStartAt === null) return null;
    return Math.min(1, (now - this.chargeStartAt) / this.stats.chargeMs);
  }

  cooldownFraction(now: number): number {
    const cd = this.current === WEAPON_GUN ? GUN_COOLDOWN_MS : attackSpec(this.melee, this.lastAttack).cooldownMs;
    const last = this.current === WEAPON_GUN ? this.lastFireAt : this.lastSwingAt;
    return Math.min(1, (now - last) / cd);
  }

  /** The previous melee attack's recovery is over. */
  private ready(now: number): boolean {
    return now - this.lastSwingAt >= attackSpec(this.melee, this.lastAttack).cooldownMs;
  }

  /** Light swing if recovered and not charging. */
  private tryLight(now: number): void {
    if (this.chargeStartAt === null && this.ready(now)) this.swing(now, ATTACK_LIGHT);
  }

  private swing(now: number, attack: AttackKind): void {
    this.lastSwingAt = now;
    this.lastAttack = attack;
    this.events.onSwing(attack);
  }

  /** Let go of a charge: the heavy if held at least the minimum fraction (and recovered), otherwise a cancel. */
  private release(now: number): void {
    const enough = chargeFraction(this.melee, now - this.chargeStartAt!) >= MELEE_MIN_CHARGE_FRACTION;
    this.chargeStartAt = null;
    if (enough && this.ready(now)) this.swing(now, ATTACK_HEAVY);
    else this.events.onChargeCancel();
  }

  /** Forget a charge without swinging; the server is told if it had been announced. */
  private dropCharge(): void {
    if (this.chargeStartAt === null) return;
    this.chargeStartAt = null;
    this.events.onChargeCancel();
  }

  private tryFire(now: number): void {
    if (this.lockedToMelee || this.reloadStartAt !== null) return;
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
