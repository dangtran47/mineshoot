import { DEFAULT_DURATION_MIN, DURATION_OPTIONS_MIN, MAX_BOTS, MAX_NAME_LEN, MAX_PLAYERS, WEAPON_MODES } from '@mineshoot/shared';
import type { WeaponMode } from '@mineshoot/shared';
import { createRoom, joinRoom, listRooms } from '../net';
import type { GameRoom, RoomListEntry } from '../net';
import { formatTime } from '../hud/hud';

const NICK_KEY = 'mineshoot.nick';
const POLL_MS = 2000;

const WEAPON_MODE_LABEL: Record<WeaponMode, string> = { all: 'Gun + Sword', gun: 'Gun only', sword: 'Sword only' };
/** Short badge for the room list ('' for the default rule). */
export function weaponModeBadge(mode: WeaponMode | undefined): string {
  return mode === 'gun' ? '\u{1F52B} only' : mode === 'sword' ? '\u{1F5E1}\uFE0F only' : '';
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
      <h1>MINE<span>SHOOT</span></h1>
      <div class="sub">Blocky arena deathmatch — one hit kills. Gun or sword, your call.</div>
      <div class="row">
        <label>Nickname</label>
        <input class="nick" maxlength="${MAX_NAME_LEN}" placeholder="Your name" />
      </div>
      <div class="row">
        <label>New room</label>
        <input class="roomname" maxlength="24" placeholder="Room name" />
        <select class="duration"></select>
        <select class="bots" title="AI bots"></select>
        <select class="weapons" title="Allowed weapons"></select>
        <button class="primary create">Create room</button>
      </div>
      <table>
        <thead><tr><th>Room</th><th>Players</th><th>Time left</th><th></th></tr></thead>
        <tbody class="rooms"><tr><td colspan="4" class="empty">Loading rooms…</td></tr></tbody>
      </table>
      <div class="error"></div>
      <div class="help">WASD move · Space jump · Mouse aim · LMB attack · RMB charge sword · 1/2 or wheel switch weapon · Tab scoreboard.
        <a href="#" class="offline">Offline sandbox</a></div>
    </div>`;
  opts.container.appendChild(root);

  const nick = root.querySelector<HTMLInputElement>('.nick')!;
  const roomName = root.querySelector<HTMLInputElement>('.roomname')!;
  const duration = root.querySelector<HTMLSelectElement>('.duration')!;
  const bots = root.querySelector<HTMLSelectElement>('.bots')!;
  const weapons = root.querySelector<HTMLSelectElement>('.weapons')!;
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
  for (let n = 0; n <= MAX_BOTS; n++) {
    const o = document.createElement('option');
    o.value = String(n);
    o.textContent = n === 0 ? 'No bots' : `${n} bot${n > 1 ? 's' : ''}`;
    bots.appendChild(o);
  }
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
        weapons: weapons.value as WeaponMode,
      };
      // Dev-only: ?testDurationMs=... shortens the match (server honours it only with MINESHOOT_TEST=1).
      const testMs = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('testDurationMs')) : 0;
      if (testMs > 0) options.testOverrides = { durationMs: testMs, respawnMs: 1000, spawnProtectMs: 500 };
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
      const room = await joinRoom(btn.dataset.id!, n);
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
        const badge = weaponModeBadge(r.metadata.weapons);
        const name = `${escapeHtml(r.metadata.name)}${badge ? ` <span class="badge">${badge}</span>` : ''}`;
        tr.innerHTML = `<td>${name}</td><td>${players}</td><td>${formatTime(left)}</td>
          <td><button class="join" data-id="${r.roomId}" ${full || busy ? 'disabled' : ''}>${full ? 'Full' : 'Join'}</button></td>`;
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
