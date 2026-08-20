# Guns and grenades (four weapon slots)

## Context

Mineshoot has one gun (`WEAPON_GUN`, hitscan, 10-round magazine) and one melee
slot that holds the sword or a stronger blade picked up from a **drop**. Drops
exist only when the room allows melee (`dropsEnabled = weaponAllowed(mode,
WEAPON_SWORD)`), so a "Gun only" room — including a gun-only CTF room — never
drops anything, and a "Gun + Sword" room only drops knives. The user wants:

- **More guns**: the current gun becomes the **Pistol**; new **Rifle, SMG,
  Shotgun, Sniper, Taser**.
- **Grenades**.
- **Four slots**: `1` big gun (primary), `2` pistol, `3` melee, `4` grenade.
  Everyone spawns with pistol + melee + 2 grenades and an **empty primary
  slot**; primaries come **only from drops** (they replace the primary you
  hold, until you die), exactly like melee drops. A "Grenades" drop refills.
- **Rooms that allow guns drop guns (and grenades)**; rooms that allow melee
  drop melee; "all" drops both. So a gun-only CTF room now drops guns instead
  of nothing / knives.
- **Taser**: close range, one hit kills, **2 shots then the weapon is gone**
  (primary slot empty again). No reload.
- Decisions confirmed with the user: grenades **do not destroy blocks**; bots
  **do not throw grenades** in this iteration (they do use whatever gun they
  hold); `ShotMsg` changes shape to carry several rays (shotgun); the gun
  numbers below are a starting point to tune after a playtest.

## Weapon model (`packages/shared`)

### Slots (`protocol.ts`)

`Weapon` stays "the slot index the player holds"; the two existing values keep
their numbers so poses/messages/schema stay compatible:

```
WEAPON_PISTOL  = 0   (was WEAPON_GUN — renamed, same value)
WEAPON_MELEE   = 1   (was WEAPON_SWORD — renamed, same value)
WEAPON_PRIMARY = 2   big gun (rifle/smg/shotgun/sniper/taser), empty until a drop
WEAPON_GRENADE = 3
WEAPONS = [PRIMARY, PISTOL, MELEE, GRENADE]   // display / key order 1..4
GUN_SLOTS = [PISTOL, PRIMARY]                 // slots that shoot
```

`weaponAllowed(mode, slot)`: `gun` mode allows PISTOL/PRIMARY/GRENADE, `sword`
mode allows MELEE, `all` allows everything. `defaultWeapon(mode)` = PISTOL
unless sword-only (MELEE). `allowedWeapons(mode)` returns the allowed slots in
key order. Client key→slot: `1`→PRIMARY, `2`→PISTOL, `3`→MELEE, `4`→GRENADE;
the wheel skips slots that are empty (no primary, 0 grenades) or not allowed.

### Guns (`guns.ts`, new; mirrors `melee.ts`)

```
GUN_NONE = 0, GUN_PISTOL = 1, GUN_RIFLE = 2, GUN_SMG = 3, GUN_SHOTGUN = 4, GUN_SNIPER = 5, GUN_TASER = 6
GunKind = 0..6; GUN_KINDS; PRIMARY_KINDS = [RIFLE, SMG, SHOTGUN, SNIPER, TASER] (what drops / training keys offer)

interface GunSpec {
  name: string;
  magSize: number;          // taser: 2 total charges, see `consumable`
  cooldownMs: number;       // client
  serverMinIntervalMs: number; // cooldownMs - 50 (jitter slack, like melee)
  reloadMs: number;         // 0 = cannot reload
  serverReloadMinMs: number;   // reloadMs - 100
  range: number;
  damage: { head; torso; legs };
  pellets: number;          // rays per shot (1, shotgun 8)
  spreadDeg: number;        // cone half-angle for pellets / auto-fire jitter (0 = exact)
  auto: boolean;            // holds LMB → keeps firing
  zoom: number;             // RMB zoom factor (1 = none; sniper 3)
  consumable: boolean;      // taser: empty magazine ⇒ weapon removed
}
```

| Kind | Mag | Cooldown | Reload | Range | Head/torso/legs | Pellets × spread | Auto | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pistol | 10 | 350 ms | 1.5 s | 60 | 100 / 30 / 15 | 1 × 0° | no | today's gun, always in slot 2 |
| Rifle | 25 | 150 ms | 2.0 s | 60 | 70 / 25 / 12 | 1 × 1.5° | yes | |
| SMG | 35 | 80 ms | 1.8 s | 40 | 40 / 15 / 8 | 1 × 3° | yes | |
| Shotgun | 6 | 900 ms | 2.5 s | 18 | 30 / 15 / 8 per pellet | 8 × 8° | no | 8 pellets, brutal up close |
| Sniper | 4 | 1200 ms | 2.8 s | 60 | 100 / 100 / 60 | 1 × 0° | no | RMB zoom ×3 (client-only FOV) |
| Taser | 2 | 1000 ms | — | 5 | 100 / 100 / 100 | 1 × 0° | no | 2 charges then gone |

`GUN_STATS[GUN_PISTOL]` is built from today's `GUN_*` constants so nothing
moves. Helpers: `gunSpec(kind)`, `isGunKind`, `isPrimaryKind`,
`pelletDirections(yaw, pitch, spec, rng)` → unit vectors (deterministic from
the server rng; a single exact ray when `pellets === 1 && spreadDeg === 0`),
`resolveShot(world, shooter, targets, range, dir?)` gains an optional
direction so pellets reuse the same hitscan.

### Grenades (`grenade.ts`, new)

```
GRENADE_START = 2, GRENADE_MAX = 4, GRENADE_DROP_AMOUNT = 2
GRENADE_THROW_SPEED = 18 (b/s), GRENADE_GRAVITY = GRAVITY, GRENADE_RADIUS = 0.15
GRENADE_BOUNCE = 0.4 (velocity kept along the hit axis, sign flipped), GRENADE_FRICTION = 0.7 (tangential per bounce)
GRENADE_FUSE_MS = 2500, GRENADE_THROW_COOLDOWN_MS = 600, GRENADE_SERVER_MIN_INTERVAL_MS = 550
GRENADE_BLAST_RADIUS = 4, GRENADE_DAMAGE_CENTER = 100, GRENADE_DAMAGE_EDGE = 20
```

Pure functions:
- `throwGrenade(pose) → GrenadeState {x,y,z,vx,vy,vz,bornAt}` from the eye
  along the view direction at `GRENADE_THROW_SPEED`.
- `stepGrenade(world, g, dt) → GrenadeState` — gravity, axis-by-axis voxel
  collision using the existing `world.isSolid`/`aabb` helpers on a tiny AABB,
  reflect with `GRENADE_BOUNCE`, damp tangential speed with `GRENADE_FRICTION`,
  clamp to the world. Server sub-steps 4 × 12.5 ms per 50 ms tick.
- `explosionVictims(world, at, targets) → {id, damage}[]` — linear falloff
  from `DAMAGE_CENTER` at 0 to `DAMAGE_EDGE` at `BLAST_RADIUS`, measured to the
  target's torso centre; blocked when `raycastVoxels(at → torso)` hits a voxel
  first. Self-damage allowed (the thrower is in `targets`; CTF friendly fire is
  excluded upstream by `targetsExcluding`).

No block destruction: the world stays static (nav grid, chunk meshes).

### Drops (`drops.ts`)

`Drop.kind` → `Drop { id, slot: DropSlot, kind, x, y, z }` where `slot ∈
{WEAPON_PRIMARY, WEAPON_MELEE, WEAPON_GRENADE}`. `dropPool(weaponMode)`: guns
allowed → `PRIMARY_KINDS` + one `Grenades` entry; melee allowed →
`DROP_KINDS`; both when `all`. `pickDropKind(rng, weaponMode)` picks uniformly
from that pool. `dropsEnabled` is always true (every mode allows something).
Pickup rules (server): primary → replace `p.gun`, full magazine (taser: 2
charges); melee → as today; grenades → `min(GRENADE_MAX, grenades + 2)`;
grenade drops are skipped when the player is already at max (someone else can
take it).

### Bots (`bot.ts`)

`view.gun: GunKind` (what the bot holds in slot 1, `GUN_NONE` if empty).
Preferred slot: primary if any (taser/shotgun: close in to `range × 0.8`),
else pistol; ranges/cooldowns from `gunSpec`. Bots pick up any drop by walking
over it as today. **No grenade throwing** in this iteration.

## Server (`packages/server`)

- `schema.ts`: `PlayerSchema.gun: uint8` (GunKind in slot 1, `GUN_NONE`
  when empty), `grenades: uint8`; `DropSchema.slot: uint8`; new
  `GrenadeSchema { ownerId, x, y, z }` in `RoomState.grenades` map (rendering
  only; the server keeps velocity/fuse in a private map).
- `PlayerMeta`: `ammo: Record<gun slot, number>`, `reloadDoneAt` per slot,
  `lastShotAt`, `lastThrowAt`. Death/respawn: `gun = GUN_NONE`, pistol full,
  `grenades = GRENADE_START`.
- Messages (`protocol.ts` + `validate.ts` + `ArenaRoom` through `actor()`):
  - `ShootMsg` gains `weapon: WEAPON_PISTOL | WEAPON_PRIMARY`; server checks
    `weaponAllowed`, that the slot is loaded (`p.gun !== GUN_NONE` for
    primary), rate limit per `gunSpec(kind).serverMinIntervalMs`, magazine,
    then fires `pellets` rays with `pelletDirections(..., this.rng)`, applies
    damage per ray, broadcasts one `ShotMsg { shooterId, gun, from, rays:
    [{ to, hitPlayerId, part, damage }] }`. Taser: on the 2nd charge spent →
    `p.gun = GUN_NONE`, `p.weapon = WEAPON_PISTOL` if allowed else melee.
  - `ReloadMsg` becomes `{ epoch, weapon }`; reject when the kind's
    `reloadMs === 0`.
  - New `MSG.throw` (`ThrowMsg = ShootMsg` shape without weapon): checks
    `weaponAllowed(mode, WEAPON_GRENADE)`, `grenades > 0`, carrier lock,
    rate limit; decrements, spawns a `GrenadeSchema` + private state.
  - New broadcast `MSG.explode`: `{ ownerId, x, y, z, victims: [{ id, damage }] }`.
  - `MSG.selectMelee` → `MSG.selectWeapon { epoch, slot, kind }` (training range
    only): melee kinds into slot 3, `PRIMARY_KINDS` into slot 1.
  - `KillMsg.gun: GunKind` (`GUN_NONE` for melee/grenade; `weapon` = slot).
  - `PickupMsg { playerId, slot, kind }`.
- `tickGrenades(now)` in the existing 50 ms tick: sub-step, sync x/y/z, at
  fuse → `explosionVictims(world, at, targetsExcluding(owner))` + owner
  themself, `damage(owner, id, dmg, WEAPON_GRENADE, false)`, broadcast
  `explode`, delete. Owner leaving keeps the grenade (credit stays on the id).
- CTF: carrier stays melee-only (`shoot`/`throw` dropped); nothing else changes.

## Client (`packages/client`)

- `game/weapons.ts`: four slots; per-gun ammo/reload state keyed by slot;
  `auto` fire; `consumable` (taser gone → fall back to pistol); grenade count
  and throw cooldown; `zoom` flag while RMB held with a zoom gun (game.ts
  applies the FOV). Events: `onFire(slot)`, `onThrow()`, `onGunChange(kind)`,
  `onGrenadesChange(n)`.
- `render/gunProps.ts` (new): voxel-style meshes for the six guns and the
  grenade (as `meleeProps.ts`); used by `viewmodel.ts` (first-person),
  `humanoid.ts` (held item on remotes) and `dropsView.ts` (drop columns).
- `render/grenadesView.ts` (new): renders `state.grenades`, plays the blast
  (voxel spray + light flash) on `MSG.explode`; `tracers.ts` draws every ray.
- `screens/game.ts`: wires keys `1–4`, throw, explode, pickup toasts,
  ShotMsg rays, sniper zoom, remote weapon poses; `remotePlayers.ts` shows the
  held slot's prop; `net.ts` view types for the new schema fields.
- HUD: ammo box shows the held gun's name + `ammo/mag` (taser `charges`),
  a grenade counter, a 4-slot strip with the empty primary greyed; kill feed
  icons per gun kind + a grenade icon; damage vignette for blast damage.
- Lobby unchanged (weapon modes `all/gun/sword` keep their meaning).

## Docs

- `README.md`: controls table (`1–4`), gun table, grenades paragraph, drops
  paragraph (what drops in which mode), CTF note.
- `AGENTS.md`: code map (`guns.ts`, `grenade.ts`, `gunProps.ts`,
  `grenadesView.ts`), the "weapon mode is enforced server-side" paragraph
  (four slots), gotchas if any.
- `docs/ARCHITECTURE.md`: combat section (slots, pellets, grenade sim).

## Order of work (TDD, no commits unless asked)

1. `protocol.ts` slots + `guns.ts` + tests; rename `WEAPON_GUN/SWORD` usages.
2. `grenade.ts` + tests (throw, step/bounce, fuse, falloff, occlusion).
3. `drops.ts` pool by mode + tests; `bot.ts` gun kinds + tests.
4. Server: schema, validate (+tests), ArenaRoom shoot/reload/throw/pickup/
   selectWeapon/tick, integration tests.
5. Client: weapons.ts (+tests), gunProps, grenadesView, game.ts wiring, HUD,
   net view types, remotes.
6. Docs, `npm test`, `npm run build`, `npm run smoke`.

## Verification

- `npm test` (shared/server/client) and `npm run build` pass.
- Integration: shotgun shot broadcasts 8 rays; sniper torso hit kills; taser
  disappears after 2 shots; grenade explodes after the fuse and damages by
  distance; a gun-only CTF room's drops are only guns/grenades; a sword-only
  room's drops are only melee.
- `npm run smoke` reaches the results screen without console errors.
- Manual: `make start`, create rooms in each weapon mode, pick up each drop,
  fire, throw, watch the remote view model, kill feed and HUD.
