import {
  ATTACK_HEAVY,
  ATTACK_LIGHT,
  GRENADE_START,
  GRENADE_THROW_CHARGE_MS,
  GRENADE_THROW_COOLDOWN_MS,
  GUN_NONE,
  GUN_PISTOL,
  MELEE_MIN_CHARGE_FRACTION,
  MELEE_SWORD,
  WEAPONS,
  WEAPON_GRENADE,
  WEAPON_MELEE,
  WEAPON_PISTOL,
  WEAPON_PRIMARY,
  WEAPON_TASER,
  attackSpec,
  chargeFraction,
  gunSpec,
  isGunSlot,
  meleeChargeMaxMs,
  meleeStats,
} from '@mineshoot/shared';
import type { AttackKind, GunKind, GunSpec, MeleeKind, MeleeStats, Weapon } from '@mineshoot/shared';

export interface WeaponEvents {
  /** A gun slot fired (WEAPON_PISTOL / WEAPON_PRIMARY). */
  onFire(slot: Weapon): void;
  /** A grenade left the hand; `charge` 0..1 is how long LMB was held (throw speed). */
  onThrow(charge: number): void;
  /** RMB pressed with melee: a charge begins (release = heavy). */
  onChargeStart(): void;
  /** RMB was let go (or the charge dropped) before the heavy was ready: no swing. Only after onChargeStart. */
  onChargeCancel(): void;
  onSwing(attack: AttackKind): void;
  onSwitch(w: Weapon): void;
  /** A gun slot started reloading (finishes reloadMs later unless cancelled by a weapon switch). */
  onReload(slot: Weapon): void;
  /** The melee slot now holds a different weapon (picked up a drop / lost it on death). */
  onMeleeChange(kind: MeleeKind): void;
  /** The primary slot now holds `kind` (GUN_NONE = empty). */
  onGunChange(kind: GunKind): void;
  /** The taser slot now holds `kind` (GUN_NONE = empty / spent). */
  onTaserChange(kind: GunKind): void;
  onGrenadesChange(n: number): void;
}

/** Ammo/reload/cooldown bookkeeping for one gun slot. */
interface GunSlot {
  kind: GunKind;
  ammo: number;
  lastFireAt: number;
  reloadStartAt: number | null;
}

/**
 * Local weapon state for the four slots: primary (a picked-up gun, empty at
 * spawn), pistol, melee and grenades. Guns fire on LMB press (auto guns keep
 * firing while held), spend rounds from their own magazine and reload with
 * their own timing; a consumable gun (taser) empties the primary slot with its
 * last round. Grenades charge while LMB is held (longer hold = farther throw,
 * full power after GRENADE_THROW_CHARGE_MS; hold as long as you like) and only
 * release throws — switching weapons or unlocking the pointer while holding
 * cancels without spending a grenade; one throw per GRENADE_THROW_COOLDOWN_MS. Melee is unchanged: LMB swings light on press and keeps swinging every
 * cooldown while held; RMB charges while held and releases the heavy (fully
 * charged after chargeMs, proportional if let go earlier but past
 * MELEE_MIN_CHARGE_FRACTION; a shorter tap cancels; over-holding releases it).
 * RMB on a gun with `zoom > 1` zooms while held. Slots that cannot be used (no
 * primary, no grenades, not allowed by the room, or gun slots while carrying a
 * flag) cannot be selected; when the held slot empties we fall back to the best
 * other slot. The server owns what is in the slots (setGun/setMelee/setGrenades).
 */
export class Weapons {
  current: Weapon;
  /** Melee weapon in slot 3. */
  melee: MeleeKind = MELEE_SWORD;
  grenades = GRENADE_START;
  private stats: MeleeStats = meleeStats(MELEE_SWORD);
  private readonly guns: Record<number, GunSlot> = {
    [WEAPON_PISTOL]: { kind: GUN_PISTOL, ammo: gunSpec(GUN_PISTOL).magSize, lastFireAt: -Infinity, reloadStartAt: null },
    [WEAPON_PRIMARY]: { kind: GUN_NONE, ammo: 0, lastFireAt: -Infinity, reloadStartAt: null },
    [WEAPON_TASER]: { kind: GUN_NONE, ammo: 0, lastFireAt: -Infinity, reloadStartAt: null },
  };
  private readonly allowed: readonly Weapon[];
  private lastSwingAt = -Infinity;
  private lastThrowAt = -Infinity;
  /** When LMB started holding a grenade throw (null = not holding). */
  private throwStartAt: number | null = null;
  private lastAttack: AttackKind = ATTACK_LIGHT;
  private holding = false;
  private chargeStartAt: number | null = null;
  private zoomHeld = false;
  /** CTF flag carrier: melee only (guns and grenades cannot be selected or used). */
  private lockedToMelee = false;

  /** `allowed` = the room's weapon rule (default: every slot); we start on the pistol (melee in a sword-only room). */
  constructor(
    private readonly events: WeaponEvents,
    allowed: readonly Weapon[] = WEAPONS,
  ) {
    this.allowed = allowed.length > 0 ? allowed : [WEAPON_PISTOL];
    this.current = this.allowed.includes(WEAPON_PISTOL) ? WEAPON_PISTOL : this.allowed.includes(WEAPON_MELEE) ? WEAPON_MELEE : this.allowed[0];
  }

  /** Primary gun in slot 1 (GUN_NONE = empty). */
  get gun(): GunKind {
    return this.guns[WEAPON_PRIMARY].kind;
  }

  /** Taser slot (GUN_TASER or GUN_NONE). */
  get taser(): GunKind {
    return this.guns[WEAPON_TASER].kind;
  }

  /** False when the room allows a single weapon (switch keys / wheel do nothing). */
  get canSwitch(): boolean {
    return this.allowed.length > 1;
  }

  get meleeLocked(): boolean {
    return this.lockedToMelee;
  }

  /** True while a melee charge is held (used to slow movement). */
  get charging(): boolean {
    return this.chargeStartAt !== null;
  }

  /** Walk-speed multiplier to apply while charging the current melee weapon. */
  get chargeSpeedScale(): number {
    return this.stats.chargeSpeedScale;
  }

  /** Rounds in the held gun slot (0 for melee / grenades). */
  get ammo(): number {
    return this.ammoOf(this.current);
  }

  ammoOf(slot: Weapon): number {
    return this.guns[slot]?.ammo ?? 0;
  }

  magOf(slot: Weapon): number {
    const g = this.guns[slot];
    return g ? gunSpec(g.kind).magSize : 0;
  }

  private specOf(slot: Weapon): GunSpec {
    return gunSpec(this.guns[slot].kind);
  }

  /** RMB held on a zooming gun — but never while that gun is reloading (the scope waits for the reload). */
  get zooming(): boolean {
    return this.zoomHeld && isGunSlot(this.current) && this.specOf(this.current).zoom > 1 && this.guns[this.current].reloadStartAt === null;
  }

  get zoomFactor(): number {
    return this.zooming ? this.specOf(this.current).zoom : 1;
  }

  /** The held slot is a gun that zooms (sniper): the crosshair hides until RMB brings the scope up. */
  get zoomCapable(): boolean {
    return isGunSlot(this.current) && this.specOf(this.current).zoom > 1;
  }

  /** Allowed by the room, loaded (primary needs a gun, grenade slot needs stock) and not blocked by the flag lock. */
  canUse(w: Weapon): boolean {
    if (!this.allowed.includes(w)) return false;
    if (w === WEAPON_PRIMARY && this.gun === GUN_NONE) return false;
    if (w === WEAPON_TASER && this.taser === GUN_NONE) return false;
    if (w === WEAPON_GRENADE && this.grenades <= 0) return false;
    if (this.lockedToMelee && w !== WEAPON_MELEE) return false;
    return true;
  }

  /**
   * CTF: while carrying a flag the player is melee-only. Locking brings the
   * melee weapon out where the room allows it; if the allowed list somehow
   * lacks melee, the current weapon stays out but will not fire.
   * Unlocking just lifts the restriction.
   */
  setLockedToMelee(locked: boolean): void {
    if (locked === this.lockedToMelee) return;
    this.lockedToMelee = locked;
    if (locked && this.allowed.includes(WEAPON_MELEE)) this.select(WEAPON_MELEE);
  }

  select(w: Weapon): void {
    if (w === this.current || !this.canUse(w)) return;
    this.cancel();
    for (const g of Object.values(this.guns)) g.reloadStartAt = null;
    this.current = w;
    this.events.onSwitch(w);
  }

  /** Wheel: the next usable slot in key order (dir +1 / -1). */
  next(dir: 1 | -1): void {
    const n = WEAPONS.length;
    const i = WEAPONS.indexOf(this.current);
    for (let step = 1; step < n; step++) {
      const w = WEAPONS[(i + dir * step + n * step) % n];
      if (this.canUse(w)) {
        this.select(w);
        return;
      }
    }
  }

  /** Same as next(1). */
  toggle(): void {
    this.next(1);
  }

  /** The held slot became unusable: fall back to pistol → melee → anything usable. */
  private fallBack(): void {
    if (this.canUse(this.current)) return;
    for (const w of [WEAPON_PISTOL, WEAPON_MELEE, WEAPON_PRIMARY, WEAPON_TASER, WEAPON_GRENADE] as const) {
      if (this.canUse(w)) {
        this.select(w);
        return;
      }
    }
  }

  /** Put a different melee weapon in slot 3 (server-driven: pickup or respawn). Drops any held charge. */
  setMelee(kind: MeleeKind): void {
    if (kind === this.melee) return;
    this.melee = kind;
    this.stats = meleeStats(kind);
    this.dropCharge();
    this.events.onMeleeChange(kind);
  }

  /** Server-driven primary slot: a pickup arms it (full magazine), death empties it. */
  setGun(kind: GunKind): void {
    this.setGunSlot(WEAPON_PRIMARY, kind, () => this.events.onGunChange(kind));
  }

  /** Server-driven taser slot: a pickup arms it (2 charges), death / the last charge empties it. */
  setTaser(kind: GunKind): void {
    this.setGunSlot(WEAPON_TASER, kind, () => this.events.onTaserChange(kind));
  }

  private setGunSlot(slot: Weapon, kind: GunKind, notify: () => void): void {
    const g = this.guns[slot];
    if (kind === g.kind) return;
    g.kind = kind;
    g.ammo = gunSpec(kind).magSize;
    g.reloadStartAt = null;
    g.lastFireAt = -Infinity;
    notify();
    this.fallBack();
  }

  setGrenades(n: number): void {
    if (n === this.grenades) return;
    this.grenades = n;
    this.events.onGrenadesChange(n);
    this.fallBack();
  }

  /** Primary button (LMB): gun fires, grenade throws, melee swings light (repeats while held). Ignored while charging. */
  mouseDown(now: number): void {
    this.holding = true;
    if (isGunSlot(this.current)) this.tryFire(now);
    else if (this.current === WEAPON_GRENADE) this.startThrow(now);
    else this.tryLight(now);
  }

  mouseUp(now: number = performance.now()): void {
    this.holding = false;
    if (this.throwStartAt !== null) this.releaseThrow(now);
  }

  /** Secondary button (RMB): melee charge; zoom on a gun that has one; nothing otherwise. */
  altDown(now: number): void {
    if (this.current === WEAPON_MELEE) {
      if (this.chargeStartAt !== null) return;
      this.chargeStartAt = now;
      this.events.onChargeStart();
    } else if (isGunSlot(this.current)) {
      this.zoomHeld = true;
    }
  }

  altUp(now: number = performance.now()): void {
    this.zoomHeld = false;
    if (this.chargeStartAt !== null) this.release(now);
  }

  /** Drop any held state without attacking (pointer unlock, death, weapon switch). */
  cancel(): void {
    this.holding = false;
    this.zoomHeld = false;
    this.throwStartAt = null; // a held grenade goes back in the pouch, not into the air
    this.dropCharge();
  }

  /** Reload the held gun (R key, or automatically on an empty magazine). No-op if full, reloading, not a gun, or the gun cannot reload. */
  reload(now: number): void {
    if (!isGunSlot(this.current)) return;
    const g = this.guns[this.current];
    const spec = gunSpec(g.kind);
    if (g.kind === GUN_NONE || spec.reloadMs === 0 || g.reloadStartAt !== null || g.ammo >= spec.magSize) return;
    g.reloadStartAt = now;
    this.events.onReload(this.current);
  }

  /** Full magazines, no reload in progress (respawn; the server empties the primary via setGun). */
  resetAmmo(): void {
    for (const g of Object.values(this.guns)) {
      g.ammo = gunSpec(g.kind).magSize;
      g.reloadStartAt = null;
    }
  }

  /** Finish due reloads (per-shell guns load round by round); auto-repeat while LMB is held (auto guns / throws / light swings); auto-release an over-held charge. */
  update(now: number): void {
    for (const g of Object.values(this.guns)) {
      const spec = gunSpec(g.kind);
      if (spec.perShell) {
        while (g.reloadStartAt !== null && now - g.reloadStartAt >= spec.reloadMs) {
          g.ammo = Math.min(spec.magSize, g.ammo + 1);
          g.reloadStartAt = g.ammo >= spec.magSize ? null : g.reloadStartAt + spec.reloadMs;
        }
      } else if (g.reloadStartAt !== null && now - g.reloadStartAt >= spec.reloadMs) {
        g.reloadStartAt = null;
        g.ammo = spec.magSize;
      }
    }
    if (this.holding) {
      if (isGunSlot(this.current)) {
        if (this.specOf(this.current).auto) this.tryFire(now);
      } else if (this.current === WEAPON_MELEE) this.tryLight(now);
      // A held grenade just keeps charging: only release throws.
    }
    if (this.chargeStartAt !== null && now - this.chargeStartAt >= meleeChargeMaxMs(this.melee)) this.release(now);
  }

  /** 0..1 while the held gun is reloading, null otherwise. */
  reloadFraction(now: number): number | null {
    if (!isGunSlot(this.current)) return null;
    const g = this.guns[this.current];
    if (g.reloadStartAt === null) return null;
    return Math.min(1, (now - g.reloadStartAt) / gunSpec(g.kind).reloadMs);
  }

  /** 0..1 while a melee charge is held (1 = charged), null otherwise. */
  chargeFraction(now: number): number | null {
    if (this.chargeStartAt === null) return null;
    return Math.min(1, (now - this.chargeStartAt) / this.stats.chargeMs);
  }

  /** 0..1 while a grenade throw is held (1 = full distance), null otherwise. */
  throwChargeFraction(now: number): number | null {
    if (this.throwStartAt === null) return null;
    return Math.min(1, (now - this.throwStartAt) / GRENADE_THROW_CHARGE_MS);
  }

  cooldownFraction(now: number): number {
    if (isGunSlot(this.current)) {
      const g = this.guns[this.current];
      return Math.min(1, (now - g.lastFireAt) / gunSpec(g.kind).cooldownMs);
    }
    if (this.current === WEAPON_GRENADE) return Math.min(1, (now - this.lastThrowAt) / GRENADE_THROW_COOLDOWN_MS);
    return Math.min(1, (now - this.lastSwingAt) / attackSpec(this.melee, this.lastAttack).cooldownMs);
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
    if (this.lockedToMelee) return;
    const slot = this.current;
    const g = this.guns[slot];
    const spec = gunSpec(g.kind);
    if (g.kind === GUN_NONE) return;
    if (g.reloadStartAt !== null) {
      // A per-shell gun (shotgun) shoots straight out of its reload once a round is in.
      if (!spec.perShell || g.ammo <= 0 || now - g.lastFireAt < spec.cooldownMs) return;
      g.reloadStartAt = null;
    }
    if (g.ammo <= 0) {
      this.reload(now);
      return;
    }
    if (now - g.lastFireAt < spec.cooldownMs) return;
    g.lastFireAt = now;
    g.ammo--;
    this.events.onFire(slot);
    // A consumable gun (taser) leaves with its last round (the server confirms via the state patch).
    if (spec.consumable && g.ammo <= 0 && slot === WEAPON_TASER) this.setTaser(GUN_NONE);
    // The last round starts the reload by itself.
    else if (g.ammo <= 0) this.reload(now);
  }

  /** Start holding a throw (stock permitting); the cooldown is checked at release. */
  private startThrow(now: number): void {
    if (this.lockedToMelee || this.grenades <= 0 || this.throwStartAt !== null) return;
    this.throwStartAt = now;
  }

  /** Let go: throw at the held charge, unless the previous throw's cooldown is still running (then just put it back). */
  private releaseThrow(now: number): void {
    const charge = Math.min(1, Math.max(0, (now - this.throwStartAt!) / GRENADE_THROW_CHARGE_MS));
    this.throwStartAt = null;
    if (this.lockedToMelee || this.grenades <= 0) return;
    if (now - this.lastThrowAt < GRENADE_THROW_COOLDOWN_MS) return;
    this.lastThrowAt = now;
    this.events.onThrow(charge);
    this.setGrenades(this.grenades - 1);
  }
}
