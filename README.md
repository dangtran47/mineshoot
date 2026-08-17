# Mineshoot

A Minecraft-looking, first-person, browser arena shooter you can spin up in
thirty seconds and share with friends or coworkers. No install, no accounts,
no assets — open the link, type a nickname, create a room, send the link
around, and shoot each other for 3–15 minutes. Then argue about the K/D table.

**Play it now:** <https://mineshoot.pages.dev>

> Made for fun with friends and colleagues — lunch-break deathmatches, end-of-
> sprint celebrations, "who's the best aim on the team" disputes. It is not a
> commercial game and does not try to be balanced for esports; it tries to be
> silly and quick to get into. Bots are there so you can play alone or fill
> out a small group.

---

## Table of contents

- [What it looks like](#what-it-looks-like)
- [How to play](#how-to-play)
- [Gameplay](#gameplay)
- [Run it locally](#run-it-locally)
- [Test](#test)
- [Deploy your own](#deploy-your-own)
- [Repository layout](#repository-layout)
- [Documentation](#documentation)
- [Dependency notes](#dependency-notes)

---

## What it looks like

- Voxel arena (64×24×64 blocks) generated from a seed — hills, a raised
  central plateau, border walls. Every room gets a fresh world.
- Blocky humanoids in eight colours with nametags, walk/attack animations,
  first-person view models for the gun and every melee weapon.
- HUD with health, ammo, timer, kill feed, crosshair, damage vignette,
  floating damage numbers, voxel blood spray, and a Tab scoreboard.
- **Zero shipped assets**: the block texture atlas is painted onto a canvas at
  boot, everything else is geometry. No images, no audio in the repo.

## How to play

1. Open the demo (or your local build), enter a nickname.
2. **Create room** — pick a name, duration (3/5/10/15 min), the **room
   type** (Deathmatch or Training range), how many **AI bots** (0–7) and the
   **allowed weapons** (Gun + Sword, Gun only, Sword only). Or **Join** an
   existing room from the public list.
3. **Click to play.** You are not in the arena until you click; nobody can
   hit you while you are still reading the overlay.
4. Fight until the timer runs out. Rankings (kills, deaths, K/D) are shown at
   the end; the room closes shortly after.

| Input | Action |
| --- | --- |
| Mouse | Aim (click to lock the pointer, `Esc` to release) |
| `W A S D` / `Space` | Move / jump |
| `LMB` (tap or hold) | Shoot (gun) · **light** melee slash — keeps swinging while held, alternating left / right |
| `RMB` hold (≥ charge time), release | **Heavy** melee blow — each weapon's own signature move (overhead, execute, iaido, reap, head-hunt) |
| `R` | Reload (automatic when the magazine is empty) |
| `1` / `2` / mouse wheel | Switch gun / melee |
| `Tab` (hold) | Scoreboard |

Up to **8 players** per room (bots take player slots). Rooms are public and
listed in the lobby; there is no password — it's meant to be casual.

## Gameplay

Everyone has **100 HP** and respawns **3 s** after dying with **2 s of spawn
protection** (you cannot be targeted or damaged; attacking ends it early).
Damage depends on where you hit:

- **Gun** — instant hitscan, 10-round magazine, unlimited reloads.
  Head 100 / torso 30 / legs 15.
- **Sword** — short-range melee. `LMB` is a quick light slash (head 45 / body
  30, hits the nearest target in a 56° cone); hold it to keep slashing every
  0.5 s, left and right in turn. Hold `RMB` to charge (you walk 30 % slower)
  and release ≥ 0.8 s later for the **heavy** overhead (head 100 / body 70,
  narrower 40° cone but sweeps everyone in it); letting go earlier just
  cancels, holding longer than 2 s releases it by itself. `LMB` does nothing
  while you charge.

### Weapon drops

In any room where melee is allowed, **weapon drops** land on the central
plateau every 25–45 s (at most 3 on the ground, gone after 60 s if nobody takes
them). Walk over the glowing column to pick one up: it replaces your sword until
you die. Bots pick them up too. Every drop beats the sword somewhere and pays
for it somewhere else:

| Weapon | Reach | Light / heavy cone | Light dmg (head/body) | Heavy (`RMB`) | Heavy dmg | Cooldown | Charge | Twist |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Sword (default) | 3.0 | 28° / 20° | 45 / 30 | Overhead | 100 / 70 | 500 ms | 0.8 s | — |
| Battle Axe | 3.2 | 30° / 24° | 55 / 40 | Execute | 100 / 100 | 800 ms | 1.1 s | light swings **cleave** everyone in the cone; a heavy hit kills anywhere; you crawl (55 %) while charging |
| Katana | 3.8 | 20° / 14° | 50 / 35 | Iaido (horizontal) | 100 / 80 | 300 ms | 0.55 s | fast and long, narrow cone — you have to aim |
| Scythe | 3.5 | 50° / 45° | 40 / 30 | Reap | 90 / 65 | 650 ms | 0.9 s | huge arc, light swings **cleave**; low per-hit damage |
| Pickaxe | 3.0 | 24° / 18° | 80 / 30 | Head-hunt | 100 / 60 | 550 ms | 0.7 s | head-hunter: light head hits nearly one-shot, body hits are weak |

The kill feed calls out headshots, multi-kills (DOUBLE KILL … MEGA KILL),
streak milestones (KILLING SPREE / RAMPAGE / UNSTOPPABLE / GODLIKE), revenge,
and "shutdown" when you end someone's streak.

### Bots

A room can be created with 0–7 bots. They run entirely on the server using
the same shared physics and combat rules as humans: wander between spawn
points, hunt the nearest enemy in line of sight, keep mid-range while strafing,
aim with a reaction delay and distance-scaled error, shoot the gun and switch
to melee up close. They die, respawn and rank like everyone else and show a 🤖
in nametags and the scoreboard.

### Training range

Create a room as a **Training range** (🎯 in the lobby list) to try every
weapon in peace. Same arena and rules as a match, except:

- Bots are **passive dummies**: they stand on the central plateau (spaced out
  like drops), turn to face you, never attack, and everyone respawns after
  **1 s** instead of 3 s so the range refills at once. Pick 0–7 of them; the
  lobby fills in 3 when you leave the count at zero.
- Keys **`3`–`7`** put any melee weapon straight into slot 2 — Sword, Battle
  Axe, Katana, Scythe, Pickaxe — no drop needed (drops still fall too). Outside
  a training range those keys do nothing; drops remain the only way to a
  better blade.
- The gun, magazine, spawn protection, timer, kill feed and scoreboard work
  as usual, so a training range with friends is a fine warm-up.

The offline sandbox (`?offline`) also honours keys `3`–`7`.

### Tuning

All knobs are constants in `packages/shared`:

- `constants.ts` — world size, walk/jump, gun cooldown/range/magazine/reload,
  sword range/cone/charge, HP and per-body-part damage, hitbox bands, respawn
  delay, spawn protection, room durations, max players.
- `melee.ts` — the melee move-set table (`MELEE_STATS`: light / heavy per
  weapon, each with cone, reach, damage, sweep, cooldown and animation), drop
  cadence, cap, lifetime and pickup radius.
- `bot.ts` — bot reaction time, aim error, preferred range, etc.

## Run it locally

Requires **Node 22+** and npm.

```sh
npm install
make start        # server on :2567 + client on :5173 (Ctrl-C stops both)
```

Open <http://localhost:5173>, create a room, then open a second tab (or a
second browser / a friend on your LAN) and join it from the list.

Handy extras:

- `http://localhost:5173/?offline` — offline sandbox (walk around, try every
  melee weapon with keys 3–7, no server).
- `make start LAG=50` — simulate 50 ms round-trip latency.
- `make server` / `make client` — run only one side.

## Test

```sh
npm test            # shared + server + client unit/integration tests (vitest)
npm run build       # typecheck every package + production client build
npm run smoke       # headless 2-player end-to-end run in real Chrome
```

The smoke script (`scripts/smoke.mjs`) needs `make start` running with
`MINESHOOT_TEST=1` on the server and Google Chrome installed. It drives two
headless pages through lobby → create → join → gun kill → respawn → sword kill →
match end → results, then a bot room where a weapon drop is spotted and picked
up.

## Deploy your own

The demo runs the server on [Fly.io](https://fly.io) (single shared-cpu
machine, Singapore) and the static client on Cloudflare Pages. Anything that
can run a Node 22 WebSocket server and host static files works.

```sh
# once: create the Fly app (edit app name / region in fly.toml)
fly launch --no-deploy -c packages/server/fly.toml

make deploy-be                                        # fly deploy from the repo root
make deploy-fe VITE_SERVER_URL=wss://<your-app>.fly.dev
```

`VITE_SERVER_URL` is baked into the client bundle at build time (see
`packages/client/.env.example`). The room registry lives in server memory, so
keep the backend at **one machine** (`--ha=false`).

## Repository layout

```
packages/
  shared/   pure TypeScript game core (no runtime deps) — constants, worldgen,
            AABB physics, voxel raycasts, gun/melee resolution, drops, spawn,
            ranking, bot AI, wire protocol types
  server/   Colyseus 0.16 authoritative "arena" room + GET /rooms + GET /health
  client/   Vite + three.js: lobby, voxel renderer, pointer-lock FPS controls,
            HUD, results screen
scripts/    smoke.mjs — headless end-to-end test
docs/       ARCHITECTURE.md and other design notes
Makefile    start / test / build / deploy shortcuts
```

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the pieces fit: the
  shared voxel core, the authority split, the message protocol, room lifecycle,
  bots, drops, rendering, deployment and testing strategy.
- [`AGENTS.md`](AGENTS.md) — working agreement for AI coding agents (and
  humans): commands, conventions, where things live, what not to break.
- [`CLAUDE.md`](CLAUDE.md) — Claude Code entry point (imports `AGENTS.md`).

## Dependency notes

`package.json` pins `@colyseus/*` via `overrides`: `@colyseus/core@0.16.25` was
published with a `workspace:^` dependency that npm cannot install, so the tree
is held at the last good set (`core 0.16.24`, `schema 3.0.76`, matching
`colyseus 0.16.5` / `colyseus.js 0.16.22`). `colyseus.js` 0.16 has no
client-side room listing, hence the server's `GET /rooms` endpoint.

---

Have fun, be nice to your colleagues, and don't camp the spawn points.
