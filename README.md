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
  first-person view models for every gun, the grenade and every melee weapon.
- HUD with health, ammo, timer, kill feed, crosshair, damage vignette,
  floating damage numbers, voxel blood spray, and a Tab scoreboard.
- Minimap in the top-left corner: your team and your own flag are always on it,
  while enemies only appear where you or a team-mate has line of sight, and a
  stolen enemy flag leaves a dimmed last-seen marker behind.
- **Zero shipped assets**: the block texture atlas is painted onto a canvas at
  boot, everything else is geometry. No images, no audio in the repo.

## How to play

1. Open the demo (or your local build), enter a nickname.
2. **Create room** — pick a name, duration (3/5/10/15 min), the **room
   type** (Deathmatch, Training range, Capture the Flag or Team Elimination),
   how many **AI bots** (0–15) and how sharp they are (**Easy / Normal /
   Hard**), and the **allowed weapons** (Guns + Sword, Sword only); a CTF room
   also picks the captures needed to win (3/5/10), a Team Elimination room the
   round wins needed (3/**5**/7/10 — no duration, rounds have no clock). Or
   **Join** an existing room from the public list — team rooms (CTF and Team
   Elimination) offer **Red / Blue / Auto** buttons so you can pick a side.
3. **Click to play.** You are not in the arena until you click; nobody can
   hit you while you are still reading the overlay.
4. Fight until the timer runs out. Rankings (kills, deaths, K/D) are shown at
   the end; the room closes shortly after.

| Input | Action |
| --- | --- |
| Mouse | Aim (click to lock the pointer, `Esc` to release) |
| `W A S D` / `Space` | Move / jump |
| `Ctrl` / `C` (hold) | Crouch: half speed, eye drops to 1.02 m and your hitbox shrinks to 1.2 m, so low cover actually covers you (`C` because Chrome eats `Ctrl`+`W`) |
| `LMB` (tap or hold) | Shoot (pistol: one per click; rifle/SMG/M249 keep firing while held) · hold to wind up a grenade throw, release to throw · **light** melee slash — keeps swinging while held, alternating left / right |
| `RMB` hold, release | **Heavy** melee blow — each weapon's own signature move (overhead, execute, iaido, reap, head-hunt); full damage once fully charged, proportional if you let go earlier · with the sniper: hold to look through the **scope** |
| `R` | Reload the held gun (automatic when the magazine is empty) |
| `1`–`5` / mouse wheel | Switch primary gun / pistol / melee / grenade / taser (empty slots are skipped) |
| `G` | Throw the held weapon away (frees the slot so you can pick one up off the ground) · Capture the Flag: put the flag you carry down (hand it to a teammate) |
| `Tab` (hold) | Scoreboard |
| `LMB` / `RMB` while dead | Watch the next / previous player's own first-person view (team modes: teammates only) |

Up to **16 players** per room (bots take player slots). Rooms are public and
listed in the lobby; there is no password — it's meant to be casual.

## Gameplay

Everyone has **100 HP** and respawns **3 s** after dying with **2 s of spawn
protection** (you cannot be targeted or damaged; attacking ends it early).
While you wait, the camera moves into another player's head after **1.5 s** —
a teammate in Capture the Flag and Team Elimination, anyone alive in a
deathmatch — and `LMB` / `RMB` cycle through them.

Holding `Ctrl` or `C` **crouches**: you move at **half speed**, your eye drops
from 1.62 m to **1.02 m** and your whole hitbox squashes from 1.8 m to
**1.2 m** — head, torso and leg bands all shrink with it, so a shot lined up on
a standing head sails over a crouching one. Your collision box stays full
height, so crouching will not squeeze you through gaps.

Damage depends on where you hit:

Everyone carries **five weapon slots**: `1` a **primary gun**, `2` the
**pistol**, `3` the melee weapon, `4` **grenades** (2 at spawn, at most 4),
`5` the **taser** (empty until you pick one up). In a **deathmatch** every
(re)spawn rolls a random primary; in every other mode the primary slot starts
empty and is filled from drops.

- **Pistol** — instant hitscan, one shot per click, 10-round magazine,
  unlimited reloads. Head 100 / torso 30 / legs 15.
- **Primary guns** — all hitscan, each with its own magazine, cooldown and
  reload; picked up from drops into an **empty** slot `1` and lost on death
  (throw the one you hold away with `G` to take another). In a **deathmatch**
  every (re)spawn also rolls a **random
  primary** (rifle / SMG / shotgun / sniper / M249 — never the taser) and you come
  back holding it; CTF keeps the pistol-only spawn, Team Elimination spawns
  blade-only (even the pistol comes off the ground), and the training range
  lets you pick your own.

  | Gun | Mag | Cooldown | Reload | Range | Dmg head/torso/legs | Twist |
  | --- | --- | --- | --- | --- | --- | --- |
  | Rifle | 25 | 150 ms | 2.0 s | 60 | 70 / 25 / 12 | full-auto, slight spread (1.5°); spray climbs ~1.3°/shot then S-drifts right, then left |
  | SMG | 35 | 80 ms | 1.8 s | 40 | 40 / 15 / 8 | full-auto, wide spread (3°); soft ~0.7°/shot climb with a gentle zigzag |
  | Shotgun | 6 | 400 ms | 450 ms **per shell** | 18 | 45 / 25 / 12 **per pellet** | 8 pellets in a 6° cone — one-shots up close, useless far; 3° kick per shot; reloads shell by shell (the ammo counter climbs as shells go in) and **fires straight out of the reload** once a shell is in |
  | Sniper | 4 | 1.2 s | 2.8 s | 60 | 100 / 100 / 60 | `RMB` opens the round scope (×3), even mid-reload; mouse sensitivity drops ×3 while scoped; no crosshair from the hip; body shots kill; 4° kick per shot |
  | M249 | 75 | 100 ms | 4.5 s | 55 | 45 / 18 / 9 | full-auto belt-fed, wide spread (2.5°); harsh ~1.2°/shot climb that wanders left-right and never settles; the huge belt is paid for by the longest reload in the game |

  **Recoil** — every shot kicks the camera along a **fixed per-gun pattern**
  (the pistol nudges 1° up; the taser doesn't kick), so the spray is
  learnable: pull the mouse against the pattern to keep a burst on target.
  Heavy single-shot kicks (sniper 120 ms, shotgun 70 ms) ramp up as a smooth
  motion instead of snapping. The part you didn't compensate settles back to
  your original aim shortly after you stop firing (25°/s, starting after
  max(300 ms, 2 × cooldown) for full-autos, after 300 ms for everything else).
  Recoil moves your real aim — the next bullet goes where the kick put you.

- **Taser** (slot `5`, from drops) — 2 charges, no reload, range 5, kills in
  one hit anywhere; **the weapon vanishes after its second shot**. It has its
  own slot, so it never costs you your primary gun.

- **Grenades** — **hold `LMB` to wind up and release to throw**: a tap lobs
  short (speed 10), a full **0.9 s** hold throws hard (speed 24), and you can
  hold as long as you like — switching weapons while holding puts the grenade
  back unthrown. They fly ballistically, bounce off blocks and burst after a
  **2.5 s** fuse: 100 damage at the centre falling linearly to 30 at the
  **5-block** edge; walls block the blast, and your own grenade hurts you too
  (no blocks are destroyed). Spawn with 2, carry at most 4; `Grenades ×2`
  drops refill.
- **Sword** — short-range melee. `LMB` is a quick light slash (head 45 / body
  30, hits the nearest target in a 56° cone); hold it to keep slashing every
  0.5 s, left and right in turn. Hold `RMB` to charge (you walk 30 % slower)
  and release 0.8 s later for the full **heavy** overhead (head 100 / body 70,
  narrower 40° cone but sweeps everyone in it). Letting go earlier still swings
  the heavy at damage in proportion to how long you held (half the charge →
  50 / 35), so a full charge is always worth much more; a tap shorter than a
  quarter of the charge just cancels. Holding longer than 2 s releases it by
  itself. `LMB` does nothing while you charge.

### Weapon drops

**Weapon drops** land on the central plateau every 25–45 s (at most 3 on the
ground, gone after 60 s if nobody takes them; a CTF room drops on its central
plateau every 12–22 s, up to 5). What drops follows the room's weapon rule:
**Guns + Sword** rooms draw from the full pool — the five **primaries**, the
**taser**, **grenade packs** (+2, skipped while you are full) and the four
blades below; **Sword only** rooms drop blades alone. Walking over a drop only
fills an **empty** slot: a gun arms an empty slot `1`, a blade replaces the
plain sword — if the slot is taken, press **`G`** to throw the held weapon
away first (it lies where you stand for **5 s**, then vanishes; you cannot
take your own throw back for 1.5 s, everyone else can grab it right away).
Everything picked up is lost on death. Bots pick drops up too. Every blade beats the sword
somewhere and pays for it somewhere else:

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

A room can be created with 0–15 bots. They run entirely on the server using
the same shared physics and combat rules as humans: wander between spawn
points, hunt the nearest enemy in line of sight, keep mid-range while strafing,
aim with a reaction delay and distance-scaled error, shoot whatever gun they hold (closing to point-blank with a shotgun or taser) and switch
to melee up close. They find their way with a grid pathfinder (up ramps and
stairs one block at a time, down drops of up to 4 blocks, never through
corners), so they climb the plateau via its ramps instead of hopping at the
wall. They die, respawn and rank like everyone else and show a 🤖 in nametags
and the scoreboard.

The room's **bot skill** sets how dangerous they are (rooms with non-default
bots show 🤖 easy / 🤖 hard in the lobby list):

| Skill | Sees you within | Reaction | Aim jitter (rad per block) | Fires at most every |
| --- | --- | --- | --- | --- |
| Easy | 30 blocks | 900 ms | 0.02 | 700 ms |
| Normal (default) | 39 blocks | 600 ms | 0.01 | 350 ms |
| Hard | 45 blocks | 450 ms | 0.004 | weapon cooldown |

Easy bots also turn slower (3 rad/s vs 4 / 4.5). Training dummies ignore the
skill setting.

### Training range

Create a room as a **Training range** (🎯 in the lobby list) to try every
weapon in peace. Same arena and rules as a match, except:

- Bots are **passive dummies**: they stand on the central plateau (spaced out
  like drops), turn to face you, never attack, and everyone respawns after
  **1 s** instead of 3 s so the range refills at once. Pick 0–15 of them; the
  lobby fills in 3 when you leave the count at zero.
- Keys **`6`–`0`** put any melee weapon straight into slot 3 — Sword, Battle
  Axe, Katana, Scythe, Pickaxe — and keys **`Z X C V N`** put any primary gun
  straight into slot 1 (Rifle, SMG, Shotgun, Sniper, M249) with **`B`** arming the
  taser in slot 5 — no drop needed (drops still fall too). Outside a training
  range those keys do nothing; drops remain the only way to a better weapon
  (except the deathmatch spawn roll).
- The guns, magazines, grenades, spawn protection, timer, kill feed and
  scoreboard work as usual, so a training range with friends is a fine warm-up.

The offline sandbox (`?offline`) also honours keys `6`–`0` and `Z X C V B`.

### Capture the Flag

Create a room as **Capture the Flag** (🚩 in the lobby list) for two-team
play on a **dedicated 96×48 map**, mirrored so both teams get the same ground:
a raised **fort** with the flag stand at each end (red west, blue east — a
parapet, a gate on the field side and a stair on each flank), a **central
plateau** with a ramp on every side as the contested high ground, and rolling
side lanes with mirrored watchtowers, walls, pillars and trees for cover. The
straight line between the flag stands (gate → ground → plateau → gate) is
always walkable.

- **Teams.** Pick Red / Blue when joining (or Auto for the smaller side) and
  switch any time from the `Esc` overlay — switching drops a carried flag,
  kills you (no death counted) and respawns you on the new side. Humans switch
  freely; bots move over on their own whenever the sides differ by two or
  more. Teams show as red / blue skins and nametags. **No friendly fire.**
- **Flags.** Touch the enemy flag to carry it. Bring it inside your **base
  zone** (within 4 blocks of your flag stand) **while your own flag is home** to
  score. Everyone can see a carried flag: a light column follows the carrier.
- **Carrying.** You walk at **75 %** speed, are **melee-only** (the gun will not
  fire) and can hand the
  flag off with **`G`** (you cannot pick it straight back up for 1.5 s).
- **Dropped flags.** A killed (or leaving) carrier drops the flag where they
  stood. Teammates pick it up and carry on; the owning team picks it up too
  and has to **carry it back into its own base zone** to return it (same
  slow, melee-only carry — and nobody carries two flags at once); untouched
  for **20 s** it returns by itself.
- **Winning.** First to the capture limit (**3**, 5 or 10) or the higher score
  when time runs out; equal scores are a draw. The scoreboard adds a captures
  column and the results screen says **Victory / Defeat / Draw** for your side
  with the final score and one ranked table per team.
- **Respawns** take **5 s** (3 s in deathmatch) and land on the **8 spawn
  points nearest your own base**, so defenders keep coming while an attacker
  crosses the map — that,
  the slow melee-only carry and the "own flag must be home" rule are what turn
  a flag run into a tug of war rather than a sprint.
- **Bots** join both teams (alternating) and play offence: they go for the
  enemy flag and run it home, escort a teammate who has it, pick up their own
  flag and carry it home when it lies closer than the enemy flag, and chase
  the enemy carrying their flag only when they are within 20 blocks. Once
  their team holds the enemy flag but can't score because their own flag is
  away, everyone but the carrier goes to get it back wherever it is (the
  carrier waits at home).

Weapon modes (`Guns + Sword` / `Sword only`) apply as usual, and weapon
drops (guns, grenade packs and/or blades per the weapon mode) fall on the
central plateau more often than in the arena (see above). CTF spawns are
always pistol-only — the deathmatch random-primary roll does not apply to
team modes.

### Team Elimination

Create a room as **Team Elimination** (⚔️ TD in the lobby list) for round-based
two-team play on a **dedicated 76×76 crossroads map** ("ngã tư tử thần") with
a **flat floor**: four **solid rounded cover blocks** (7 tall — too high to
see or jump over), one per quadrant, leave a cross of corridors between them.
The blocks are **deliberately offset, not mirrored**, so the corridor corners
are staggered into off-angle peeks; the ground they frame is a **cross-shaped
water channel**, one block deep and water bank to bank, its surface flush
with the ground — you don't walk on the water, you **sink in waist-deep**
(jump to climb back out anywhere) and bullets pass straight through the
surface. The channel stops short of the spawn yards and border lanes, and a
short border stub covers each corridor mouth. Fairness lives
in the yards: each team's two spawn strips, two weapon rows and base at the
north/south end mirror the other team's exactly, and respawning teammates
never stack — everyone gets their own spawn point.

- **Rounds.** Everyone spawns at their own end **blade-only** — no pistol, no
  grenades; every gun comes off the ground — frozen behind a **3-2-1 countdown** (3 s: no moving or attacking —
  the server drops attacks too, and bots hold still). **Dying takes you out
  for the round** — you spectate until it ends. Wiping the enemy team wins
  the round (a big banner announces the result); a simultaneous wipe is a
  drawn round (no point). Rounds have **no time limit**, and there is no
  match clock.
- **Weapons on the ground.** Every gun lies at a **fixed spot**: two rows of 4
  in front of each spawn zone — west to east **sniper, shotgun, SMG, rifle |
  M249, shotgun, rifle, sniper**, and the far side's rows are the exact
  reverse, so both teams read the same order left-to-right from their own end
  (blades ×2 per side in a sword-only room). Four **pistols** hover at the
  east/west arm mouths, beside the border stubs. The **same spots and kinds
  every round**, so you learn where your favourite gun waits. Walk over
  one with an empty slot `1` to take it (`G` throws the one you hold away);
  the rows never expire — only thrown-away guns do (5 s) — and the random
  timed drops don't run.
- **Between rounds** there is a **5 s intermission** (survivors keep walking,
  nobody respawns), then everyone comes back at their own end with a fresh
  loadout and the weapon rows are laid out again. Kills and deaths carry
  across rounds, but **kill streaks and multi-kill chains reset every round**
  (the revenge grudge survives).
- **Joining mid-round**: you spawn straight in within the first **10 s** of a
  round; later you wait for the next one (your arrival never decides a round
  you didn't fight in — it draws instead if your side had nobody in it).
- **Winning.** First team to the round limit (3/**5**/7/10) takes the match;
  the results screen says Victory / Defeat with one ranked table per team.
- **Teams** work like CTF: pick Red / Blue / Auto, switch from the `Esc`
  overlay (switching while alive kills you — you wait for the next round),
  red/blue skins, **no friendly fire**, bots alternate sides and rebalance.
  Bots fetch a gun from their own row when unarmed, then hunt the nearest
  known enemy or push the crossroads.

### Tuning

All knobs are constants in `packages/shared`:

- `constants.ts` — world size (arena, CTF and TD maps), walk/jump, gun
  cooldown/range/magazine/reload, sword range/cone/charge, HP and per-body-part
  damage, hitbox bands, respawn delay, spawn protection, room durations, max
  players, CTF capture limits / carry speed / base zone / flag return timers,
  TD round limits / intermission / spawn freeze / join grace.
- `melee.ts` — the melee move-set table (`MELEE_STATS`: light / heavy per
  weapon, each with cone, reach, damage, sweep, cooldown and animation), drop
  cadence (arena and CTF), cap, lifetime and pickup radius.
- `bot.ts` — the skill profiles (sight, turn rate, reaction, aim error,
  attack interval), preferred range, CTF goal/patrol radii, re-plan cadence;
  `nav.ts` — max drop height; `ctf.ts` — flag/team rules, `td.ts` — round /
  loadout / bot-goal rules, `worldgen.ts` — all three map layouts.

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
  melee weapon with keys 6–0 and every gun with Z X C V B, no server).
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
  shared/   pure TypeScript game core (no runtime deps) — constants, worldgen
            (arena + CTF map), AABB physics, voxel raycasts, gun/melee
            resolution, drops, spawn, CTF rules, ranking, bot AI, wire protocol
  server/   Colyseus 0.16 authoritative "arena" room + GET /rooms + GET /health
  client/   Vite + three.js: lobby, voxel renderer, pointer-lock FPS controls,
            HUD, results screen
scripts/    smoke.mjs — headless end-to-end test
docs/       ARCHITECTURE.md, design plans (docs/plans/) and other notes
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
