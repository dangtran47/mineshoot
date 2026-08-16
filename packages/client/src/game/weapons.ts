import { GUN_COOLDOWN_MS, SWORD_COOLDOWN_MS, WEAPON_GUN, WEAPON_SWORD } from '@mineshoot/shared';
import type { Weapon } from '@mineshoot/shared';

export interface WeaponEvents {
  onFire(): void;
  onSwing(): void;
  onSwitch(w: Weapon): void;
}

/** Local weapon state: selection, cooldowns, LMB handling. */
export class Weapons {
  current: Weapon = WEAPON_GUN;
  private lastFireAt = -Infinity;
  private lastSwingAt = -Infinity;
  private holding = false;

  constructor(private readonly events: WeaponEvents) {}

  select(w: Weapon): void {
    if (w === this.current) return;
    this.current = w;
    this.events.onSwitch(w);
  }

  toggle(): void {
    this.select(this.current === WEAPON_GUN ? WEAPON_SWORD : WEAPON_GUN);
  }

  mouseDown(now: number): void {
    this.holding = true;
    this.tryAttack(now);
  }

  mouseUp(): void {
    this.holding = false;
  }

  /** Auto-repeat while the button is held. */
  update(now: number): void {
    if (this.holding) this.tryAttack(now);
  }

  cooldownFraction(now: number): number {
    const cd = this.current === WEAPON_GUN ? GUN_COOLDOWN_MS : SWORD_COOLDOWN_MS;
    const last = this.current === WEAPON_GUN ? this.lastFireAt : this.lastSwingAt;
    return Math.min(1, (now - last) / cd);
  }

  private tryAttack(now: number): void {
    if (this.current === WEAPON_GUN) {
      if (now - this.lastFireAt < GUN_COOLDOWN_MS) return;
      this.lastFireAt = now;
      this.events.onFire();
    } else {
      if (now - this.lastSwingAt < SWORD_COOLDOWN_MS) return;
      this.lastSwingAt = now;
      this.events.onSwing();
    }
  }
}
