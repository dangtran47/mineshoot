// Headless two-player smoke test: lobby → create → join → teleport → gun kill → respawn → match end → results.
// Usage: node scripts/smoke.mjs [outDir]
// Needs: MINESHOOT_TEST=1 server on :2567 and vite client on :5173 (override the client with SMOKE_URL).
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const pw = require('playwright-core');

const out = process.argv[2] ?? '/tmp';
const URL = `${process.env.SMOKE_URL ?? 'http://localhost:5173'}/?testDurationMs=9000`;
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
// Headless Chrome cannot pointer-lock, so "click to play" is driven through the dev hook: the server
// only spawns us after MSG.ready. Waits until we are alive (teleported to the server-chosen spawn).
const ready = async (p) => {
  await p.evaluate(() => window.__mineshoot.ready());
  await p.waitForFunction(() => window.__mineshoot.local.alive, null, { timeout: 4000 });
};
const shieldShown = (p) => p.evaluate(() => !document.querySelector('.shield').classList.contains('hidden'));
const a = await mk('Alice');
await a.fill('.roomname', 'Smoke Room');
await a.selectOption('.duration', '3');
await shot(a, 'lobby.png');
await a.click('.create');
await a.waitForSelector('canvas.game', { timeout: 10000 });
// Before clicking to play we are parked, not spawned: no health/damage possible, no shield yet.
console.log('alice alive before ready:', await a.evaluate(() => window.__mineshoot.local.alive));
await ready(a);
console.log('alice shield right after spawn:', await shieldShown(a));
await a.waitForFunction(() => document.querySelector('.shield').classList.contains('hidden'), null, { timeout: 4000 });
console.log('alice shield after 500ms test override: hidden');

const b = await mk('Bob');
await b.waitForSelector('button.join:not([disabled])', { timeout: 10000 });
console.log('lobby rows:', (await b.textContent('.rooms')).replace(/\s+/g, ' ').trim());
await b.click('button.join');
await b.waitForSelector('canvas.game', { timeout: 10000 });
await ready(b);
await b.waitForFunction(() => document.querySelector('.shield').classList.contains('hidden'), null, { timeout: 4000 });
await a.waitForTimeout(300);
await shot(a, 'game-alice.png');

// Both onto the plateau (clear ground, y=10), Alice 6 blocks behind Bob facing -Z (yaw 0).
const tp = (p, x, z, yaw) => p.evaluate(([x, z, yaw]) => window.__mineshoot.local.teleport(x, 10, z, yaw), [x, z, yaw]);
await tp(a, 32.5, 36.5, 0);
await tp(b, 32.5, 30.5, Math.PI); // facing Alice
await a.waitForTimeout(300);
const remoteCount = (p) => p.evaluate(() => { let n = 0; window.__mineshoot.room.state.players.forEach(() => n++); return n; });
console.log('players seen by alice/bob:', await remoteCount(a), await remoteCount(b));
await shot(b, 'bob-sees-alice.png');

// Alice fires the gun: a level shot from 6 blocks lands on Bob's head → 100 damage → kill.
console.log('health before:', await a.textContent('.health .hp'), await b.textContent('.health .hp'));
await a.evaluate(() => { const g = window.__mineshoot; g.weapons.mouseDown(performance.now()); g.weapons.mouseUp(); });
await a.waitForFunction(() => document.querySelector('.stats').textContent.includes('K 1'), null, { timeout: 4000 });
console.log('alice stats:', await a.textContent('.stats'), '| ammo:', await a.textContent('.weapon .ammo'));
await b.waitForFunction(() => !document.querySelector('.center-msg').classList.contains('hidden'), null, { timeout: 4000 });
console.log('bob death msg:', (await b.textContent('.center-msg')).replace(/\s+/g, ' ').trim());
console.log('bob feed:', (await b.textContent('.feed')).trim());
// Bob's own death is red and shows the headshot icon; Alice's own kill is green.
console.log('bob feed class / gun+headshot icons:', await b.evaluate(() => document.querySelector('.feed div').className),
  await b.evaluate(() => !!document.querySelector('.feed .icon-gun') && !!document.querySelector('.feed .icon-headshot')),
  '| alice feed class:', await a.evaluate(() => document.querySelector('.feed div').className),
  '| death panel icons:', await b.evaluate(() => [...document.querySelectorAll('.center-msg .icon')].map((e) => e.getAttribute('aria-label')).join(',')));
await shot(b, 'bob-dead.png');
await shot(a, 'alice-after-kill.png');
// Bob respawns (1s test override) → death message hides.
await b.waitForFunction(() => document.querySelector('.center-msg').classList.contains('hidden'), null, { timeout: 4000 });
await b.waitForFunction(() => document.querySelector('.health .hp').textContent === '100', null, { timeout: 4000 });
console.log('bob respawned; stats:', await b.textContent('.stats'), 'hp:', await b.textContent('.health .hp'), 'shield:', await shieldShown(b));
await b.waitForFunction(() => document.querySelector('.shield').classList.contains('hidden'), null, { timeout: 4000 });

// Sword: Bob teleports right in front of Alice, holds RMB to charge (≥0.8 s), releases: charged headshot = 100 → kill.
await tp(a, 32.5, 36.5, 0);
await tp(b, 32.5, 34.5, Math.PI);
await a.waitForTimeout(250);
await b.evaluate(() => { const g = window.__mineshoot; g.weapons.select(1); g.weapons.altDown(performance.now()); });
// Alice sees Bob's charge: synced flag + wound-up humanoid arm / glowing blade.
// (Checked before the screenshots: a charge auto-releases after SWORD_CHARGE_MAX_MS and headless screenshots are slow.)
await a.waitForFunction(() => { let c = false; const me = window.__mineshoot.room.sessionId; window.__mineshoot.room.state.players.forEach((pl, id) => { if (id !== me && pl.charging) c = true; }); return c; }, null, { timeout: 2000 });
console.log('alice sees bob charging: true');
await b.waitForFunction(() => document.querySelector('.charge').classList.contains('ready'), null, { timeout: 4000 });
await shot(a, 'alice-sees-bob-charging.png');
await shot(b, 'bob-charging.png');
await b.evaluate(() => window.__mineshoot.weapons.altUp(performance.now()));
await b.waitForFunction(() => document.querySelector('.stats').textContent.includes('K 1'), null, { timeout: 4000 });
console.log('bob stats after sword:', await b.textContent('.stats'));
// Bob was last killed by Alice → this kill is REVENGE: banner on Bob, tag in everyone's feed.
console.log('bob announce:', (await b.textContent('.announce')).replace(/\s+/g, ' ').trim(),
  '| icons:', await b.evaluate(() => [...document.querySelectorAll('.announce .icon')].map((e) => e.getAttribute('aria-label')).join(',')),
  '| hidden:', await b.evaluate(() => document.querySelector('.announce').classList.contains('hidden')));
console.log('alice feed after sword kill:', await a.evaluate(() => [...document.querySelectorAll('.feed div')].map((d) => d.title).join(' | ')));
console.log('bob weapon hud icon:', await b.evaluate(() => document.querySelector('.weapon .name .icon')?.getAttribute('aria-label')));
await shot(b, 'bob-revenge.png');

// Match ends at 9s → results on both.
await a.waitForSelector('.results', { timeout: 15000 });
await b.waitForSelector('.results', { timeout: 15000 });
console.log('results alice:', (await a.textContent('.results table')).replace(/\s+/g, ' ').trim());
await shot(a, 'results.png');
await a.click('.results .back');
await a.waitForSelector('.lobby', { timeout: 5000 });
console.log('alice back in lobby');

// --- Bots scenario: fresh sword-only room with 3 bots ---
await a.fill('.roomname', 'Bot Room');
await a.selectOption('.duration', '3');
await a.selectOption('.bots', '3');
await a.selectOption('.weapons', 'sword');
await a.click('.create');
await a.waitForSelector('canvas.game', { timeout: 10000 });
await ready(a);
console.log('sword-only room: weapon', await a.textContent('.weapon .name'), '| hint:', await a.textContent('.weapon .hint'),
  '| switch to gun ignored:', await a.evaluate(() => { window.__mineshoot.weapons.select(0); return window.__mineshoot.weapons.current === 1; }));
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
