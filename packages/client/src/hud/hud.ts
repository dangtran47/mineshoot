import { GUN_MAG_SIZE, MAX_HP, WEAPON_GUN } from '@mineshoot/shared';
import type { RankRow, Weapon, WeaponMode } from '@mineshoot/shared';
import { KillFeedModel } from './killFeed';
import { kdRatio } from '@mineshoot/shared';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function formatTime(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** DOM overlay for the in-game UI. All state is pushed in by the game screen. */
export class Hud {
  readonly root = el('div', 'hud');
  private readonly timer = el('div', 'timer', '0:00');
  private readonly roomName = el('div', 'roomname');
  private readonly stats = el('div', 'stats');
  private readonly health = el('div', 'health');
  private readonly healthFill = el('div', 'fill');
  private readonly healthText = el('div', 'hp', String(MAX_HP));
  private readonly weaponName = el('div', 'name');
  private readonly weaponHint = el('div', 'hint');
  private readonly ammo = el('div', 'ammo');
  private readonly shield = el('div', 'shield hidden', '🛡 Spawn protection');
  private readonly ping = el('div', 'ping');
  private readonly feedEl = el('div', 'feed');
  private readonly centerMsg = el('div', 'center-msg hidden');
  private readonly overlay = el('div', 'overlay');
  private readonly scoreboard = el('div', 'scoreboard hidden');
  private readonly hitmarker = el('div', 'hitmarker');
  private readonly charge = el('div', 'charge hidden');
  private readonly chargeFill = el('div', 'fill');
  private readonly flash = el('div', 'dmg-flash');
  private readonly feed = new KillFeedModel();
  private hitTimer = 0;
  private flashTimer = 0;
  onOverlayClick: (() => void) | null = null;
  onLeave: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    const top = el('div', 'top');
    top.append(this.timer, this.roomName);
    const weapon = el('div', 'weapon');
    weapon.append(this.weaponName, this.ammo, this.weaponHint);
    const bar = el('div', 'bar');
    bar.append(this.healthFill);
    this.health.append(bar, this.healthText);
    this.charge.append(this.chargeFill);

    const title = el('h2', undefined, 'Click to play');
    const help = el('p', undefined, 'WASD move · Space jump · Mouse aim · LMB attack · RMB charge sword · Tab scoreboard · Esc unlock');
    const leaveBtn = el('button', undefined, 'Leave match');
    leaveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onLeave?.();
    });
    this.overlay.append(title, help, leaveBtn);
    this.overlay.addEventListener('click', () => this.onOverlayClick?.());

    this.root.append(
      this.flash,
      el('div', 'crosshair'),
      this.hitmarker,
      this.charge,
      top,
      this.health,
      this.shield,
      this.stats,
      weapon,
      this.ping,
      this.feedEl,
      this.centerMsg,
      this.scoreboard,
      this.overlay,
    );
    parent.appendChild(this.root);
    this.setWeapon(WEAPON_GUN);
    this.setWeaponRules('all');
    this.setHealth(MAX_HP);
    this.setAmmo(GUN_MAG_SIZE, GUN_MAG_SIZE, false);
  }

  /** Controls hint under the weapon name, tailored to what the room allows. */
  setWeaponRules(mode: WeaponMode): void {
    this.weaponHint.textContent =
      mode === 'gun'
        ? 'Gun only · R reload'
        : mode === 'sword'
          ? 'Sword only · LMB slash · hold RMB to charge'
          : '1 Gun · 2 Sword · wheel to switch · R reload · sword: LMB slash, hold RMB to charge';
  }

  setRoomName(name: string): void {
    this.roomName.textContent = name;
  }

  setTimer(ms: number): void {
    this.timer.textContent = formatTime(ms);
    this.timer.classList.toggle('low', ms <= 30_000);
  }

  setStats(kills: number, deaths: number): void {
    this.stats.textContent = `K ${kills}  ·  D ${deaths}`;
  }

  setHealth(hp: number): void {
    const clamped = Math.max(0, Math.min(MAX_HP, hp));
    this.healthFill.style.width = `${(clamped / MAX_HP) * 100}%`;
    this.healthText.textContent = String(clamped);
    this.health.classList.toggle('low', clamped <= 30);
  }

  /** Sword charge meter under the crosshair: 0..1 while holding, null hides it. */
  setCharge(fraction: number | null): void {
    this.charge.classList.toggle('hidden', fraction === null);
    if (fraction === null) return;
    this.chargeFill.style.width = `${Math.round(fraction * 100)}%`;
    this.charge.classList.toggle('ready', fraction >= 1);
  }

  setWeapon(w: Weapon): void {
    this.weaponName.textContent = w === WEAPON_GUN ? 'GUN' : 'SWORD';
    this.ammo.classList.toggle('hidden', w !== WEAPON_GUN);
  }

  /** Magazine readout under the weapon name ("7 / 10", or "RELOADING…"). */
  setAmmo(ammo: number, mag: number, reloading: boolean): void {
    this.ammo.textContent = reloading ? 'RELOADING…' : `${ammo} / ${mag}`;
    this.ammo.classList.toggle('reloading', reloading);
    this.ammo.classList.toggle('low', !reloading && ammo <= Math.ceil(mag / 4));
  }

  /** Spawn-protection badge next to the health bar. */
  setShield(on: boolean): void {
    this.shield.classList.toggle('hidden', !on);
  }

  setPing(ms: number | null): void {
    this.ping.textContent = ms === null ? '' : `${Math.round(ms)} ms`;
  }

  setOverlay(visible: boolean): void {
    this.overlay.classList.toggle('hidden', !visible);
  }

  pushFeed(text: string, highlight = false): void {
    this.feed.push(text, performance.now(), highlight);
    this.renderFeed();
  }

  showDeath(killerName: string, weapon: Weapon): void {
    this.centerMsg.replaceChildren(
      el('div', 'big', 'YOU DIED'),
      el('div', undefined, `Killed by ${killerName} (${weapon === WEAPON_GUN ? 'gun' : 'sword'})`),
      el('div', 'countdown', ''),
    );
    this.centerMsg.classList.remove('hidden');
  }

  setRespawnCountdown(ms: number): void {
    const c = this.centerMsg.querySelector('.countdown');
    if (c) c.textContent = `Respawning in ${Math.max(0, Math.ceil(ms / 1000))}…`;
  }

  hideDeath(): void {
    this.centerMsg.classList.add('hidden');
  }

  /** Crosshair hit marker; headshots get the accented variant. */
  hitmark(headshot = false): void {
    this.hitmarker.classList.toggle('head', headshot);
    this.hitmarker.classList.add('show');
    this.hitTimer = performance.now() + 120;
  }

  damageFlash(): void {
    this.flash.classList.add('show');
    this.flashTimer = performance.now() + 150;
  }

  setScoreboard(visible: boolean, rows?: RankRow[], meId?: string): void {
    this.scoreboard.classList.toggle('hidden', !visible);
    if (!visible || !rows) return;
    const table = el('table');
    const head = el('tr');
    for (const h of ['#', 'Player', 'K', 'D', 'K/D']) head.append(el('th', undefined, h));
    table.append(head);
    rows.forEach((r, i) => {
      const tr = el('tr', r.id === meId ? 'me' : undefined);
      tr.append(
        el('td', undefined, String(i + 1)),
        el('td', undefined, r.isBot ? `\u{1F916} ${r.name}` : r.name),
        el('td', undefined, String(r.kills)),
        el('td', undefined, String(r.deaths)),
        el('td', undefined, kdRatio(r.kills, r.deaths).toFixed(2)),
      );
      table.append(tr);
    });
    this.scoreboard.replaceChildren(table);
  }

  update(now: number): void {
    if (this.hitTimer && now > this.hitTimer) {
      this.hitmarker.classList.remove('show');
      this.hitTimer = 0;
    }
    if (this.flashTimer && now > this.flashTimer) {
      this.flash.classList.remove('show');
      this.flashTimer = 0;
    }
    if (this.feed.prune(now)) this.renderFeed();
  }

  private renderFeed(): void {
    this.feedEl.replaceChildren(...this.feed.entries.map((e) => el('div', e.highlight ? 'hl' : undefined, e.text)));
  }

  dispose(): void {
    this.root.remove();
  }
}
