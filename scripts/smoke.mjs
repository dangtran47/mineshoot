// Headless two-player smoke test: lobby → create → join → teleport → gun kill → respawn → match end → results.
// Usage: node scripts/smoke.mjs [outDir]
// Needs: MINESHOOT_TEST=1 server on :2567 and vite client on :5173.
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const pw = require('playwright-core');

const out = process.argv[2] ?? '/tmp';
const URL = 'http://localhost:5173/?testDurationMs=9000';
const browser = await pw.chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
const mk = async (name) => {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${name}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror ${e.message}`));
  await page.goto(URL);
  await page.fill('.nick', name);
  return page;
};
const shot = (p, n) => p.screenshot({ path: path.join(out, n) });
const a = await mk('Alice');
await a.fill('.roomname', 'Smoke Room');
await a.selectOption('.duration', '3');
await shot(a, 'lobby.png');
await a.click('.create');
await a.waitForSelector('canvas.game', { timeout: 10000 });

const b = await mk('Bob');
await b.waitForSelector('button.join:not([disabled])', { timeout: 10000 });
console.log('lobby rows:', (await b.textContent('.rooms')).replace(/\s+/g, ' ').trim());
await b.click('button.join');
await b.waitForSelector('canvas.game', { timeout: 10000 });
await a.waitForTimeout(800);
await shot(a, 'game-alice.png');

// Both onto the plateau (clear ground, y=10), Alice 6 blocks behind Bob facing -Z (yaw 0).
const tp = (p, x, z, yaw) => p.evaluate(([x, z, yaw]) => window.__mineshoot.local.teleport(x, 10, z, yaw), [x, z, yaw]);
await tp(a, 32.5, 36.5, 0);
await tp(b, 32.5, 30.5, Math.PI); // facing Alice
await a.waitForTimeout(300);
const remoteCount = (p) => p.evaluate(() => { let n = 0; window.__mineshoot.room.state.players.forEach(() => n++); return n; });
console.log('players seen by alice/bob:', await remoteCount(a), await remoteCount(b));
await shot(b, 'bob-sees-alice.png');

// Alice fires the gun.
await a.evaluate(() => { const g = window.__mineshoot; g.weapons.mouseDown(performance.now()); g.weapons.mouseUp(); });
await a.waitForFunction(() => document.querySelector('.stats').textContent.includes('K 1'), null, { timeout: 4000 });
console.log('alice stats:', await a.textContent('.stats'));
await b.waitForFunction(() => !document.querySelector('.center-msg').classList.contains('hidden'), null, { timeout: 4000 });
console.log('bob death msg:', (await b.textContent('.center-msg')).replace(/\s+/g, ' ').trim());
console.log('bob feed:', (await b.textContent('.feed')).trim());
await shot(b, 'bob-dead.png');
await shot(a, 'alice-after-kill.png');
// Bob respawns (1s test override) → death message hides.
await b.waitForFunction(() => document.querySelector('.center-msg').classList.contains('hidden'), null, { timeout: 4000 });
console.log('bob respawned; stats:', await b.textContent('.stats'));

// Sword: Bob teleports right in front of Alice and swings.
await tp(a, 32.5, 36.5, 0);
await tp(b, 32.5, 34.5, Math.PI);
await a.waitForTimeout(250);
await b.evaluate(() => { const g = window.__mineshoot; g.weapons.select(1); g.weapons.mouseDown(performance.now()); g.weapons.mouseUp(); });
await b.waitForFunction(() => document.querySelector('.stats').textContent.includes('K 1'), null, { timeout: 4000 });
console.log('bob stats after sword:', await b.textContent('.stats'));

// Match ends at 9s → results on both.
await a.waitForSelector('.results', { timeout: 15000 });
await b.waitForSelector('.results', { timeout: 15000 });
console.log('results alice:', (await a.textContent('.results table')).replace(/\s+/g, ' ').trim());
await shot(a, 'results.png');
await a.click('.results .back');
await a.waitForSelector('.lobby', { timeout: 5000 });
console.log('alice back in lobby');

// --- Bots scenario: fresh room with 3 bots ---
await a.fill('.roomname', 'Bot Room');
await a.selectOption('.duration', '3');
await a.selectOption('.bots', '3');
await a.click('.create');
await a.waitForSelector('canvas.game', { timeout: 10000 });
await b.click('.results .back').catch(() => {});
await b.waitForSelector('.lobby', { timeout: 5000 });
await b.waitForFunction(() => document.querySelector('.rooms')?.textContent.includes('Bot Room'), null, { timeout: 6000 });
console.log('lobby rows (bots):', (await b.textContent('.rooms')).replace(/\s+/g, ' ').trim());
const botPos = (p) => p.evaluate(() => { const o = {}; window.__mineshoot.room.state.players.forEach((pl, id) => { if (pl.isBot) o[id] = [pl.x.toFixed(1), pl.z.toFixed(1)]; }); return o; });
const p0 = await botPos(a);
console.log('bots seen by alice:', JSON.stringify(p0));
// Stand on the plateau and look around at the bots for a screenshot.
await tp(a, 32.5, 36.5, 0);
await a.waitForTimeout(2500);
const p1 = await botPos(a);
const moved = Object.keys(p0).filter((id) => p0[id][0] !== p1[id]?.[0] || p0[id][1] !== p1[id]?.[1]);
console.log('bots that moved:', moved.length, '/', Object.keys(p0).length);
console.log('alice feed/stats with bots:', (await a.textContent('.feed')).trim(), '|', await a.textContent('.stats'));
await shot(a, 'bots.png');
await a.click('button:has-text("Leave match")');
await a.waitForSelector('.lobby', { timeout: 5000 });
console.log('alice left bot room');
await browser.close();
console.log('console errors:', errors.length ? errors : 'none');
process.exit(errors.length ? 1 : 0);
