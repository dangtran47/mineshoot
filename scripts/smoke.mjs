// Headless two-player smoke test: lobby → create → join → teleport → gun kill → respawn → match end → results,
// then a bot room (weapon drop), a training range, and a capture-the-flag room (take → carry → score).
// Usage: node scripts/smoke.mjs [outDir]
// Needs: MINESHOOT_TEST=1 server on :2567 and vite client on :5173 (override the client with SMOKE_URL).
// SMOKE_DURATION_MS (default 12000) stretches the match budget for loaded machines (swiftshader
// screenshots slow down and the match can end mid-script otherwise).
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const pw = require('playwright-core');

const out = process.argv[2] ?? '/tmp';
const durationMs = Number(process.env.SMOKE_DURATION_MS ?? 12000);
const URL = `${process.env.SMOKE_URL ?? 'http://localhost:5173'}/?testDurationMs=${durationMs}`;
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
// Scope every join to its room's row: a human playing on the same dev server adds rows of their own.
await b.click('tr:has-text("Smoke Room") button.join');
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

// Alice fires the pistol (a deathmatch spawn holds a random primary, so switch first):
// a level shot from 6 blocks lands on Bob's head → 100 damage → kill.
console.log('health before:', await a.textContent('.health .hp'), await b.textContent('.health .hp'));
await a.evaluate(() => { const g = window.__mineshoot; g.weapons.select(0); g.weapons.mouseDown(performance.now()); g.weapons.mouseUp(); });
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

// Sword: Bob teleports right in front of Alice and holds LMB: light slashes repeat every cooldown (45 each →
// hp 55, then 10); he lets go, then holds RMB to charge (≥0.8 s) and releases the heavy overhead: headshot = 100 → kill.
await tp(a, 32.5, 36.5, 0);
await tp(b, 32.5, 34.5, Math.PI);
await a.waitForTimeout(250);
await b.evaluate(() => { const g = window.__mineshoot; g.weapons.select(1); g.weapons.mouseDown(performance.now()); });
await a.waitForFunction(() => document.querySelector('.health .hp').textContent === '55', null, { timeout: 4000 });
console.log('alice hp after light slash:', await a.textContent('.health .hp'));
await a.waitForFunction(() => document.querySelector('.health .hp').textContent === '10', null, { timeout: 4000 });
console.log('alice hp after held-LMB second slash:', await a.textContent('.health .hp'));
await b.evaluate(() => { const g = window.__mineshoot; g.weapons.mouseUp(performance.now()); g.weapons.altDown(performance.now()); });
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
console.log('bob weapon hud icon:', await b.evaluate(() => document.querySelector('.weapon .name .icon')?.getAttribute('aria-label')),
  '| label:', await b.textContent('.weapon .label'));
await shot(b, 'bob-revenge.png');


// Match ends at the test duration → results on both.
await a.waitForSelector('.results', { timeout: durationMs + 5000 });
await b.waitForSelector('.results', { timeout: durationMs + 5000 });
console.log('results alice:', (await a.textContent('.results table')).replace(/\s+/g, ' ').trim());
await shot(a, 'results.png');
await a.click('.results .back');
await a.waitForSelector('.lobby', { timeout: 5000 });
console.log('alice back in lobby');

// --- Bots scenario: fresh sword-only room with 3 bots, weapon drops every 1.5 s ---
await a.goto(`${URL}&testDropMs=1500`);
await a.fill('.nick', 'Alice');
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

// --- Weapon drops: they land on the central plateau (1.5 s test interval); walking over one arms it until death.
await a.waitForFunction(() => window.__mineshoot.room.state.drops.size > 0, null, { timeout: 8000 });
const firstDrop = (p) => p.evaluate(() => { let d = null; window.__mineshoot.room.state.drops.forEach((v, id) => { if (!d) d = { id, kind: v.kind, x: v.x, y: v.y, z: v.z }; }); return d; });
const drop = await firstDrop(a);
console.log('drop seen by alice:', JSON.stringify(drop), '| on plateau:', drop.x >= 25 && drop.x <= 39 && drop.z >= 25 && drop.z <= 39);
// Look at it from a few blocks away for a screenshot, then walk onto it.
// Stand 3 blocks away on the plateau side that has room, facing the drop.
const back = drop.z > 32 ? -3 : 3;
await a.evaluate(([x, y, z, back]) => window.__mineshoot.local.teleport(x, y, z + back, back > 0 ? 0 : Math.PI), [drop.x, drop.y, drop.z, back]);
await a.waitForTimeout(400);
await shot(a, 'drop-on-ground.png');
// A roaming bot can snatch a drop while Alice poses for the screenshot: keep walking onto drops until one arms her.
let taken = null;
for (let tries = 0; tries < 5 && !taken; tries++) {
  const d = await firstDrop(a);
  if (!d) { await a.waitForTimeout(1200); continue; }
  await a.evaluate(([x, y, z]) => window.__mineshoot.local.teleport(x, y, z, 0), [d.x, d.y, d.z]);
  await a.waitForFunction((id) => !window.__mineshoot.room.state.drops.has(id), d.id, { timeout: 5000 }).catch(() => {});
  if (await a.evaluate((k) => window.__mineshoot.weapons.melee === k, d.kind)) taken = d;
}
if (!taken) throw new Error('no drop could be picked up (bots kept snatching them?)');
console.log('alice picked up kind', taken.kind, '| toast:', await a.textContent('.toast'), '| hud label:', await a.textContent('.weapon .label'),
  '| hud icon:', await a.evaluate(() => document.querySelector('.weapon .name .icon')?.getAttribute('aria-label')),
  '| drop gone:', await a.evaluate((id) => !window.__mineshoot.room.state.drops.has(id), taken.id));
await a.waitForTimeout(300);
await shot(a, 'drop-picked-up.png');
await a.click('button:has-text("Leave match")');
await a.waitForSelector('.lobby', { timeout: 5000 });
console.log('alice left bot room');

// --- Training range: passive dummies parked on the plateau, melee picked directly with keys 3–7 (dev hook here).
await a.fill('.roomname', 'Range');
await a.selectOption('.duration', '3');
await a.selectOption('.mode', 'training');
console.log('training bots default:', await a.inputValue('.bots'));
await a.selectOption('.bots', '2');
await a.selectOption('.weapons', 'all');
await a.click('.create');
await a.waitForSelector('canvas.game', { timeout: 10000 });
await ready(a);
console.log('training room:', await a.textContent('.roomname'), '| hint:', await a.textContent('.weapon .hint'));
await b.waitForFunction(() => document.querySelector('.rooms')?.textContent.includes('Range'), null, { timeout: 6000 });
console.log('lobby rows (training):', (await b.textContent('.rooms')).replace(/\s+/g, ' ').trim());
const d0 = await botPos(a);
const onPlateau = Object.values(d0).every(([x, z]) => x >= 25 && x <= 40 && z >= 25 && z <= 40);
await tp(a, 32.5, 36.5, 0);
await a.waitForTimeout(1500);
const d1 = await botPos(a);
const dummiesMoved = Object.keys(d0).filter((id) => d0[id][0] !== d1[id]?.[0] || d0[id][1] !== d1[id]?.[1]);
console.log('dummies:', JSON.stringify(d0), '| on plateau:', onPlateau, '| moved:', dummiesMoved.length, '| alice hp:', await a.evaluate(() => window.__mineshoot.room.state.players.get(window.__mineshoot.room.sessionId).hp));
await a.evaluate(() => window.__mineshoot.pickMelee(2)); // katana
await a.waitForFunction(() => window.__mineshoot.weapons.melee === 2 && window.__mineshoot.weapons.current === 1, null, { timeout: 4000 });
console.log('picked katana | toast:', await a.textContent('.toast'), '| hud label:', await a.textContent('.weapon .label'));
await a.waitForTimeout(300);
await shot(a, 'training-range.png');
await a.click('button:has-text("Leave match")');
await a.waitForSelector('.lobby', { timeout: 5000 });
console.log('alice left training range');

// --- Capture the flag: Alice (red) creates, Bob joins blue from the lobby, Alice takes the blue flag and scores.
await a.fill('.roomname', 'Flags');
await a.selectOption('.mode', 'ctf');
await a.selectOption('.bots', '0');
console.log('ctf captures field visible:', await a.evaluate(() => !document.querySelector('.field.captures').classList.contains('hidden')));
await a.click('.create');
// The CTF map is 2.25× the arena: under swiftshader the first frames are slow, so wait for the canvas to exist rather than be "visible".
await a.waitForSelector('canvas.game', { state: 'attached', timeout: 15000 });
await ready(a);
// The creator's team is a coin flip (pickTeam): force Alice onto red so the flag run below is deterministic.
// Switching while alive kills her (1 s test respawn), so wait until she is back.
const myTeam = (p) => p.evaluate(() => window.__mineshoot.room.state.players.get(window.__mineshoot.room.sessionId).team);
if ((await myTeam(a)) !== 1) {
  await a.evaluate(() => window.__mineshoot.room.send('selectTeam', 1));
  await a.waitForFunction(() => window.__mineshoot.room.state.players.get(window.__mineshoot.room.sessionId).team === 1, null, { timeout: 4000 });
  await a.waitForFunction(() => window.__mineshoot.local.alive, null, { timeout: 8000 });
  console.log('alice switched to red');
}
const flag = (p, team) => p.evaluate((t) => { const f = window.__mineshoot.room.state.flags.get(String(t)); return { status: f.status, x: f.x, y: f.y, z: f.z, carrierId: f.carrierId }; }, team);
const meState = (p) => p.evaluate(() => { const g = window.__mineshoot; const m = g.room.state.players.get(g.room.sessionId); return { team: m.team, x: m.x, captures: m.captures }; });
console.log('ctf room:', await a.textContent('.roomname'), '| score bar:', (await a.textContent('.ctfbar')).replace(/\s+/g, ' ').trim(), '| alice:', JSON.stringify(await meState(a)));
await b.waitForFunction(() => document.querySelector('.rooms')?.textContent.includes('Flags'), null, { timeout: 6000 });
console.log('lobby rows (ctf):', (await b.textContent('.rooms')).replace(/\s+/g, ' ').trim());
await b.click('tr:has-text("Flags") button.join.t-blue');
await b.waitForSelector('canvas.game', { state: 'attached', timeout: 15000 });
await ready(b);
console.log('bob:', JSON.stringify(await meState(b)), '| overlay team buttons:', (await b.textContent('.overlay .teams')).replace(/\s+/g, ' ').trim());
const blueFlag = await flag(a, 2);
await a.evaluate(([x, y, z]) => window.__mineshoot.local.teleport(x, y, z, 0), [blueFlag.x, blueFlag.y, blueFlag.z]);
await a.waitForFunction(() => window.__mineshoot.room.state.flags.get('2').status === 'carried', null, { timeout: 4000 });
await a.waitForFunction(() => window.__mineshoot.weapons.current === 1 && !document.querySelector('.carry').classList.contains('hidden'), null, { timeout: 4000 });
console.log('alice carries blue flag | banner:', await a.textContent('.carry'), '| bob sees flag:', JSON.stringify(await flag(b, 2)));
await a.waitForTimeout(300);
await shot(a, 'ctf-carrying.png');
const redFlag = await flag(a, 1);
await a.evaluate(([x, y, z]) => window.__mineshoot.local.teleport(x + 2, y, z, 0), [redFlag.x, redFlag.y, redFlag.z]);
await a.waitForFunction(() => window.__mineshoot.room.state.redScore === 1, null, { timeout: 4000 });
await a.waitForFunction(() => document.querySelector('.carry').classList.contains('hidden'), null, { timeout: 4000 });
console.log('alice scored | score bar:', (await a.textContent('.ctfbar')).replace(/\s+/g, ' ').trim(), '| feed:', (await b.textContent('.feed')).replace(/\s+/g, ' ').trim());
await shot(b, 'ctf-scored-bob.png');
await b.click('button:has-text("Leave match")');
await b.waitForSelector('.lobby', { timeout: 5000 });
await a.click('button:has-text("Leave match")');
await a.waitForSelector('.lobby', { timeout: 5000 });
console.log('both left ctf room');

// --- Team elimination: crossroads rounds — Alice (red) wipes Bob (blue) three times; no respawn
// mid-round, fixed weapon rows re-laid each round, first to 3 round wins ends the match.
await a.fill('.roomname', 'Deathcross');
await a.selectOption('.mode', 'td');
console.log('td rounds field visible / duration hidden:',
  await a.evaluate(() => !document.querySelector('.field.rounds').classList.contains('hidden')),
  await a.evaluate(() => document.querySelector('.field.durfield').classList.contains('hidden')));
await a.selectOption('.roundlimit', '3');
await a.click('.create');
await a.waitForSelector('canvas.game', { state: 'attached', timeout: 15000 });
await ready(a);
// The creator's team is a coin flip: put Bob on the other side and score for whichever side Alice got.
const aTeam = await myTeam(a);
const tdState = (p) => p.evaluate(() => { const s = window.__mineshoot.room.state; return { round: s.round, phase: s.roundPhase, red: s.roundsRed, blue: s.roundsBlue, limit: s.roundLimit, drops: s.drops.size }; });
console.log('td room:', await a.textContent('.roomname'), '| alice team:', aTeam, '| bar:', (await a.textContent('.ctfbar')).replace(/\s+/g, ' ').trim(),
  '| timer hidden:', await a.evaluate(() => document.querySelector('.timer').classList.contains('hidden')),
  '| state:', JSON.stringify(await tdState(a)));
await b.waitForFunction(() => document.querySelector('.rooms')?.textContent.includes('Deathcross'), null, { timeout: 6000 });
console.log('lobby rows (td):', (await b.textContent('.rooms')).replace(/\s+/g, ' ').trim());
await b.click(`tr:has-text("Deathcross") button.join.${aTeam === 1 ? 't-blue' : 't-red'}`);
await b.waitForSelector('canvas.game', { state: 'attached', timeout: 15000 });
await ready(b);
// A fixed weapon on Alice's half: walking over it arms the primary. (Red is the north half, z < 32.)
const gunDrop = await a.evaluate((t) => { let d = null; window.__mineshoot.room.state.drops.forEach((v) => { if (!d && (v.z < 32) === (t === 1)) d = { kind: v.kind, x: v.x, y: v.y, z: v.z }; }); return d; }, aTeam);
await a.evaluate(([x, y, z]) => window.__mineshoot.local.teleport(x, y, z, 0), [gunDrop.x, gunDrop.y, gunDrop.z]);
await a.waitForFunction((k) => window.__mineshoot.weapons.gun === k, gunDrop.kind, { timeout: 4000 });
console.log('alice grabbed fixed gun kind', gunDrop.kind, '| toast:', await a.textContent('.toast'));
await shot(a, 'td-gun-row.png');
// Pistol headshots until the round falls (spawn protection is 500 ms under the test override;
// the pair drops from the teleport height first, so early shots can miss mid-fall poses).
const ourRounds = (n, timeout) => a.waitForFunction((args) => {
  const s = window.__mineshoot.room.state;
  return (args.t === 1 ? s.roundsRed : s.roundsBlue) === args.n;
}, { t: aTeam, n }, { timeout });
const wipeRound = async (n) => {
  await tp(a, 32.5, 36.5, 0);
  await tp(b, 32.5, 30.5, Math.PI);
  await a.waitForTimeout(900);
  for (let i = 0; i < 8; i++) {
    await a.evaluate(() => { const g = window.__mineshoot; g.weapons.select(0); g.weapons.mouseDown(performance.now()); g.weapons.mouseUp(); });
    try {
      await ourRounds(n, 700);
      return;
    } catch { /* shot rate-limited or missed: fire again */ }
  }
  throw new Error(`round ${n} was not won`);
};
await wipeRound(1);
console.log('round 1 to alice | state:', JSON.stringify(await tdState(a)), '| bar:', (await a.textContent('.ctfbar')).replace(/\s+/g, ' ').trim());
// The round result shows as a big centre banner on everyone.
console.log('round banner:', (await a.textContent('.round-banner')).trim(),
  '| visible:', await a.evaluate(() => !document.querySelector('.round-banner').classList.contains('hidden')));
// Bob stays dead through the intermission (no respawn countdown, a spectate note instead).
await b.waitForFunction(() => !document.querySelector('.center-msg').classList.contains('hidden'), null, { timeout: 4000 });
console.log('bob death note:', (await b.textContent('.center-msg .countdown')).trim());
await shot(b, 'td-bob-waits.png');
await a.waitForFunction(() => window.__mineshoot.room.state.round === 2 && window.__mineshoot.room.state.roundPhase === 'live', null, { timeout: 10000 });
await b.waitForFunction(() => window.__mineshoot.local.alive, null, { timeout: 4000 });
console.log('round 2 live | bob back:', await b.evaluate(() => window.__mineshoot.local.alive),
  '| alice gun reset:', await a.evaluate(() => window.__mineshoot.weapons.gun === 0),
  '| drops re-laid:', await a.evaluate(() => window.__mineshoot.room.state.drops.size));
// Fresh spawns are frozen behind the 3-2-1 countdown (the wipe helper just retries through it).
console.log('countdown banner on bob:', (await b.textContent('.round-banner')).trim());
await shot(b, 'td-countdown.png');
await wipeRound(2);
await a.waitForFunction(() => window.__mineshoot.room.state.round === 3 && window.__mineshoot.room.state.roundPhase === 'live', null, { timeout: 10000 });
await b.waitForFunction(() => window.__mineshoot.local.alive, null, { timeout: 4000 });
await wipeRound(3);
// First to 3 → team results without a Caps column.
await a.waitForSelector('.results', { timeout: 8000 });
await b.waitForSelector('.results', { timeout: 8000 });
console.log('td results alice:', (await a.textContent('.results h1')).trim(), '|', (await a.textContent('.results .sub')).replace(/\s+/g, ' ').trim(),
  '| caps column:', await a.evaluate(() => [...document.querySelectorAll('.results th')].some((th) => th.textContent === 'Caps')));
await shot(a, 'td-results.png');
await a.click('.results .back');
await a.waitForSelector('.lobby', { timeout: 5000 });
await b.click('.results .back');
await b.waitForSelector('.lobby', { timeout: 5000 });
console.log('both left td room');
await browser.close();
console.log('console errors:', errors.length ? errors : 'none');
process.exit(errors.length ? 1 : 0);
