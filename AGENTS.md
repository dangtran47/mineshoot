# AGENTS.md — working agreement for coding agents

This file is the entry point for any AI coding agent (Claude Code, Codex,
Cursor, Copilot, …) and for humans who want the short version. Keep it
accurate: when a command, path or rule below changes, change it here in the
same commit.

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before touching gameplay,
networking or the server room. Read [`README.md`](README.md) for the player-
facing description of the game.

## What this project is

Mineshoot: a browser voxel FPS (Minecraft look) for playing with friends and
colleagues. npm workspaces monorepo, TypeScript everywhere, three packages:

| Package | Role | Runtime deps |
| --- | --- | --- |
| `packages/shared` | Pure game core: constants, worldgen (arena + CTF + TD maps), physics, raycasts, gun/grenade/melee/drops/spawn/CTF/TD/ranking rules, bot AI, wire protocol types | **none** (keep it that way) |
| `packages/server` | Colyseus 0.16 `arena` room; `GET /rooms`, `GET /health` | `colyseus`, `@colyseus/schema`, `@colyseus/ws-transport` |
| `packages/client` | Vite + three.js: lobby, renderer, FPS controls, HUD, results | `three`, `colyseus.js` |

Live demo: <https://mineshoot.pages.dev> (client on Cloudflare Pages, server on
Fly.io `mineshoot-server-prd`, region `sin`, one machine).

## Commands

```sh
npm install                 # Node 22+
make start                  # server :2567 + client :5173 (Ctrl-C stops both)
make start LAG=50           # …with 50 ms simulated round-trip
make server / make client   # one side only

npm test                    # vitest in every package (shared, server, client)
npm run test -w @mineshoot/shared      # one package
npx vitest run test/melee.test.ts -w @mineshoot/shared   # one file
npm run build               # tsc --noEmit everywhere + vite production build
npm run smoke               # headless 2-player e2e; needs `make start` with
                            # MINESHOOT_TEST=1 on the server + Google Chrome
                            # (SMOKE_DURATION_MS=30000 on loaded machines: the
                            # default 12 s match budget can expire mid-script)

make deploy-be              # fly deploy (from repo root, --ha=false)
make deploy-fe VITE_SERVER_URL=wss://<app>.fly.dev
```

There is no linter/formatter config; match the surrounding style (2-space
indent, single quotes, semicolons, trailing commas, `import type` for types).

## Definition of done

Before you say a change is finished:

1. `npm test` passes (all three packages).
2. `npm run build` passes (this is the typecheck — vitest does not typecheck).
3. If you touched networking, the room, the game screen, the lobby, or
   anything the smoke test exercises: run `npm run smoke` against a
   `MINESHOOT_TEST=1` server and it must reach the results screen without
   console errors. Say explicitly if you could not run it (no Chrome, etc.).
4. If a rule/number in `constants.ts` / `melee.ts` / `bot.ts` changed, update
   the matching sentence or table in `README.md`.
5. Do not commit unless asked. Never `git push`/deploy unless asked.

## Rules that keep the game consistent

**Shared first.** Any rule that both the browser and the server must agree on
(movement, collision, what a shot hits, damage numbers, cones, cooldowns,
spawn picking, drop placement, bot behaviour) lives in `packages/shared` as a
pure function of plain data, with a unit test. The client and the server call
the same function. Never re-implement a rule on one side, never import
`three`/`colyseus`/DOM into `shared`.

**Authority split.** Movement is client-authoritative (60 Hz local physics,
poses sent at 20 Hz). Combat is server-authoritative: the server re-raycasts
every shot and swing against last-known poses and is the only place HP, kills,
deaths, respawns, drops and match phase change. Clients only *predict* visuals
(view-model animation, tracers, HUD feedback). If you add a
gameplay message, the server validates it in `rooms/validate.ts` and ignores
garbage rather than throwing.

**Epoch guard.** Every attack/pose message carries the player's `spawnEpoch`.
`ArenaRoom.actor()` drops messages from a stale epoch (dead, or not yet
clicked-to-play). Keep sending it; keep checking it.

**Weapon mode is enforced server-side.** There are five weapon slots
(`WEAPONS`: primary gun, pistol, melee, grenade, taser — note slot values 0/1
are pistol/melee for wire compatibility, so key order ≠ value order).
`weaponAllowed(mode, slot)` gates shoot/swing/charge/chargeCancel/reload/throw
and the drop pool (`dropPool(mode)`: guns + grenade packs where guns are
allowed, blades where melee is). Bots receive the mode too. Do not rely on
the client hiding a button. Likewise the room mode (`'match'|'training'|'ctf'|'td'`):
`meleeSelectable(mode, weapons)` gates `selectWeapon` on the server; a match
never lets you pick a weapon at will — but a deathmatch (re)spawn with guns
allowed rolls a random primary (`spawnPrimary`, taser excluded); ctf spawns
pistol-only; td spawns blade-only (empty pistol slot too — `spawnWeapon`; the
fixed ground pistols and gun rows fill the slots). Walking over a drop only
fills an **empty** slot (`autoPickUpAllowed`; the plain sword counts as empty
melee): to swap, `MSG.dropWeapon` (G) throws the held weapon down as a drop
that expires after `DROP_THROWN_LIFETIME_MS` (5 s, even in td) with a
`DROP_THROWN_GRACE_MS` (1.5 s) no-re-pickup grace for the thrower only.

**Team elimination (td) is round-based and server-authoritative.** Rounds
(`RoomState.roundPhase/round/roundsRed/roundsBlue/roundLimit`) live in
`ArenaRoom.tickRound/startRound` + pure `roundWinner` in `shared/td.ts`; no
respawn mid-round, no clocks (`tickTimer` is skipped). Fixed weapon rows come
from `GeneratedWorld.weaponSpots` × `tdWeaponLoadout` and never expire — in td
`tickDrops` skips only the random drop spawning (pickup and thrown-drop expiry
still run). Every td spawn is frozen for
`TD_FREEZE_MS` (3-2-1 countdown): the server drops attacks from frozen
players and holds bots still; kill streaks reset each round
(`KillTracker.resetStreaks`).

**Capture the flag is server-authoritative too.** Flags (`RoomState.flags`),
scores, teams and every carrier rule live in `ArenaRoom.tickFlags` + pure
helpers in `shared/ctf.ts`: no friendly fire (`targetsExcluding`), a carrier's
`shoot` is dropped, spawns come from `teamSpawns()`, `selectTeam`/`dropFlag`
are validated in `validate.ts`. The client only mirrors: melee lock, carry
speed, flag meshes, HUD. Never trust the client for any of it.

**World size comes from the world.** The CTF map is 96×48, the arena 64×64
and the TD crossroads map 76×76.
Read `world.sx/sz` (or the `GeneratedWorld`'s `dropZone`/`bases`), never
`WORLD_SX/SZ`, outside `worldgen.ts`; poses are clamped to the room's world.

**Rate limits are server constants.** `GUN_SERVER_MIN_INTERVAL_MS`,
`serverMinIntervalMs` per melee attack, `GUN_RELOAD_SERVER_MIN_MS` are slightly
looser than the client cooldowns on purpose (jitter tolerance). Keep that gap.

**No assets.** Textures are drawn to a canvas (`render/atlas.ts`), everything
else is geometry/CSS. Do not add image/audio/font files.

**Determinism.** World generation, spawn points and drop placement come from
`createRng(seed)`; the client regenerates the world from `state.seed`. Never
use `Math.random()` inside `shared`; thread an `rng` through.

**Colyseus pins.** `package.json` `overrides` hold `@colyseus/*` at 0.16.24 /
schema 3.0.76 because 0.16.25 is uninstallable with npm. Don't bump without
checking `npm install` from a clean tree. `colyseus.js` 0.16 has no room
listing on the client — that's why `GET /rooms` exists.

**Test hooks.** `MINESHOOT_TEST=1` on the server unlocks `testOverrides` in
room create options (short match, fast respawn/drops). The client passes
`?testDurationMs=` through. Never honour those without the env flag.

## Where things live (quick map)

```
packages/shared/src/
  constants.ts     every tunable number (world, movement, weapons, HP, timers)
  guns.ts          GunKind (pistol/rifle/smg/shotgun/sniper/taser), GUN_STATS,
                   pelletDirections() spread rays, spawnPrimary() deathmatch roll,
                   per-shell reload rules (serverReloadMs/interruptedReloadAmmo)
  recoil.ts        per-gun spray patterns (RECOIL_PATTERNS), recoilKick(),
                   recoilKickMs() ramp, recoilResetMs(), recovery rate — applied
                   client-side (the taser lives in its own slot, WEAPON_TASER)
  grenade.ts       grenade constants, throwGrenade()/stepGrenade() bounce sim
                   (throw speed scales with the LMB hold), blastDamage()/
                   explosionVictims()
  protocol.ts      MSG names, message payload types, CreateOptions/RoomMetadata,
                   WeaponMode helpers
  types.ts         Vec3, World, PlayerPose, PlayerPhysState, MoveInput, Block…
  worldgen.ts      generateWorld(seed) / generateCtfWorld(seed) / generateTdWorld(seed) /
                   generateWorldFor(mode, seed)
                   → { world, spawnPoints, dropZone, bases, weaponSpots? }; plateau bounds
  world.ts / noise.ts / rng.ts   voxel storage, 2D noise, seeded RNG
  aabb.ts collision.ts playerPhysics.ts   swept-AABB movement (stepPlayer)
  raycast.ts hitbox.ts gun.ts   voxel DDA, body-part boxes, resolveShot()/resolveRay()
  sword.ts melee.ts drops.ts    swordVictims()/swordDamage(), MELEE_STATS (light/
                                heavy AttackSpec per kind), attackSpec(),
                                dropPool(mode)/pickDropKind()/pickDropSpot()/canPickUp()/
                                autoPickUpAllowed() (empty-slot pickup rule)
  spawn.ts ranking.ts kills.ts  pickSpawn(), rankPlayers()/rankCtf()/splitTeams(), KillTracker/awards
  ctf.ts           FlagState, flagTouch(), canScore(), canReturn(), teamSpawns(), pickTeam(),
                   botRebalance(), matchWinner(), botCtfGoal()
  td.ts            team elimination: roundWinner(), tdWeaponLoadout(), botTdGoal()
  bot.ts           createBot(rng, spawns, opts).compute(world, view, dt);
                   view.goal / view.carrying for CTF (td sets view.goal too); skill profiles
  nav.ts           standable()/nearestStandable()/findPath() grid A* the bots walk by

packages/server/src/
  index.ts         PORT, SIMULATE_LATENCY_MS, listen
  app.ts           createApp(): http server (/health, /rooms) + Colyseus Server
  rooms/schema.ts  RoomState / PlayerSchema / DropSchema / FlagSchema (@colyseus/schema)
  rooms/validate.ts   parse*/sanitize* for every inbound message
  rooms/ArenaRoom.ts  the whole match: join/ready/spawn, poses, shoot/swing/
                      charge/chargeCancel/reload, drops, bots, kills, timer, end,
                      teams + flags (selectTeam/dropFlag/tickFlags)

packages/client/src/
  main.ts          screen router: lobby → game → results; ?offline sandbox
  net.ts           colyseus.js client, NetRoomState view types, listRooms()
  screens/         lobby.ts (create/join UI), game.ts (composes everything +
                   network loop), results.ts
  game/            localPlayer.ts (60 Hz shared physics), remotePlayers.ts +
                   interpolation.ts (100 ms snapshot interp), weapons.ts
                   (client-side weapon state machine: cooldowns, charge, mag),
                   recoil.ts (RecoilController: camera kick + settle-back),
                   minimapModel.ts (minimap line-of-sight/last-seen/coord rules)
  render/          scene, atlas, mesher/worldMesh (per-chunk face culling meshes),
                   humanoid + humanoidAnim, viewmodel, meleeProps, gunProps,
                   dropsView, grenadesView, flagsView, tracers, bloodFx, nametag
  hud/             hud.ts (health/ammo/timer/scoreboard/overlays), killFeed,
                   damageFx, minimap.ts (canvas map + fog of war), icons
                   (inline SVG), style.css
  input/           keyboard.ts, pointerLock.ts

packages/*/test/   vitest; server has a real Colyseus integration test that
                   boots the app on a random port and plays through messages
scripts/smoke.mjs  playwright-core + headless Chrome (swiftshader) e2e
docs/plans/        design plans behind bigger features (e.g. the CTF mode)
```

## Finding your way (context discipline)

- **Map first, search second.** Pick files from the quick map above; open only
  what the task touches. Fall back to repo-wide search when the map doesn't
  answer, and treat that as a sign the map needs a fix.
- **Read narrowly.** Prefer the specific function/section over whole files or
  whole packages; the tests next to a module are the fastest spec for it.
- **Write down what cost you time.** If you had to *discover* something —
  hidden coupling, a non-obvious "why", an environment quirk — record it in
  the same change: gotchas → "Known gotchas", design "why" →
  `docs/ARCHITECTURE.md` or the feature's plan, new/renamed/moved module →
  the quick map. If the next agent would have to re-discover it, it belongs
  in a doc.
- **Keep this file loadable.** These docs are read at the start of every
  session; keep entries one-to-three lines and prune ones that stop being
  true instead of stacking corrections.

## How to work here

- **Tests first** for anything in `shared` and for server rules: add/extend
  the vitest file next to the module, watch it fail, then implement. Server
  behaviour is verified in `packages/server/test/arenaRoom.integration.test.ts`
  by sending real messages and asserting on broadcasts/state.
- **Small, single-purpose modules.** The codebase is ~6k lines; keep it
  readable. New client subsystems get their own file under `render/`, `hud/`
  or `game/`, constructed and disposed from `screens/game.ts`.
- **Every screen/subsystem exposes `dispose()`** and `main.ts`/`game.ts` call
  it. Remove listeners, intervals and three.js objects you added.
- **Sync new per-player facts through the schema**, not through ad-hoc
  messages, when other clients need them continuously (e.g. `charging`,
  `reloading`, `shielded`, `melee`). Use one-shot broadcasts (`MSG.shot`,
  `MSG.hit`, `MSG.kill`, …) for events. Add new fields to both `schema.ts`
  and the `NetPlayer`/`NetRoomState` view types in `client/src/net.ts`.
- **Message hygiene.** New inbound message → `MSG` name in `protocol.ts`, a
  `parseX` in `validate.ts` (with a test), a handler in `ArenaRoom` that goes
  through `actor()`, and `weaponAllowed` if it is weapon-specific.
- **Bigger features start with a plan** in `docs/plans/YYYY-MM-DD-<topic>.md`
  (context, decisions, numbers, file map, verification) and keep it updated
  when the design shifts.
- **README is the spec for numbers.** If you change a damage value, cooldown,
  cone, timer or the drop table, fix `README.md` in the same change.
- **Don't widen scope.** Fix what was asked; mention adjacent problems in the
  summary instead of silently changing them.
- Prefer plain functions and data over classes in `shared`; classes are fine in
  the client where they own three.js resources.

## Known gotchas

- The server runs TypeScript directly via `tsx`; `tsconfig.base.json` must be
  present at runtime (the Dockerfile copies it) or Colyseus `@type` decorators
  break silently.
- Server vitest uses `pool: 'threads'` because the default forks pool chokes on
  Colyseus IPC noise. Don't "fix" that.
- Bots and humans share `MAX_PLAYERS = 16`; the room sets `maxClients = 16 -
  bots`. In CTF bots alternate teams, play offence (`botCtfGoal`) and move
  over on their own to keep the sides within one player of each other; humans
  switch freely.
- Players are not `alive` until they send `MSG.ready` (click to play). Tests
  and bots must account for that (`ready()` helper in the integration test).
- Room registry is in Colyseus in-process memory: production must be a single
  Fly machine (`--ha=false`, `min_machines_running = 0` auto-stop is fine).
- The Fly app is deliberately IPv4-only (IPv6 routing from some ISPs was
  much slower).
- Chrome via the browser extension isn't available in every environment;
  use `npm run smoke` (playwright-core + swiftshader) for headless checks.
