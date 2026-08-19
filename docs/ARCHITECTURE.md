# Mineshoot architecture

How the game is put together and why. Read this before changing networking,
the server room, physics/combat rules or bots. Player-facing rules and numbers
are in [`README.md`](../README.md); the working agreement for contributors and
agents is in [`AGENTS.md`](../AGENTS.md).

## 1. Big picture

```
┌────────────────────────── browser (packages/client) ──────────────────────────┐
│ lobby.ts ──create/join──▶ net.ts (colyseus.js) ◀──state patches / broadcasts──┐│
│ game.ts: LocalPlayer (60 Hz shared physics) → pose @20 Hz ──────────────────▶ ││
│          Weapons (client cooldowns/charge/mag) → shoot/swing/charge(Cancel)/reload ││
│          RemotePlayers (100 ms snapshot interpolation of state.players)       ││
│          three.js scene: worldMesh, humanoids, viewmodel, tracers, blood, drops││
│          Hud: hp/ammo/timer/killfeed/scoreboard/damage fx                     ││
└──────────────────────────────────────────────────────────────────────────────┼┘
                                                                               │ WebSocket
┌────────────────────────── server (packages/server) ───────────────────────────┼┐
│ app.ts: http /health, /rooms  +  Colyseus Server                              ││
│ ArenaRoom: RoomState (players, drops, timer, phase) ◀────────────────────────┘│
│   validate → actor(epoch) → weaponAllowed → resolveShot / swordVictims        │
│   → damage/kill → broadcast shot/hit/kill/swung/pickup                        │
│   bots @20 Hz (shared bot.ts + stepPlayer), drops, respawn, spawn protection  │
└───────────────────────────────────────────────────────────────────────────────┘
                     ▲ both import the same pure functions ▲
┌────────────────────────── packages/shared (no deps) ──────────────────────────┐
│ constants · protocol · worldgen(seed) · playerPhysics/collision · raycast     │
│ hitbox/gun · sword/melee/drops · spawn · ranking · kills · bot                 │
└───────────────────────────────────────────────────────────────────────────────┘
```

Three design decisions drive everything else:

1. **One shared, pure game core.** Every rule that both sides must agree on is
   a dependency-free function in `packages/shared`, exercised by unit tests,
   and imported by both the Vite bundle and the Node server. There is no
   second implementation of movement, raycasting or damage anywhere.
2. **Split authority.** The client owns its own *movement* (responsive, no
   prediction/rollback needed); the server owns *combat and match state*.
   Cheating on position is possible but the game is for friends; cheating on
   damage is not possible because the server re-simulates every attack.
3. **Nothing to load.** The world is generated from a seed on both ends, the
   texture atlas is painted on a canvas, players are boxes. A room is playable
   the instant the WebSocket handshake finishes.

## 2. Packages

### `packages/shared`

Pure TypeScript, `"exports": "./src/index.ts"` (consumed as source by Vite and
`tsx`; there is no build step). Grouped by concern:

| Area | Files | Key exports |
| --- | --- | --- |
| Tunables | `constants.ts` | every number: world size, movement, weapon timings, damage, hitbox bands, HP, respawn, spawn protection, durations, `MAX_PLAYERS`, `MAX_BOTS` |
| Protocol | `protocol.ts` | `MSG` names, payload interfaces (`PoseMsg`, `ShootMsg`, `SwingMsg`, `ShotMsg`, `HitMsg`, `KillMsg`, `PickupMsg`, …), `CreateOptions`, `RoomMetadata`, `WeaponMode` + `weaponAllowed()/defaultWeapon()/allowedWeapons()`, `ROOM_NAME` |
| Data | `types.ts`, `world.ts`, `rng.ts`, `noise.ts` | `World` (flat `Uint8Array` of `Block`), `PlayerPhysState`, `MoveInput`, `Vec3`; `createRng(seed)` (mulberry-style), 2D value noise |
| World | `worldgen.ts` | `generateWorld(seed)` (arena) and `generateCtfWorld(seed)` (96×48 CTF map) → `{ world, spawnPoints, dropZone, bases }`; `generateWorldFor(mode, seed)`; `PLATEAU_MIN/MAX` |
| Physics | `aabb.ts`, `collision.ts`, `playerPhysics.ts` | `moveAABB` (axis-separated swept AABB vs voxels), `stepPlayer(world, state, input, dt)`, `forwardVector` |
| Hitscan | `raycast.ts`, `hitbox.ts`, `gun.ts` | `raycastVoxels` (DDA), `segmentVsAABB`, `playerHitboxes(feet)` (legs/torso/head boxes), `resolveShot(world, shooter, targets, range)` |
| Melee | `sword.ts`, `melee.ts`, `drops.ts` | `MELEE_STATS` per `MeleeKind` → `attacks[AttackKind]` (`AttackSpec`: cone, reach, damage, sweep, cooldown, anim), `meleeStats()`, `attackSpec()`, `swordVictims(world, pose, targets, attack, kind)`, `swordDamage()`, `pickDropKind()`, `pickDropSpot()`, `canPickUp()`, drop cadence constants |
| Match | `spawn.ts`, `ranking.ts`, `kills.ts` | `pickSpawn(points, enemies, rng)` (farthest-from-enemies with randomness), `rankPlayers`, `rankCtf`, `kdRatio`, `KillTracker` (multi-kill / streak / shutdown awards) |
| CTF | `ctf.ts` | `FlagState`, `flagTouch()`, `canScore()`, `canReturn()`, `carriedFlag()`, `teamSpawns()`, `pickTeam()`, `botRebalance()`, `matchWinner()`, `botCtfGoal()` (offence-first bot goal); teams (`TEAM_RED/BLUE`, `Team`, `otherTeam`, `teamName`) live in `protocol.ts` |
| Bots | `bot.ts` | `createBot(rng, waypoints, { weapons, passive, skill })` → `{ compute(world, view, dt), reset() }`; `passive` = training dummy (faces the nearest enemy, never moves or attacks); `skill` (`BotSkill` in `protocol.ts`, profiles via `botSkillProfile()`) scales sight / turn rate / reaction / aim error / attack interval; `view.goal` / `view.carrying` drive CTF behaviour. Movement toward any destination goes through `nav.ts` |
| Navigation | `nav.ts` | `standable()`, `nearestStandable(world, x, y, z)`, `findPath(world, from, to)` (A* over standable cells: step up 1 with a jump, drop ≤ `MAX_DROP`, diagonals only with both orthogonal cells free), `cellCentre()`; the bot re-plans every 1.5 s, when its destination moves 2 blocks or when it strays 3 blocks off the route |

Rules for this package: no `Math.random()` (thread an `rng`), no DOM, no
three.js, no Colyseus, plain objects in and out, a test file per module.

### `packages/server`

- `index.ts` — reads `PORT` (default 2567) and `SIMULATE_LATENCY_MS`, listens.
- `app.ts` — `createApp()` builds a plain `http.Server` that answers
  `GET /health` (`ok`) and `GET /rooms` (JSON list of unlocked `arena` rooms
  with metadata; CORS `*`), then mounts Colyseus' `WebSocketTransport` on it.
  Nagle is disabled per socket (20 Hz small packets). Tests call `createApp`
  on a random port.
- `rooms/schema.ts` — `@colyseus/schema` classes: `RoomState { phase, name,
  seed, durationMin, weapons, timeLeftMs, players: Map<PlayerSchema>, drops:
  Map<DropSchema> }`; `PlayerSchema { name, x,y,z, yaw,pitch, alive, hp,
  kills, deaths, spawnEpoch, weapon, melee, color, isBot, shielded, charging,
  reloading }`; `DropSchema { kind, x,y,z }`. This is the *only* continuously
  synced data.
- `rooms/validate.ts` — `parsePose/parseShoot/parseSwing/parseCharge/
  parseReload/parseDurationMin/parseBotCount/parseBotSkill/parseWeaponMode`,
  `sanitizeName/sanitizeRoomName`. Everything inbound goes through here and
  invalid input is dropped, never thrown.
- `rooms/ArenaRoom.ts` — the match (see §4).

### `packages/client`

- `main.ts` — tiny screen router: `lobby → game → results → lobby`; each
  screen returns `{ dispose() }`. `?offline` boots the game screen with
  `room = null` (sandbox), `?seed=` picks the world.
- `net.ts` — `WS_URL` from `VITE_SERVER_URL` (build-time), `HTTP_URL` derived
  from it; `listRooms()` (fetch), `createRoom()`, `joinRoom()` (both wait until
  the first state patch contains our own player), structural `NetRoomState` /
  `NetPlayer` view types over the reflected schema, friendly error mapping.
- `screens/lobby.ts` — nickname, create form (name / duration / bots /
  weapons), polled room list, join.
- `screens/game.ts` — composes everything below, owns the network loop
  (pose interval, ping, message handlers, state patch handler) and the render
  loop; hands off to results when `state.phase === 'ended'`.
- `game/localPlayer.ts` — fixed-step 60 Hz `stepPlayer` with an accumulator;
  camera at eye height; frozen while dead.
- `game/weapons.ts` — client-side weapon state machine: selection, gun
  cooldown/auto-fire/magazine/reload; melee light (LMB, repeats every
  cooldown while held) and heavy (RMB held = charge; release swings once
  ≥ `MELEE_MIN_CHARGE_FRACTION` of `chargeMs` is held — the server scales
  damage by `chargeFraction`, full at `chargeMs` — a shorter tap cancels,
  auto-release past `chargeMaxMs`; LMB is ignored while charging); each
  attack's own `cooldownMs` gates the next;
  per-`MeleeKind` timings.
- `game/remotePlayers.ts` + `game/interpolation.ts` — a `SnapshotBuffer` per
  remote player, rendered `INTERP_DELAY_MS` (100 ms) in the past with
  shortest-arc yaw interpolation; drives `Humanoid` + `humanoidAnim`, nametags,
  charging/reloading/shielded visuals; a `spawnEpoch` change teleports instead
  of lerping.
- `render/*` — `scene.ts` (renderer, camera, lights, sky), `atlas.ts`
  (canvas-painted 8×1 tile atlas), `mesher.ts`/`worldMesh.ts` (per-region face
  culled meshes with per-face shading), `humanoid.ts` (box body, colour per
  player), `humanoidAnim.ts` (walk cycle, swing, charge, reload poses),
  `viewmodel.ts` (first-person gun / melee, fire and swing animation),
  `meleeProps.ts` (geometry for sword/axe/katana/scythe/pickaxe),
  `dropsView.ts` (glowing columns for `state.drops`), `tracers.ts` (gun
  lines), `bloodFx.ts`/`bloodParams.ts` (voxel particle spray), `nametag.ts`.
- `hud/*` — DOM overlay: `hud.ts` (health, ammo, timer, weapon slots, room
  rules, click-to-play / dead / spawn-protection overlays, Tab scoreboard),
  `killFeed.ts`, `damageFx.ts` (vignette + floating `-N`), `icons.ts` (inline
  SVG weapon/award icons), `style.css`.
- `input/*` — `keyboard.ts` (WASD/Space/R/1/2/Tab), `pointerLock.ts` (yaw/
  pitch, mouse buttons, wheel, lock/unlock events).

## 3. Networking model

### Transport and state

Colyseus 0.16 over WebSocket. Continuous facts travel in the **room state**
(schema patches, delta-encoded by Colyseus): positions, HP, kills, flags,
drops, timer. Discrete events travel as **broadcast messages** so every client
can play a one-shot effect exactly once.

| Direction | Message | Payload | Purpose |
| --- | --- | --- | --- |
| C→S | `pose` | `PoseMsg {x,y,z,yaw,pitch,epoch,weapon}` @ 20 Hz | Movement + current weapon slot |
| C→S | `ready` | – | "Click to play": spawn me |
| C→S | `selectMelee` | `SelectMeleeMsg {epoch, melee}` | Training range only: put this melee weapon in slot 2 now |
| C→S | `shoot` | `ShootMsg` (pose + epoch) | Fire the gun from this pose |
| C→S | `charge` | `epoch` | Started holding RMB with melee (charge) |
| C→S | `chargeCancel` | `epoch` | RMB let go before the heavy could swing (no swing) |
| C→S | `swing` | `SwingMsg` (pose + `attack`) | Melee attack: light / heavy |
| C→S | `reload` | `epoch` | Started a gun reload |
| C→S | `ping` / S→C `pong` | `number` | RTT display |
| S→C | `shot` | `ShotMsg {shooterId, from, to, hitPlayerId, part, damage}` | Tracer + hit feedback for everyone |
| S→C | `swung` | `SwungMsg {attackerId, attack, melee}` | Animate the attacker on other clients |
| S→C | `hit` | `HitMsg {attackerId, victimId, part, damage, attack, melee}` | Melee connected |
| S→C | `kill` | `KillMsg {killer*, victim*, weapon, melee, headshot, awards…}` | Kill feed, awards |
| S→C | `pickup` | `PickupMsg {playerId, melee}` | Someone took a drop |

Room creation options (`CreateOptions`): `name`, `durationMin` (3/5/10/15),
`nickname`, `bots` (0–15), `botSkill` (`'easy'|'normal'|'hard'`), `weapons` (`'all'|'gun'|'sword'`), `mode`
(`'match'|'training'`); plus `testOverrides` honoured only when
`MINESHOOT_TEST=1`. Room metadata (`RoomMetadata`) mirrors these for the lobby
list. `meleeSelectable(mode, weapons)` (protocol.ts) is the single rule for
"may pick a melee weapon directly": training mode and melee allowed.

### Movement (client-authoritative)

Each client runs `stepPlayer` at a fixed 60 Hz for itself and sends its pose
20 times a second. The server copies the pose into `PlayerSchema` (after
`parsePose` and the epoch check) and Colyseus fans it out. Other clients
buffer samples and render 100 ms behind (`SnapshotBuffer`), which hides jitter
at typical LAN/regional latency without extrapolation.

There is no reconciliation because the server never moves a living player —
except on (re)spawn, when it writes a new position and bumps `spawnEpoch`; the
owning client detects the epoch change and teleports (`LocalPlayer.teleport`).

### Combat (server-authoritative)

`ArenaRoom` treats the attacker's own message pose as the shooter position
(they are authoritative for it anyway) and the last-known state poses of
everyone else as targets, filtered by `targetable()` (alive and not spawn-
protected). Then:

- **Gun** — `resolveShot()`: ray from eye along yaw/pitch, `raycastVoxels`
  vs `segmentVsAABB` against each target's three body boxes; nearest wins;
  damage from `GUN_DAMAGE[part]`. Server rate-limits by
  `GUN_SERVER_MIN_INTERVAL_MS`, and keeps the magazine (`takeRound`) so an
  empty client cannot fire.
- **Melee** — `swordVictims()`: candidates within the attack's `range` and
  inside its half-angle cone, line-of-sight checked with `raycastVoxels`,
  head vs body decided by the aim ray; sweeping attacks hit everyone in the
  cone, others only the nearest.
  The attack comes from `SwingMsg.attack`; a heavy is only honoured if a
  `charge` message arrived ≥ `chargeMs` earlier for the same epoch (else it
  lands as light). The previous attack's `serverMinIntervalMs` gates the next.
- **Result** — `damage()` lowers HP; at 0 → `kill()` marks the victim dead,
  updates kills/deaths, records awards via `KillTracker`, schedules respawn,
  broadcasts `kill`. Every attack (hit or miss) also broadcasts `shot` or
  `swung` so other clients animate.

The client *predicts* only cosmetics (view-model kick, local tracer in offline
mode); it waits for `shot`/`hit` for anything that implies damage.

### Guards on every inbound gameplay message

1. `validate.ts` shape/range check.
2. `actor(client, epoch)`: room is `playing`, player exists, `alive`, and
   `spawnEpoch` matches (drops messages from a dead body or a client that has
   not clicked to play).
3. `weaponAllowed(mode, weapon)` for weapon-specific messages.
4. Server-side cooldown / magazine / charge bookkeeping in `PlayerMeta`
   (private per-player state that is *not* synced).

## 4. Room lifecycle (`ArenaRoom`)

```
onCreate(opts)
  ├ sanitize name/duration/bots/botSkill/weapons/mode(/captureLimit); maxClients = MAX_PLAYERS(16) - bots
  ├ respawnMs = respawnMsFor(mode) (3 s match / 1 s training / 5 s ctf); training bots are passive
  ├ mode 'ctf': faster drops, two FlagSchema entries at gen.bases, captureLimit
  ├ seed = hash(roomId:now); generateWorldFor(mode, seed) → world, spawnPoints, dropZone, bases
  ├ setMetadata({name, durationMin, endsAt, bots, botSkill, weapons, mode, captureLimit?, teams?})   ← lobby list
  ├ onMessage handlers (pose/shoot/swing/charge/chargeCancel/reload/ready/selectMelee/selectTeam/dropFlag/ping)
  ├ clock: tickLifecycle every 50 ms, tickTimer every 1 s
  └ addBot()×N; setSimulationInterval(pumpBots, 50 ms) if bots > 0

onJoin(client, {nickname, team?})
  └ PlayerSchema parked at a spawn, alive=false, meta.ready=false
     (camera previews the arena; nobody can hit them)
     ctf: team = requested or the smaller one; colour = team colour; bots rebalance

'ready' → spawn(): pick spawn far from enemies, hp=100, weapon=default,
          melee=sword, shielded for SPAWN_PROTECT_MS, spawnEpoch++
          (training dummies spawn on the central plateau via pickDropSpot)
'selectMelee' → training range only (meleeSelectable): p.melee = kind,
          pending charge dropped; the client sees it through the state patch

'selectTeam' → ctf only: switch sides (drop flag, die without a death, respawn
          on the new side; unspawned players are re-parked), then botRebalance
'dropFlag' → ctf only, actor(): put the carried flag down (dropper may not
          re-take it for FLAG_DROP_GRACE_MS)

tickLifecycle (50 ms): respawn dead ready players when respawnAt passes,
          clear expired shields, mirror charging/reloading flags, tickDrops(),
          tickFlags()
tickTimer  (1 s):   timeLeftMs; at 0 → endMatch()
endMatch:  phase='ended', lock() (hidden from /rooms), disconnect() after
           ENDED_LINGER_MS (15 s) so clients can show results

onLeave: remove player + meta + kill-tracker entry
```

**Bots** are `PlayerSchema` entries with `isBot=true` and no client. Each has
a `Bot` brain (shared) and a `PlayerPhysState` body. `pumpBots` accumulates
real elapsed time and runs `tickBots` in fixed 50 ms steps: build a `BotView`
(self + targetable enemies), `brain.compute()` → `{input, yaw, pitch, weapon,
shoot, swing}`, integrate with `stepPlayer` in 60 Hz substeps, write the pose
into the schema, then call the *same* `attackShoot`/`attackSwing` code path a
human message would. Bots therefore obey rate limits, magazines, spawn
protection and weapon mode automatically. In a training room the brain is
`passive`: it returns no input and never shoots/swings, only turns toward the
nearest visible enemy, so dummies are living targets that hit back with nothing.

**Drops** (`tickDrops`): only when melee is allowed. Every 25–45 s (seeded
rng; 12–22 s in CTF) place a random `MeleeKind` inside the map's `dropZone`
(the arena plateau, the CTF ridge) away from other drops and spawn points
(`pickDropSpot`), cap `DROP_MAX_ACTIVE` (5 in CTF), expire after
`DROP_LIFETIME_MS`. Any living player whose feet are within the pickup radius
(`canPickUp`) takes it: `p.melee = kind`, drop removed, `pickup` broadcast.
Death resets `melee` to the sword.

**Capture the flag** (`mode: 'ctf'`, rules in `shared/ctf.ts`, all numbers in
`constants.ts`). The room plays on `generateCtfWorld` (96×48, mirrored across
the middle: a raised fort with parapet/gate/flank stairs at each end on the
z-centre line, a central plateau with four ramps, rolling side lanes with
mirrored watchtowers and cover; the straight line between the flag stands is
always walkable so bots' steer-and-hop pathing works). State:
`PlayerSchema.team/captures`, `RoomState.flags` (`FlagSchema` per team:
`status home|carried|dropped`, position, `carrierId`), `redScore/blueScore`,
`captureLimit`. Flag state machine, run by `tickFlags` every 50 ms:

```
home ──enemy touch (canPickUp)──▶ carried ──carrier dies / leaves / G──▶ dropped
  ▲                                  │  x/y/z follow the carrier                │
  │                                  │  enemy carrier: canScore() inside own    │ any touch → carried
  │                                  │  base zone (CTF_BASE_ZONE_RADIUS) &&      │ (one flag per player)
  │                                  │  own flag home → captured (score++)       │ FLAG_RETURN_MS → home
  │                                  │  owner carrier: canReturn() inside own    │
  └────────────── returned ──────────┘  base zone → home                         │
```

The owning team does not return its flag by touching it: they pick it up
(`flagTouch` → `pickup`, same carry rules) and walk it into their base zone.

Server rules that must stay server-side: no friendly fire (`targetsExcluding`
and the bots' enemy list skip teammates), a carrier's `shoot` is dropped
(`attackShoot`), spawns come from `teamSpawns()` (the spawn points nearest the
own base) with only enemy positions as "enemies", team switching is always
allowed for humans and bots even the sides out (`botRebalance`), the capture
limit calls `endMatch()`. Every transition broadcasts `MSG.flag`
(`FlagEventMsg {kind, team, playerId, playerName, redScore, blueScore}`) for
the feed. The client only *reflects* this: `FlagsView` draws each flag at the
synced position (carried flags ride on the carrier's rendered body, never on
the local player's own back), the carrier's `Weapons` is locked to melee and
walks at `FLAG_CARRY_SPEED_SCALE`, `G` sends `dropFlag`, the overlay offers
team buttons (`selectTeam`), the HUD shows the score bar, and the results
screen shows Victory/Defeat/Draw for the local player's team (`ctfOutcome`,
from `matchWinner`) over one ranked table per team (`splitTeams`).

**CTF bots**: `tickBots` adds `goal` (`botCtfGoal(team, id, self, flags,
bases)`: offence first — the enemy flag wherever it is, escort a teammate who
carries it, pick up the own flag if it lies closer, chase the enemy carrying
the own flag within `BOT_CHASE_RADIUS`, carriers of either flag → home; once
the team holds the enemy flag but the own flag is away, non-carriers → the
own flag wherever it is) and `carrying` to the
`BotView`; the brain walks to the goal when no enemy is in sight, patrols
nearby waypoints once there, and as a carrier runs for the goal melee-out,
only swinging at enemies within reach. Teams alternate (bot1 red, bot2 blue, …).

## 5. Client frame

`screens/game.ts` per animation frame:

1. `LocalPlayer.update(dt)` — accumulate, run `stepPlayer` substeps, place
   camera (skipped while dead / not yet ready).
2. `Weapons.update(now)` — auto-fire, charge auto-release, reload completion;
   fires the `WeaponEvents` callbacks that send `shoot/charge/swing/reload`.
3. `RemotePlayers.update(now)` — sample each buffer at `now - 100 ms`, pose
   humanoids, animate.
4. Effects: `Tracers`, `BloodFx`, `DropsView`, `ViewModel`, HUD timers.
5. `renderer.render(scene, camera)`.

Independent of frames: a `setInterval` sends `pose` every 50 ms, another sends
`ping` every 2 s. `room.onStateChange` (patches) drives: our own
`spawnEpoch` (teleport, reset weapons/ammo, clear death overlay), `alive`/`hp`
(death overlay, health bar), `phase` (results), and remote add/remove.

Screen switches call `dispose()` on the previous screen, which removes DOM,
intervals, message handlers, pointer lock listeners and three.js resources.

## 6. World and rendering

- `generateWorld(seed)`: 64×24×64 blocks. Value-noise heightmap (3..9), a
  raised brick-edged plateau in the middle (`PLATEAU_MIN..MAX`, top at y=9),
  a bedrock/stone border wall, random plank pillars, brick walls, elevated
  platforms and trees (all skipping the plateau), then 12 well-spread spawn
  points with standing room. Deterministic per seed, so the client builds the
  identical world from `state.seed`.
- Meshing: the world is cut into 16-block regions; for each solid block only
  faces adjacent to air are emitted, with a per-face shade factor and a UV
  into the canvas atlas (grass top/side, dirt, stone, planks, brick, bedrock,
  leaves…). One `Mesh` per region, one shared material.
- Players: `Humanoid` = head/torso/arms/legs boxes tinted by `color`;
  `humanoidAnim` poses limbs from speed, weapon, charging, reloading and swing
  events; melee props from `meleeProps.ts` are attached to the hand.
- Hitboxes used by the server (`hitbox.ts`) match the humanoid proportions:
  legs 0–0.7, torso 0.7–1.35, head 1.35–1.8 with a narrower half-width.

## 7. Deployment

```
Cloudflare Pages (static, project "mineshoot")     Fly.io app mineshoot-server-prd (sin)
  packages/client/dist                              Dockerfile: node:22-slim, tsx, port 8080
  VITE_SERVER_URL=wss://mineshoot-server-prd.fly.dev  /health for checks, auto-stop, 1 machine
```

- `make deploy-fe` builds with the prod WS URL and runs `wrangler pages
  deploy`. `make deploy-be` runs `fly deploy --ha=false` from the repo root
  (build context must include `packages/shared` and `tsconfig.base.json`).
- The room registry is Colyseus in-memory (`matchMaker.query`); with more
  than one machine the lobby would only see rooms on the machine it hit, so
  production is pinned to a single machine. `min_machines_running = 0` lets
  Fly stop it when idle; the first visitor pays a cold start.
- The Fly app is IPv4-only on purpose (measured IPv6 routing from some
  Vietnamese ISPs was ~4× slower).

## 8. Testing strategy

| Layer | Tool | What it proves |
| --- | --- | --- |
| `shared` unit tests | vitest | every rule in isolation: worldgen determinism & spawn validity, collision, raycast, gun/sword/melee damage & cones, drops placement/pickup, spawn picking, ranking, kill awards, bot decisions |
| `server` integration | vitest (`pool: threads`) + real `colyseus.js` clients against `createApp()` on a random port | join/ready/spawn, pose sync, shots hit/miss with real geometry, magazine + reload, sword light/charged, weapon modes, spawn protection, drops, bots, timer → ended → locked, `/rooms` listing |
| `client` unit | vitest (node env) | pure client logic: interpolation buffer, weapon state machine, mesher output, humanoid anim maths, HUD icons/kill feed formatting, damage/blood params |
| Smoke | `scripts/smoke.mjs`: playwright-core + real headless Chrome (swiftshader GL) | the whole thing end-to-end in two browser tabs: lobby → create → join → kill → respawn → sword kill → results, then a bot room with a drop pickup; fails on any console error |

`MINESHOOT_TEST=1` unlocks `testOverrides` (short match, instant respawn,
fast drops) for the integration and smoke tests; production ignores them.

## 9. Extending the game — checklists

**New tunable** → add to `constants.ts` (or `melee.ts`/`bot.ts`), use it on
both sides, update the README table.

**New weapon (melee kind)** → `MELEE_STATS` entry in `melee.ts` with its
light / heavy `AttackSpec`s (+ test), `pickDropKind` weights, geometry in
`client/render/meleeProps.ts`, icon in `hud/icons.ts`, README table row.
Server and bots need nothing else. A blow that needs a new motion → add a
`SwingAnim` value and curves in `viewmodel.ts` + `humanoidAnim.ts` (+ test).

**New per-player synced fact** → field in `PlayerSchema`, mirror in
`NetPlayer` (`client/net.ts`), set it in `ArenaRoom` (`syncFlags` if it is a
timer-derived flag), read it in `RemotePlayers`/`Hud`.

**New inbound message** → `MSG` + payload type in `protocol.ts`, `parseX` in
`validate.ts` (+ test), `onMessage` handler in `ArenaRoom` using `actor()` and
`weaponAllowed`, sender in `screens/game.ts`, integration test.

**New room option** → `CreateOptions` + `RoomMetadata` in `protocol.ts`,
parser in `validate.ts`, `onCreate` + `syncMetadata`, lobby form + list badge,
README.

**New map / room mode** → a generator in `worldgen.ts` returning
`GeneratedWorld` (world, spawn points, `dropZone`, `bases`), wired through
`generateWorldFor(mode, seed)` (server `onCreate`, client `screens/game.ts`),
+ a `worldgen.test.ts` block; never read `WORLD_SX/SZ` outside `worldgen.ts`
— use `world.sx/sz` (poses are clamped to the room's world in `parsePose`).
