import { BOT_SKILLS, CTF_CAPTURE_LIMIT_OPTIONS, CTF_DEFAULT_CAPTURE_LIMIT, DEFAULT_BOT_SKILL, DEFAULT_DURATION_MIN, DURATION_OPTIONS_MIN, MAX_BOTS, MAX_NAME_LEN, MAX_PLAYERS, ROOM_MODES, TEAM_BLUE, TEAM_NONE, TEAM_RED, WEAPON_MODES } from '@mineshoot/shared';
import type { BotSkill, RoomMode, WeaponMode } from '@mineshoot/shared';
import { createRoom, joinRoom, listRooms } from '../net';
import type { GameRoom, RoomListEntry } from '../net';
import { formatTime } from '../hud/hud';

const NICK_KEY = 'mineshoot.nick';
const POLL_MS = 2000;

const WEAPON_MODE_LABEL: Record<WeaponMode, string> = { all: 'Guns + Sword', sword: 'Sword only' };
const ROOM_MODE_LABEL: Record<RoomMode, string> = { match: 'Deathmatch', training: 'Training range', ctf: 'Capture the Flag' };
const BOT_SKILL_LABEL: Record<BotSkill, string> = { easy: 'Easy bots', normal: 'Normal bots', hard: 'Hard bots' };
/** Bots a training range gets when the creator left the bot count at zero (a range needs dummies). */
const TRAINING_DEFAULT_BOTS = 3;
/** Short badge for the room list ('' for the default rule). */
export function weaponModeBadge(mode: WeaponMode | undefined): string {
  return mode === 'sword' ? '\u{1F5E1}\uFE0F only' : '';
}
/** Short badge for the room list ('' when there are no bots or they are the default level). */
export function botSkillBadge(bots: number | undefined, skill: BotSkill | undefined): string {
  if (!bots || !skill || skill === DEFAULT_BOT_SKILL) return '';
  return skill === 'easy' ? '\u{1F916} easy' : '\u{1F916} hard';
}
/** Short badge for the room list ('' for a normal match). */
export function roomModeBadge(mode: RoomMode | undefined): string {
  return mode === 'training' ? '\u{1F3AF} training' : mode === 'ctf' ? '\u{1F6A9} CTF' : '';
}
/** CTF room row: `🔴 2 · 🔵 3` from the metadata head counts. */
export function teamCountsLabel(teams: [number, number] | undefined): string {
  return teams ? `\u{1F534} ${teams[0]} \u00b7 \u{1F535} ${teams[1]}` : '';
}

export interface LobbyOptions {
  container: HTMLElement;
  message?: string;
  onJoined(room: GameRoom): void;
  onOffline(): void;
}

export function showLobby(opts: LobbyOptions): { dispose(): void } {
  const root = document.createElement('div');
  root.className = 'lobby';
  root.innerHTML = `
    <div class="card">
      <header class="head">
        <h1>MINE<span>SHOOT</span></h1>
        <p class="sub">Blocky arena deathmatch — one hit kills. Gun or sword, your call.</p>
      </header>
      <section class="panel">
        <label class="field grow">
          <span>Nickname</span>
          <input class="nick" maxlength="${MAX_NAME_LEN}" placeholder="Your name" autocomplete="off" />
        </label>
      </section>
      <section class="panel">
        <h2>Create a room</h2>
        <div class="fields">
          <label class="field name"><span>Room name</span><input class="roomname" maxlength="24" placeholder="Room name" autocomplete="off" /></label>
          <label class="field"><span>Duration</span><select class="duration"></select></label>
          <label class="field"><span>Mode</span><select class="mode" title="Room type"></select></label>
          <label class="field"><span>Bots</span><select class="bots" title="AI bots"></select></label>
          <label class="field botskill hidden"><span>Bot skill</span><select class="skill" title="How sharp the bots are"></select></label>
          <label class="field"><span>Weapons</span><select class="weapons" title="Allowed weapons"></select></label>
          <label class="field captures hidden"><span>Captures</span><select class="capturelimit" title="Captures to win"></select></label>
          <button class="primary create">Create room</button>
        </div>
      </section>
      <section class="panel">
        <h2>Open rooms <span class="live" title="Refreshes every ${POLL_MS / 1000}s"><i></i>live</span></h2>
        <table>
          <thead><tr><th>Room</th><th>Players</th><th>Time left</th><th></th></tr></thead>
          <tbody class="rooms"><tr><td colspan="4" class="empty">Loading rooms…</td></tr></tbody>
        </table>
      </section>
      <div class="error"></div>
      <footer class="help">
        <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move</span>
        <span><kbd>Space</kbd> jump</span>
        <span><kbd>LMB</kbd> attack</span>
        <span><kbd>RMB</kbd> charge sword</span>
        <span><kbd>1</kbd><kbd>2</kbd> / wheel switch weapon</span>
        <span><kbd>Tab</kbd> scoreboard</span>
        <span class="note">Training range: bots are passive dummies and <kbd>3</kbd>–<kbd>7</kbd> pick any melee weapon.</span>
        <a href="#" class="offline">Offline sandbox →</a>
      </footer>
    </div>`;
  opts.container.appendChild(root);

  const nick = root.querySelector<HTMLInputElement>('.nick')!;
  const roomName = root.querySelector<HTMLInputElement>('.roomname')!;
  const duration = root.querySelector<HTMLSelectElement>('.duration')!;
  const mode = root.querySelector<HTMLSelectElement>('.mode')!;
  const bots = root.querySelector<HTMLSelectElement>('.bots')!;
  const skillField = root.querySelector<HTMLElement>('.botskill')!;
  const skill = root.querySelector<HTMLSelectElement>('.skill')!;
  const weapons = root.querySelector<HTMLSelectElement>('.weapons')!;
  const captureField = root.querySelector<HTMLElement>('.captures')!;
  const captureLimit = root.querySelector<HTMLSelectElement>('.capturelimit')!;
  const createBtn = root.querySelector<HTMLButtonElement>('.create')!;
  const rooms = root.querySelector<HTMLElement>('.rooms')!;
  const error = root.querySelector<HTMLElement>('.error')!;

  nick.value = localStorage.getItem(NICK_KEY) ?? '';
  nick.addEventListener('input', () => localStorage.setItem(NICK_KEY, nick.value));
  for (const d of DURATION_OPTIONS_MIN) {
    const o = document.createElement('option');
    o.value = String(d);
    o.textContent = `${d} min`;
    if (d === DEFAULT_DURATION_MIN) o.selected = true;
    duration.appendChild(o);
  }
  for (const m of ROOM_MODES) {
    const o = document.createElement('option');
    o.value = m;
    o.textContent = ROOM_MODE_LABEL[m];
    mode.appendChild(o);
  }
  // A training range without dummies is an empty field: give it a few unless the creator chose some.
  mode.addEventListener('change', () => {
    if (mode.value === 'training' && Number(bots.value) === 0) bots.value = String(TRAINING_DEFAULT_BOTS);
    captureField.classList.toggle('hidden', mode.value !== 'ctf');
    syncSkillField();
  });
  for (const n of CTF_CAPTURE_LIMIT_OPTIONS) {
    const o = document.createElement('option');
    o.value = String(n);
    o.textContent = `First to ${n}`;
    if (n === CTF_DEFAULT_CAPTURE_LIMIT) o.selected = true;
    captureLimit.appendChild(o);
  }
  for (let n = 0; n <= MAX_BOTS; n++) {
    const o = document.createElement('option');
    o.value = String(n);
    o.textContent = n === 0 ? 'No bots' : `${n} bot${n > 1 ? 's' : ''}`;
    bots.appendChild(o);
  }
  for (const s of BOT_SKILLS) {
    const o = document.createElement('option');
    o.value = s;
    o.textContent = BOT_SKILL_LABEL[s];
    if (s === DEFAULT_BOT_SKILL) o.selected = true;
    skill.appendChild(o);
  }
  // The skill picker only matters when there are bots (training dummies ignore it).
  const syncSkillField = (): void => {
    skillField.classList.toggle('hidden', Number(bots.value) === 0 || mode.value === 'training');
  };
  bots.addEventListener('change', syncSkillField);
  for (const m of WEAPON_MODES) {
    const o = document.createElement('option');
    o.value = m;
    o.textContent = WEAPON_MODE_LABEL[m];
    weapons.appendChild(o);
  }
  if (opts.message) error.textContent = opts.message;

  let busy = false;
  const nickname = (): string | null => {
    const n = nick.value.trim();
    if (!n) {
      error.textContent = 'Enter a nickname first';
      nick.focus();
      return null;
    }
    return n;
  };
  const setBusy = (b: boolean): void => {
    busy = b;
    createBtn.disabled = b;
    root.querySelectorAll<HTMLButtonElement>('.join').forEach((btn) => (btn.disabled = b));
  };

  createBtn.addEventListener('click', async () => {
    const n = nickname();
    if (!n || busy) return;
    setBusy(true);
    error.textContent = '';
    try {
      const options: Parameters<typeof createRoom>[0] & { testOverrides?: unknown } = {
        name: roomName.value.trim() || `${n}'s room`,
        durationMin: Number(duration.value),
        nickname: n,
        bots: Number(bots.value),
        botSkill: skill.value as BotSkill,
        weapons: weapons.value as WeaponMode,
        mode: mode.value as RoomMode,
        ...(mode.value === 'ctf' ? { captureLimit: Number(captureLimit.value) } : {}),
      };
      // Dev-only: ?testDurationMs=... shortens the match, ?testDropMs=... speeds up weapon drops
      // (the server honours them only with MINESHOOT_TEST=1).
      const params = import.meta.env.DEV ? new URLSearchParams(location.search) : null;
      const testMs = Number(params?.get('testDurationMs'));
      const testDropMs = Number(params?.get('testDropMs'));
      if (testMs > 0 || testDropMs > 0) {
        options.testOverrides = {
          ...(testMs > 0 ? { durationMs: testMs, respawnMs: 1000, spawnProtectMs: 500 } : {}),
          ...(testDropMs > 0 ? { dropIntervalMs: testDropMs } : {}),
        };
      }
      const room = await createRoom(options);
      dispose();
      opts.onJoined(room);
    } catch (e) {
      error.textContent = (e as Error).message;
      setBusy(false);
    }
  });

  rooms.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button.join');
    if (!btn || busy) return;
    const n = nickname();
    if (!n) return;
    setBusy(true);
    error.textContent = '';
    try {
      const room = await joinRoom(btn.dataset.id!, n, Number(btn.dataset.team ?? TEAM_NONE));
      dispose();
      opts.onJoined(room);
    } catch (err) {
      error.textContent = (err as Error).message;
      setBusy(false);
      void refresh();
    }
  });

  root.querySelector('.offline')!.addEventListener('click', (e) => {
    e.preventDefault();
    dispose();
    opts.onOffline();
  });

  const render = (list: RoomListEntry[]): void => {
    if (list.length === 0) {
      rooms.innerHTML = '<tr><td colspan="4" class="empty">No open rooms — create one!</td></tr>';
      return;
    }
    rooms.replaceChildren(
      ...list.map((r) => {
        const tr = document.createElement('tr');
        const left = Math.max(0, r.metadata.endsAt - Date.now());
        const full = r.clients >= r.maxClients;
        const botCount = r.metadata.bots ?? 0;
        const players = `${r.clients + botCount}/${MAX_PLAYERS}${botCount ? ` (\u{1F916} ${botCount})` : ''}`;
        const ctf = r.metadata.mode === 'ctf';
        const badges = [roomModeBadge(r.metadata.mode), weaponModeBadge(r.metadata.weapons), botSkillBadge(botCount, r.metadata.botSkill)].filter(Boolean);
        const name = `${escapeHtml(r.metadata.name)}${badges.map((b) => ` <span class="badge">${b}</span>`).join('')}`;
        const teams = ctf ? ` <span class="teams">${teamCountsLabel(r.metadata.teams)}</span>` : '';
        const dis = full || busy ? 'disabled' : '';
        // CTF: pick a side (or let the server balance); other rooms: one Join button.
        const joinBtns = full
          ? '<button class="join" disabled>Full</button>'
          : ctf
            ? `<button class="join team t-red" data-id="${r.roomId}" data-team="${TEAM_RED}" ${dis} title="Join the red team">Red</button>` +
              `<button class="join team t-blue" data-id="${r.roomId}" data-team="${TEAM_BLUE}" ${dis} title="Join the blue team">Blue</button>` +
              `<button class="join" data-id="${r.roomId}" data-team="${TEAM_NONE}" ${dis} title="Join the smaller team">Auto</button>`
            : `<button class="join" data-id="${r.roomId}" ${dis}>Join</button>`;
        tr.innerHTML = `<td>${name}</td><td>${players}${teams}</td><td>${formatTime(left)}</td><td class="actions">${joinBtns}</td>`;
        return tr;
      }),
    );
  };

  let disposed = false;
  const refresh = async (): Promise<void> => {
    try {
      const list = await listRooms();
      if (!disposed) render(list);
    } catch {
      if (!disposed) rooms.innerHTML = '<tr><td colspan="4" class="empty">Cannot reach server</td></tr>';
    }
  };
  void refresh();
  const poll = window.setInterval(() => void refresh(), POLL_MS);

  const dispose = (): void => {
    disposed = true;
    clearInterval(poll);
    root.remove();
  };
  return { dispose };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
