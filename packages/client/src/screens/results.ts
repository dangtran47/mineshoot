import { kdRatio } from '@mineshoot/shared';
import type { RankRow } from '@mineshoot/shared';

const AUTO_RETURN_MS = 15_000;

export function showResults(
  container: HTMLElement,
  ranking: RankRow[],
  meId: string,
  roomName: string,
  onBack: () => void,
): { dispose(): void } {
  const root = document.createElement('div');
  root.className = 'results';
  const medals = ['🥇', '🥈', '🥉'];
  const rows = ranking
    .map(
      (r, i) =>
        `<tr class="${r.id === meId ? 'me' : ''}"><td><span class="medal">${medals[i] ?? i + 1}</span></td><td>${escapeHtml(r.name)}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${kdRatio(r.kills, r.deaths).toFixed(2)}</td></tr>`,
    )
    .join('');
  const winner = ranking[0];
  root.innerHTML = `
    <div class="card">
      <h1>Match over</h1>
      <div class="sub">${escapeHtml(roomName)} · ${winner ? `Winner: <b>${escapeHtml(winner.name)}</b>` : 'No players'}</div>
      <table>
        <tr><th>#</th><th>Player</th><th>Kills</th><th>Deaths</th><th>K/D</th></tr>
        ${rows}
      </table>
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
