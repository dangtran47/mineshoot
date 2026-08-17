import { ATTACK_HEAVY, GUN_MAG_SIZE, MAX_HP, MELEE_KINDS, MELEE_SWORD, WEAPON_GUN, meleeSelectable, meleeStats } from '@mineshoot/shared';
import type { MeleeKind, RankRow, RoomMode, Weapon, WeaponMode } from '@mineshoot/shared';
import { KillFeedModel, killFeedLine } from './killFeed';
import type { FeedKind, KillLineInput } from './killFeed';
import { awardBadges, iconSvg, weaponIcon } from './icons';
import type { AwardBadge } from './icons';
import { kdRatio } from '@mineshoot/shared';
import { damageFlashParams } from './damageFx';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A span whose content is trusted SVG markup from icons.ts (never user text). */
function svgSpan(className: string, html: string): HTMLSpanElement {
  const e = el('span', className);
  e.innerHTML = html;
  return e;
}

/** Icon + caption badge, e.g. [💀💀 ×2] or [🔥 5]. */
function badgeEl(b: AwardBadge, className = 'badge'): HTMLSpanElement {
  const e = svgSpan(className, b.html);
  e.title = b.label;
  if (b.caption) e.append(el('span', 'cap', b.caption));
  return e;
}

/** How long an award banner stays on screen. */
export const ANNOUNCE_MS = 2200;

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
  private readonly weaponLabel = el('div', 'label');
  private readonly weaponHint = el('div', 'hint');
  private readonly toastEl = el('div', 'toast hidden');
  private toastTimer = 0;
  private readonly ammo = el('div', 'ammo');
  private readonly shield = el('div', 'shield hidden', '🛡 Spawn protection');
  private readonly ping = el('div', 'ping');
  private readonly feedEl = el('div', 'feed');
  private readonly announceEl = el('div', 'announce hidden');
  private readonly centerMsg = el('div', 'center-msg hidden');
  private readonly overlay = el('div', 'overlay');
  private readonly scoreboard = el('div', 'scoreboard hidden');
  private readonly hitmarker = el('div', 'hitmarker');
  private readonly charge = el('div', 'charge hidden');
  private readonly chargeFill = el('div', 'fill');
  private readonly flash = el('div', 'dmg-flash');
  private readonly dmgNumbers = el('div', 'dmg-numbers');
  private readonly feed = new KillFeedModel();
  private hitTimer = 0;
  private flashTimer = 0;
  private announceTimer = 0;
  onOverlayClick: (() => void) | null = null;
  onLeave: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    const top = el('div', 'top');
    top.append(this.timer, this.roomName);
    const weapon = el('div', 'weapon');
    weapon.append(this.weaponName, this.weaponLabel, this.ammo, this.weaponHint);
    const bar = el('div', 'bar');
    bar.append(this.healthFill);
    this.health.append(bar, this.healthText, this.dmgNumbers);
    this.charge.append(this.chargeFill);

    const title = el('h2', undefined, 'Click to play');
    const help = el('p', undefined, 'WASD move · Space jump · Mouse aim · LMB attack (hold to keep slashing) · hold RMB to charge the heavy melee blow · walk over a glowing weapon drop to take it · Tab scoreboard · Esc unlock');
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
      this.announceEl,
      this.toastEl,
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

  /** Controls hint under the weapon name, tailored to what the room allows (and to the training range's free melee choice). */
  setWeaponRules(mode: WeaponMode, roomMode: RoomMode = 'match'): void {
    const pick = meleeSelectable(roomMode, mode)
      ? `3–7 pick melee: ${MELEE_KINDS.map((k) => meleeStats(k).name).join(' / ')}`
      : 'grab weapon drops mid-arena';
    this.weaponHint.textContent =
      mode === 'gun'
        ? 'Gun only · R reload'
        : mode === 'sword'
          ? `Melee only · LMB slash (hold to repeat) · hold RMB to charge · ${pick}`
          : `1 Gun · 2 Melee · wheel to switch · R reload · melee: LMB slash (hold to repeat), hold RMB to charge · ${pick}`;
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

  /** Current slot (gun / melee) and the melee weapon in the melee slot; drop weapons get their name shown. */
  setWeapon(w: Weapon, melee: MeleeKind = MELEE_SWORD): void {
    this.weaponName.innerHTML = weaponIcon(w, melee);
    const label = w === WEAPON_GUN ? 'Gun' : meleeStats(melee).name;
    this.weaponName.title = label;
    // Melee: name the charged (RMB) blow (drop weapons also show their own name).
    const rmb = w === WEAPON_GUN ? '' : `RMB ${meleeStats(melee).attacks[ATTACK_HEAVY].name}`;
    this.weaponLabel.textContent = w !== WEAPON_GUN && melee !== MELEE_SWORD ? `${label} · ${rmb}` : rmb;
    this.weaponLabel.classList.toggle('special', w !== WEAPON_GUN && melee !== MELEE_SWORD);
    this.ammo.classList.toggle('hidden', w !== WEAPON_GUN);
  }

  /** Short bottom-centre notice ("Picked up Battle Axe"). */
  toast(text: string, ms = 2200): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    this.toastTimer = performance.now() + ms;
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

  pushFeed(line: KillLineInput, kind: FeedKind = 'neutral'): void {
    this.feed.push(line, performance.now(), kind);
    this.renderFeed();
  }

  /** Big centre banner for the local player's own awards (skulls for a multi kill, crossed swords for revenge...); first badge is the headline. */
  announce(badges: AwardBadge[]): void {
    if (badges.length === 0) return;
    const [head, ...rest] = badges;
    const big = badgeEl(head, 'big');
    big.append(el('div', 'label', head.label));
    this.announceEl.replaceChildren(big, ...rest.map((b) => badgeEl(b, 'sub')));
    this.announceEl.classList.remove('hidden');
    // Restart the pop animation even if a banner is already showing.
    this.announceEl.classList.remove('pop');
    void this.announceEl.offsetWidth;
    this.announceEl.classList.add('pop');
    this.announceTimer = performance.now() + ANNOUNCE_MS;
  }

  showDeath(killerName: string, weapon: Weapon, headshot = false, badges: AwardBadge[] = [], melee: MeleeKind = MELEE_SWORD): void {
    const by = el('div', 'by');
    by.append(
      'Killed by ',
      el('b', undefined, killerName),
      svgSpan('icons', weaponIcon(weapon, melee) + (headshot ? iconSvg('headshot', 'red') : '')),
    );
    const tags = el('div', 'tags');
    tags.append(...badges.map((b) => badgeEl(b)));
    this.centerMsg.replaceChildren(el('div', 'big', 'YOU DIED'), by, ...(badges.length ? [tags] : []), el('div', 'countdown', ''));
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

  /**
   * Screen-edge blood vignette plus a floating "-N" by the health bar. Both scale with the
   * HP lost so a graze and a near-death hit read differently at a glance.
   */
  damageFlash(damage: number): void {
    const { opacity, durationMs } = damageFlashParams(damage);
    this.showFlash(opacity, durationMs);
    if (damage > 0) {
      const n = el('div', 'dmg-number', `-${Math.round(damage)}`);
      if (damage >= 50) n.classList.add('big');
      this.dmgNumbers.append(n);
      n.addEventListener('animationend', () => n.remove());
    }
  }

  /** Full-strength vignette on death; the lethal shot/hit already posted its "-N". */
  deathFlash(): void {
    const { opacity, durationMs } = damageFlashParams(MAX_HP);
    this.showFlash(opacity, durationMs);
  }

  private showFlash(opacity: number, durationMs: number): void {
    // Don't let a small hit dim a bigger flash that is still on screen.
    const current = this.flashTimer ? Number(this.flash.style.opacity) || 0 : 0;
    this.flash.style.opacity = String(Math.max(current, opacity));
    this.flash.classList.add('show');
    this.flashTimer = Math.max(this.flashTimer, performance.now() + durationMs);
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
      // Fade out through the CSS transition rather than snapping off.
      this.flash.classList.remove('show');
      this.flash.style.opacity = '0';
      this.flashTimer = 0;
    }
    if (this.announceTimer && now > this.announceTimer) {
      this.announceEl.classList.add('hidden');
      this.announceTimer = 0;
    }
    if (this.toastTimer && now > this.toastTimer) {
      this.toastEl.classList.add('hidden');
      this.toastTimer = 0;
    }
    if (this.feed.prune(now)) this.renderFeed();
  }

  private renderFeed(): void {
    this.feedEl.replaceChildren(
      ...this.feed.entries.map((e) => {
        const row = el('div', e.kind === 'neutral' ? undefined : e.kind);
        row.title = killFeedLine(e.line);
        row.append(
          el('span', 'name', e.line.killer),
          svgSpan('icons', weaponIcon(e.line.weapon, e.line.melee ?? MELEE_SWORD) + (e.line.headshot ? iconSvg('headshot', 'red') : '')),
          el('span', 'name', e.line.victim),
          ...awardBadges(e.line).map((b) => badgeEl(b)),
        );
        return row;
      }),
    );
  }

  dispose(): void {
    this.root.remove();
  }
}
