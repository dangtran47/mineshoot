import { ATTACK_HEAVY, GRENADE_START, GUN_MAG_SIZE, GUN_NONE, MAX_HP, MELEE_KINDS, MELEE_SWORD, PRIMARY_KINDS, TEAM_BLUE, TEAM_RED, WEAPONS, WEAPON_GRENADE, WEAPON_MELEE, WEAPON_PISTOL, WEAPON_PRIMARY, WEAPON_TASER, gunSpec, isGunSlot, meleeSelectable, meleeStats, splitTeams, teamName, weaponAllowed } from '@mineshoot/shared';
import type { FlagStatus, GunKind, MeleeKind, RankRow, RoomMode, Team, Weapon, WeaponMode } from '@mineshoot/shared';
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

/** Flag status glyph for the CTF score bar. */
const FLAG_GLYPH: Record<FlagStatus, string> = { home: '\u{1F6A9}', carried: '\u{1F3C3}', dropped: '\u26A0\uFE0F' };
export const TEAM_CLASS: Record<Team, string> = { [TEAM_RED]: 't-red', [TEAM_BLUE]: 't-blue' };

export function formatTime(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** DOM overlay for the in-game UI. All state is pushed in by the game screen. */
/** One ranking table; `ctf` adds the captures column (rows are already ranked). */
function scoreTable(rows: RankRow[], meId: string | undefined, ctf: boolean): HTMLTableElement {
  const table = el('table');
  const head = el('tr');
  for (const h of ctf ? ['#', 'Player', 'C', 'K', 'A', 'D', 'K/D'] : ['#', 'Player', 'K', 'A', 'D', 'K/D']) head.append(el('th', undefined, h));
  table.append(head);
  if (!rows.length) {
    const tr = el('tr');
    const td = el('td', 'empty', 'Nobody');
    td.colSpan = ctf ? 7 : 6;
    tr.append(td);
    table.append(tr);
  }
  rows.forEach((r, i) => {
    const cls = [r.id === meId ? 'me' : '', r.alive === false ? 'dead' : ''].filter(Boolean).join(' ');
    const tr = el('tr', cls || undefined);
    tr.append(
      el('td', undefined, String(i + 1)),
      el('td', undefined, r.isBot ? `\u{1F916} ${r.name}` : r.name),
      ...(ctf ? [el('td', undefined, String(r.captures ?? 0))] : []),
      el('td', undefined, String(r.kills)),
      el('td', undefined, String(r.assists ?? 0)),
      el('td', undefined, String(r.deaths)),
      el('td', undefined, kdRatio(r.kills, r.deaths).toFixed(2)),
    );
    table.append(tr);
  });
  return table;
}

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
  private readonly grenadesEl = el('div', 'grenades');
  private readonly slotsEl = el('div', 'slots');
  private readonly slotCells = new Map<Weapon, HTMLSpanElement>();
  private readonly shield = el('div', 'shield hidden', '🛡 Spawn protection');
  private readonly ping = el('div', 'ping');
  private readonly feedEl = el('div', 'feed');
  private readonly announceEl = el('div', 'announce hidden');
  private readonly roundEl = el('div', 'round-banner hidden');
  private roundTimer = 0;
  private readonly centerMsg = el('div', 'center-msg hidden');
  private readonly spectateEl = el('div', 'spectate hidden');
  private readonly overlay = el('div', 'overlay');
  private readonly teamRow = el('div', 'teams hidden');
  private readonly teamButtons = new Map<Team, HTMLButtonElement>();
  private readonly ctfBar = el('div', 'ctfbar hidden');
  private readonly carryEl = el('div', 'carry hidden');
  private readonly scoreboard = el('div', 'scoreboard hidden');
  private readonly hitmarker = el('div', 'hitmarker');
  private readonly crosshair = el('div', 'crosshair');
  /** Sniper scope: circular view with a black surround and its own reticle, shown while zoomed. */
  private readonly scope = el('div', 'scope hidden');
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
  /** CTF: the player picked a team on the overlay. */
  onSelectTeam: ((team: Team) => void) | null = null;

  constructor(parent: HTMLElement) {
    const top = el('div', 'top');
    top.append(this.timer, this.roomName, this.ctfBar);
    const weapon = el('div', 'weapon');
    for (const [i, w] of WEAPONS.entries()) {
      const cell = el('span', 'slot', String(i + 1));
      this.slotCells.set(w, cell);
      this.slotsEl.append(cell);
    }
    weapon.append(this.slotsEl, this.weaponName, this.weaponLabel, this.ammo, this.grenadesEl, this.weaponHint);
    const bar = el('div', 'bar');
    bar.append(this.healthFill);
    this.health.append(bar, this.healthText, this.dmgNumbers);
    this.charge.append(this.chargeFill);

    const title = el('h2', undefined, 'Click to play');
    const help = el('p', undefined, 'WASD move · Space jump · Mouse aim · LMB attack (hold to keep slashing) · hold RMB to charge the heavy melee blow · walk over a glowing weapon drop to take it · dead: LMB/RMB watch another player · Tab scoreboard · Esc unlock');
    const leaveBtn = el('button', undefined, 'Leave match');
    leaveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onLeave?.();
    });
    for (const team of [TEAM_RED, TEAM_BLUE] as const) {
      const b = el('button', `team ${TEAM_CLASS[team]}`, teamName(team));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onSelectTeam?.(team);
      });
      this.teamButtons.set(team, b);
      this.teamRow.append(b);
    }
    this.overlay.append(title, help, this.teamRow, leaveBtn);
    this.overlay.addEventListener('click', () => this.onOverlayClick?.());

    this.root.append(
      this.flash,
      this.crosshair,
      this.scope,
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
      this.roundEl,
      this.toastEl,
      this.carryEl,
      this.spectateEl,
      this.centerMsg,
      this.scoreboard,
      this.overlay,
    );
    parent.appendChild(this.root);
    this.setWeapon(WEAPON_PISTOL);
    this.setWeaponRules('all');
    this.setHealth(MAX_HP);
    this.setAmmo(GUN_MAG_SIZE, GUN_MAG_SIZE, false);
    this.setGrenades(GRENADE_START);
  }

  /** Controls hint under the weapon name, tailored to what the room allows (and to the training range's free weapon choice). */
  setWeaponRules(mode: WeaponMode, roomMode: RoomMode = 'match'): void {
    const picks: string[] = [];
    if (roomMode === 'training' && weaponAllowed(mode, WEAPON_PRIMARY)) picks.push(`Z X C V N pick ${PRIMARY_KINDS.map((k) => gunSpec(k).name).join(' / ')} · B Taser`);
    if (meleeSelectable(roomMode, mode)) picks.push(`6–0 pick melee: ${MELEE_KINDS.map((k) => meleeStats(k).name).join(' / ')}`);
    const pick = picks.length > 0 ? picks.join(' · ') : 'grab weapon drops mid-arena';
    this.weaponHint.textContent =
      mode === 'sword'
        ? `Melee only · LMB slash (hold to repeat) · hold RMB to charge · ${pick}`
        : `1 Primary · 2 Pistol · 3 Melee · 4 Grenade · 5 Taser · wheel · R reload · RMB zoom (sniper) · melee: LMB slash, hold RMB to charge · ${pick}`;
  }

  setRoomName(name: string): void {
    this.roomName.textContent = name;
  }

  /** CTF score bar: `🔴 2 – 1 🔵` with each flag's status glyph (home / carried / dropped). */
  setCtfScore(red: number, blue: number, limit: number, redFlag: FlagStatus, blueFlag: FlagStatus): void {
    this.ctfBar.classList.remove('hidden');
    this.ctfBar.replaceChildren(
      el('span', `side ${TEAM_CLASS[TEAM_RED]}`, `${FLAG_GLYPH[redFlag]} Red ${red}`),
      el('span', 'limit', `/ ${limit}`),
      el('span', `side ${TEAM_CLASS[TEAM_BLUE]}`, `${blue} Blue ${FLAG_GLYPH[blueFlag]}`),
    );
    this.ctfBar.title = `First to ${limit} captures. Flags: red ${redFlag}, blue ${blueFlag}.`;
  }

  /** TD score bar: `Red 2 / 5 1 Blue · Round 4` (round wins so far, wins needed, running round). */
  setTdScore(red: number, blue: number, limit: number, round: number): void {
    this.ctfBar.classList.remove('hidden');
    this.ctfBar.replaceChildren(
      el('span', `side ${TEAM_CLASS[TEAM_RED]}`, `Red ${red}`),
      el('span', 'limit', `/ ${limit}`),
      el('span', `side ${TEAM_CLASS[TEAM_BLUE]}`, `${blue} Blue`),
      el('span', 'limit', `· Round ${round}`),
    );
    this.ctfBar.title = `First to ${limit} round wins takes the match.`;
  }

  /** TD has no clock: hide the timer instead of showing 0:00. */
  setTimerVisible(visible: boolean): void {
    this.timer.classList.toggle('hidden', !visible);
  }

  /** TD: big centre banner for round results and the 3-2-1 spawn countdown. */
  roundBanner(text: string, ms = 2500): void {
    this.roundEl.textContent = text;
    this.roundEl.classList.remove('hidden');
    // Restart the pop animation even if a banner is already showing.
    this.roundEl.classList.remove('pop');
    void this.roundEl.offsetWidth;
    this.roundEl.classList.add('pop');
    this.roundTimer = performance.now() + ms;
  }

  /** Team modes: team buttons on the overlay ("Red (2)" / "Blue (3)"), the own team highlighted. */
  setTeams(mine: Team | 0, counts: Record<Team, number>): void {
    this.teamRow.classList.remove('hidden');
    for (const [team, b] of this.teamButtons) {
      b.textContent = `${teamName(team)} (${counts[team]})`;
      b.classList.toggle('mine', team === mine);
      b.disabled = team === mine;
    }
  }

  /** CTF: banner while carrying the enemy flag (null hides it). */
  setCarrying(flagTeam: Team | null): void {
    this.carryEl.classList.toggle('hidden', flagTeam === null);
    if (flagTeam === null) return;
    this.carryEl.className = `carry ${TEAM_CLASS[flagTeam]}`;
    this.carryEl.textContent = `\u{1F6A9} You have the ${teamName(flagTeam)} flag \u2014 bring it home! (melee only \u00b7 G to drop)`;
  }

  /** Plain-text feed line (flag events). */
  pushFeedText(text: string, kind: FeedKind = 'neutral'): void {
    this.feed.pushText(text, performance.now(), kind);
    this.renderFeed();
  }

  setTimer(ms: number): void {
    this.timer.textContent = formatTime(ms);
    this.timer.classList.toggle('low', ms <= 30_000);
  }

  setStats(kills: number, assists: number, deaths: number): void {
    this.stats.textContent = `K ${kills}  ·  A ${assists}  ·  D ${deaths}`;
  }

  setHealth(hp: number): void {
    const clamped = Math.max(0, Math.min(MAX_HP, hp));
    this.healthFill.style.width = `${(clamped / MAX_HP) * 100}%`;
    this.healthText.textContent = String(clamped);
    this.health.classList.toggle('low', clamped <= 30);
  }

  /**
   * Scope state: while `zooming` the round scope overlay replaces the crosshair;
   * a zoom-capable gun (sniper) hides the crosshair even unzoomed — it only aims
   * through the scope.
   */
  setScope(zooming: boolean, capable: boolean): void {
    this.scope.classList.toggle('hidden', !zooming);
    this.crosshair.classList.toggle('hidden', zooming || capable);
  }

  /** Sword charge meter under the crosshair: 0..1 while holding, null hides it. */
  setCharge(fraction: number | null): void {
    this.charge.classList.toggle('hidden', fraction === null);
    if (fraction === null) return;
    this.chargeFill.style.width = `${Math.round(fraction * 100)}%`;
    this.charge.classList.toggle('ready', fraction >= 1);
  }

  /** Current slot and what sits in it (melee kind / primary gun kind); drop weapons get their name shown. */
  setWeapon(w: Weapon, melee: MeleeKind = MELEE_SWORD, gun: GunKind = GUN_NONE): void {
    this.weaponName.innerHTML = weaponIcon(w, melee, gun);
    const label = w === WEAPON_MELEE ? meleeStats(melee).name : w === WEAPON_GRENADE ? 'Grenade' : w === WEAPON_TASER ? 'Taser' : w === WEAPON_PRIMARY ? gunSpec(gun).name : 'Pistol';
    this.weaponName.title = label;
    // Melee: name the charged (RMB) blow; primaries and grenades show their own name.
    const rmb = w === WEAPON_MELEE ? `RMB ${meleeStats(melee).attacks[ATTACK_HEAVY].name}` : '';
    const special = (w === WEAPON_MELEE && melee !== MELEE_SWORD) || w === WEAPON_PRIMARY || w === WEAPON_TASER;
    this.weaponLabel.textContent = w === WEAPON_MELEE ? (melee !== MELEE_SWORD ? `${label} · ${rmb}` : rmb) : special || w === WEAPON_GRENADE ? label : '';
    this.weaponLabel.classList.toggle('special', special);
    this.ammo.classList.toggle('hidden', !isGunSlot(w));
    for (const [slot, cell] of this.slotCells) cell.classList.toggle('active', slot === w);
  }

  /** Grenade counter next to the ammo box. */
  setGrenades(n: number): void {
    this.grenadesEl.textContent = `💣 ×${n}`;
    this.grenadesEl.classList.toggle('empty', n <= 0);
  }

  /** Which slots are usable right now (greyed otherwise). */
  setSlots(usable: Record<number, boolean>, current: Weapon): void {
    for (const [slot, cell] of this.slotCells) {
      cell.classList.toggle('empty', usable[slot] !== true);
      cell.classList.toggle('active', slot === current);
    }
  }

  /** Short bottom-centre notice ("Picked up Battle Axe"). */
  toast(text: string, ms = 2200): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    this.toastTimer = performance.now() + ms;
  }

  /** Magazine readout under the weapon name ("7 / 10", or "RELOADING…"; per-shell guns keep the climbing count). */
  setAmmo(ammo: number, mag: number, reloading: boolean, showCount = false): void {
    this.ammo.textContent = reloading && !showCount ? 'RELOADING…' : `${ammo} / ${mag}`;
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

  showDeath(killerName: string, weapon: Weapon, headshot = false, badges: AwardBadge[] = [], melee: MeleeKind = MELEE_SWORD, gun: GunKind = GUN_NONE): void {
    const by = el('div', 'by');
    by.append(
      'Killed by ',
      el('b', undefined, killerName),
      svgSpan('icons', weaponIcon(weapon, melee, gun) + (headshot ? iconSvg('headshot', 'red') : '')),
    );
    const tags = el('div', 'tags');
    tags.append(...badges.map((b) => badgeEl(b)));
    this.centerMsg.replaceChildren(el('div', 'big', 'YOU DIED'), by, ...(badges.length ? [tags] : []), el('div', 'countdown', ''));
    this.centerMsg.classList.remove('hidden');
  }

  setRespawnCountdown(ms: number): void {
    this.setDeathNote(`Respawning in ${Math.max(0, Math.ceil(ms / 1000))}…`);
  }

  /** Line under the death banner (TD: "Spectating — back next round" instead of a respawn countdown). */
  setDeathNote(text: string): void {
    const c = this.centerMsg.querySelector('.countdown');
    if (c) c.textContent = text;
  }

  hideDeath(): void {
    this.centerMsg.classList.add('hidden');
  }

  /** Re-show the banner built by showDeath (back from spectating to the own death cam). */
  unhideDeath(): void {
    this.centerMsg.classList.remove('hidden');
  }

  /** Whose eyes we are watching through while dead; null leaves the death cam label off. */
  setSpectating(name: string | null): void {
    this.spectateEl.classList.toggle('hidden', name === null);
    if (name === null) return;
    this.spectateEl.replaceChildren('Spectating ', el('b', undefined, name), el('span', 'hint', 'LMB next · RMB previous'));
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

  /**
   * Tab scoreboard. Rows come pre-ranked; dead / unspawned rows are dimmed.
   * With `ctf` (the live scores) the board splits into a Red and a Blue panel.
   */
  setScoreboard(visible: boolean, rows?: RankRow[], meId?: string, ctf?: { redScore: number; blueScore: number }): void {
    this.scoreboard.classList.toggle('hidden', !visible);
    this.scoreboard.classList.toggle('ctf', !!ctf);
    if (!visible || !rows) return;
    if (!ctf) {
      this.scoreboard.replaceChildren(scoreTable(rows, meId, false));
      return;
    }
    const { red, blue } = splitTeams(rows);
    const side = (team: Team, teamRows: RankRow[], score: number): HTMLElement => {
      const box = el('div', `side ${TEAM_CLASS[team]}`);
      const head = el('div', 'teamhead');
      head.append(el('span', 'name', teamName(team)), el('span', 'score', String(score)));
      box.append(head, scoreTable(teamRows, meId, true));
      return box;
    };
    const sides = el('div', 'sides');
    sides.append(side(TEAM_RED, red, ctf.redScore), side(TEAM_BLUE, blue, ctf.blueScore));
    this.scoreboard.replaceChildren(sides);
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
    if (this.roundTimer && now > this.roundTimer) {
      this.roundEl.classList.add('hidden');
      this.roundTimer = 0;
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
        if (!e.line) {
          row.append(el('span', 'text', e.text));
          row.title = e.text;
          return row;
        }
        row.title = killFeedLine(e.line);
        row.append(
          el('span', 'name', e.line.killer),
          ...(e.line.assists?.length ? [el('span', 'assist', `+ ${e.line.assists.join(' + ')}`)] : []),
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
