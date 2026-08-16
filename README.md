# Mineshoot

A Minecraft-looking, first-person, browser arena shooter. Create a timed room
(3/5/10/15 min), friends join from the public lobby, and everyone fights with a
**gun** (instant hitscan) or a **sword** (short-range melee). One hit kills;
you respawn 3 s later. When the timer runs out the ranking (kills, deaths, K/D)
is shown.

- **Zero assets** — the block texture atlas is drawn on a canvas at boot,
  players are box humanoids, no images or audio ship in the repo.
- **Shared voxel core** — world generation, AABB physics, voxel raycasts and
  the combat rules live in `packages/shared` and run identically in the browser
  (movement) and on the server (hits).
- **Authority split** — movement is client-authoritative (60 Hz local physics,
  20 Hz pose updates); combat is server-authoritative (the server raycasts every
  shot / sword swing against last-known positions and decides kills/respawns).

## Monorepo layout

| Package | What it is |
| --- | --- |
| `packages/shared` | Pure TypeScript: constants, deterministic worldgen, collision, raycast, player physics, gun/sword resolution, spawn picking, ranking. No runtime deps. |
| `packages/client` | Vite + three.js client: lobby, voxel renderer, pointer-lock FPS controls, HUD, results screen. |
| `packages/server` | Colyseus 0.16 authoritative `arena` room + `GET /rooms` lobby listing + `GET /health`. |

## Run locally

Requires Node 22+.

```sh
npm install
make start        # server on :2567 + client on :5173 (Ctrl-C stops both)
```

Open http://localhost:5173, enter a nickname, **Create room** (name + duration),
open a second tab and **Join** it from the list. Controls: WASD move, Space
jump, mouse aim (click to lock the pointer, Esc to release), LMB attack,
`1`/`2` or mouse wheel to switch gun/sword, hold Tab for the scoreboard.

`http://localhost:5173/?offline` runs an offline sandbox (walk around, no
server needed). `make start LAG=50` simulates 50 ms round-trip latency.

## Test

```sh
npm test                                     # shared + server + client unit/integration tests
npm run build                                # typecheck everything + production client build
node scripts/smoke.mjs                       # headless 2-player end-to-end run (needs `make start`
                                             # with MINESHOOT_TEST=1 on the server, and Google Chrome)
```

The smoke script drives two headless Chrome pages through lobby → create →
join → gun kill → respawn → sword kill → match end → results.

## Deploy

Server on [Fly.io](https://fly.io), static client on Cloudflare Pages.

```sh
fly launch --no-deploy -c packages/server/fly.toml   # once; edit app/region in fly.toml
make deploy-be                                       # fly deploy from the repo root
make deploy-fe VITE_SERVER_URL=wss://<your-app>.fly.dev
```

The room registry is in-process memory: keep the Fly app at a single machine.

## Gameplay tuning

All knobs are in `packages/shared/src/constants.ts` (world size, walk/jump,
gun cooldown/range, sword range/cone, respawn delay, room durations, max
players).

## Dependency notes

`package.json` pins `@colyseus/*` via `overrides`: `@colyseus/core@0.16.25`
was published with a `workspace:^` dependency that npm cannot install, so the
tree is held at the last good set (`core 0.16.24`, `schema 3.0.76`, matching
`colyseus 0.16.5` / `colyseus.js 0.16.22`). `colyseus.js` 0.16 has no
client-side room listing, hence the server's `GET /rooms` endpoint.
