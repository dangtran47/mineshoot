import { TEAM_BLUE, TEAM_NONE, TEAM_RED, kdRatio, matchWinner, rankCtf, teamName } from '@mineshoot/shared';
import type { RankRow, Team } from '@mineshoot/shared';
import type { CtfSummary } from './game';

const AUTO_RETURN_MS = 15_000;

const TEAM_CLASS: Record<Team, string> = { [TEAM_RED]: 't-red', [TEAM_BLUE]: 't-blue' };

/** CTF headline: "Red wins 3 – 1" / "Draw 2 – 2". */
export function ctfHeadline(ctf: CtfSummary): string {
  const w = matchWinner(ctf.redScore, ctf.blueScore);
  const score = `${ctf.redScore} \u2013 ${ctf.blueScore}`;
  return w === TEAM_NONE ? `Draw ${score}` : `${teamName(w)} wins ${score}`;
}

export type CtfOutcome = 'victory' | 'defeat' | 'draw';

/** How the match ended for a player on `myTeam`; undefined for someone on no team. */
export function ctfOutcome(ctf: CtfSummary, myTeam: number | undefined): CtfOutcome | undefined {
  if (myTeam !== TEAM_RED && myTeam !== TEAM_BLUE) return undefined;
  const w = matchWinner(ctf.redScore, ctf.blueScore);
  if (w === TEAM_NONE) return 'draw';
  return w === myTeam ? 'victory' : 'defeat';
}

/** Rows per team, each side ranked by the CTF order; teamless rows are dropped. */
export function splitTeams(rows: RankRow[]): { red: RankRow[]; blue: RankRow[] } {
  return {
    red: rankCtf(rows.filter((r) => r.team === TEAM_RED)),
    blue: rankCtf(rows.filter((r) => r.team === TEAM_BLUE)),
  };
}

const OUTCOME_LABEL: Record<CtfOutcome, string> = { victory: 'Victory', defeat: 'Defeat', draw: 'Draw' };

function ctfBody(ranking: RankRow[], meId: string, ctf: CtfSummary): { title: string; titleClass: string; sub: string; body: string } {
  const me = ranking.find((r) => r.id === meId);
  const outcome = ctfOutcome(ctf, me?.team);
  const winner = matchWinner(ctf.redScore, ctf.blueScore);
  const { red, blue } = splitTeams(ranking);
  const side = (team: Team, rows: RankRow[], score: number): string => {
    const cls = [TEAM_CLASS[team], winner === team ? 'won' : ''].filter(Boolean).join(' ');
    const trs = rows
      .map((r) => `<tr class="${r.id === meId ? 'me' : ''}"><td>${r.isBot ? '\u{1F916} ' : ''}${escapeHtml(r.name)}</td><td>${r.captures ?? 0}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${kdRatio(r.kills, r.deaths).toFixed(2)}</td></tr>`)
      .join('');
    return `<div class="side ${cls}">
      <div class="teamhead"><span class="name">${teamName(team)}</span><span class="score">${score}</span></div>
      <table>
        <tr><th>Player</th><th>Caps</th><th>Kills</th><th>Deaths</th><th>K/D</th></tr>
        ${trs || '<tr><td colspan="5" class="empty">Nobody</td></tr>'}
      </table>
    </div>`;
  };
  return {
    title: outcome ? OUTCOME_LABEL[outcome] : 'Match over',
    titleClass: outcome ?? '',
    sub: outcome
      ? `<span class="t-red side-score">Red ${ctf.redScore}</span> \u2013 <span class="t-blue side-score">${ctf.blueScore} Blue</span>`
      : escapeHtml(ctfHeadline(ctf)),
    body: `<div class="teams">${side(TEAM_RED, red, ctf.redScore)}${side(TEAM_BLUE, blue, ctf.blueScore)}</div>`,
  };
}

export function showResults(
  container: HTMLElement,
  ranking: RankRow[],
  meId: string,
  roomName: string,
  onBack: () => void,
  ctf?: CtfSummary,
): { dispose(): void } {
  const root = document.createElement('div');
  root.className = ctf ? 'results ctf' : 'results';
  let title = 'Match over';
  let titleClass = '';
  let sub: string;
  let body: string;
  if (ctf) {
    ({ title, titleClass, sub, body } = ctfBody(ranking, meId, ctf));
  } else {
    const medals = ['🥇', '🥈', '🥉'];
    const rows = ranking
      .map((r, i) => `<tr class="${r.id === meId ? 'me' : ''}"><td><span class="medal">${medals[i] ?? i + 1}</span></td><td>${r.isBot ? '\u{1F916} ' : ''}${escapeHtml(r.name)}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${kdRatio(r.kills, r.deaths).toFixed(2)}</td></tr>`)
      .join('');
    const winner = ranking[0];
    sub = winner ? `Winner: <b>${escapeHtml(winner.name)}</b>` : 'No players';
    body = `<table>
        <tr><th>#</th><th>Player</th><th>Kills</th><th>Deaths</th><th>K/D</th></tr>
        ${rows}
      </table>`;
  }
  root.innerHTML = `
    <div class="card">
      <h1 class="${titleClass}">${title}</h1>
      <div class="sub">${escapeHtml(roomName)} · ${sub}</div>
      ${body}
      <div class="actions">
        <button class="primary back">Back to lobby</button>
        <span class="auto"></span>
      </div>
    </div>`;
  container.appendChild(root);
  const auto = root.querySelector('.auto')!;
  const start = performance.now();
  const timer = window.setInterval(() => {
    const left = AUTO_RETURN_MS - (performance.now() - start);
    auto.textContent = `Returning in ${Math.max(0, Math.ceil(left / 1000))}s`;
    if (left <= 0) done();
  }, 250);
  const done = (): void => {
    dispose();
    onBack();
  };
  root.querySelector('.back')!.addEventListener('click', done);
  const dispose = (): void => {
    clearInterval(timer);
    root.remove();
  };
  return { dispose };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
