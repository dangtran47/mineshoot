# Guns and Grenades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four weapon slots (primary gun from drops, pistol, melee, grenades), five new guns (rifle, SMG, shotgun, sniper, taser), server-simulated grenades, and mode-aware drops so gun rooms (incl. CTF) drop guns/grenades instead of knives.

**Architecture:** Every rule lives in `packages/shared` as pure data + functions (`guns.ts` mirrors `melee.ts`; `grenade.ts` is a tiny voxel projectile sim on top of `moveAABB`; `drops.ts` builds its pool from the room's weapon mode). The server (`ArenaRoom`) stays the only authority for ammo, hits, blasts, pickups and the primary slot; the client predicts visuals through the extended `Weapons` state machine and new props/views.

**Tech Stack:** TypeScript, vitest, Colyseus 0.16 (`@colyseus/schema` 3.0.76), three.js, Vite. No new dependencies.

**Spec:** `docs/plans/2026-08-19-guns-and-grenades.md`

## Global Constraints

- `packages/shared` has zero runtime deps; never import `three`/`colyseus`/DOM there; no `Math.random()` in shared (thread `rng`).
- Combat is server-authoritative; clients only predict visuals. Every new inbound message: `MSG` name in `protocol.ts`, `parseX` in `validate.ts` (+ test), handler through `ArenaRoom.actor()`, gated by `weaponAllowed`.
- Slot numbers: `WEAPON_PISTOL = 0`, `WEAPON_MELEE = 1`, `WEAPON_PRIMARY = 2`, `WEAPON_GRENADE = 3` (the first two keep today's values).
- Server rate limits stay ~50 ms looser than client cooldowns (`serverMinIntervalMs = cooldownMs - 50`, reload `-100`).
- No assets (textures/audio/images); props are geometry, icons are inline SVG.
- Style: 2-space indent, single quotes, semicolons, trailing commas, `import type` for types. No commits unless the user asks (the "Commit" steps below are therefore **skipped**; run the tests instead).
- Definition of done: `npm test`, `npm run build`, `npm run smoke` (server with `MINESHOOT_TEST=1`), README numbers match `guns.ts`/`grenade.ts`/`drops.ts`.

---

## File map

| File | Responsibility |
| --- | --- |
| `packages/shared/src/protocol.ts` (modify) | slot constants/helpers, message shapes (`ShootMsg.weapon`, `ShotMsg.rays`, `ReloadMsg`, `ThrowMsg`, `ExplodeMsg`, `SelectWeaponMsg`, `PickupMsg`, `KillMsg.gun`), `MSG.throw/explode/selectWeapon` |
| `packages/shared/src/guns.ts` (create) | `GunKind`, `GUN_STATS`, `gunSpec`, `pelletDirections`, `isGunKind`, `isPrimaryKind` |
| `packages/shared/src/gun.ts` (modify) | `resolveRay(world, from, dir, targets, range, damage)`; `resolveShot` delegates to it |
| `packages/shared/src/grenade.ts` (create) | grenade constants, `throwGrenade`, `stepGrenade`, `grenadeFuseDone`, `blastDamage`, `explosionVictims` |
| `packages/shared/src/drops.ts` (modify) | `DropKind {slot, kind}`, `dropPool(mode)`, `pickDropKind(rng, mode)`, `dropName` |
| `packages/shared/src/bot.ts` (modify) | `view.gun`, slot choice + range/cooldown from `gunSpec` |
| `packages/server/src/rooms/schema.ts` (modify) | `PlayerSchema.gun/grenades`, `DropSchema.slot`, `GrenadeSchema`, `RoomState.grenades` |
| `packages/server/src/rooms/validate.ts` (modify) | `parseShoot` (weapon), `parseReload` (object), `parseThrow`, `parseSelectWeapon` |
| `packages/server/src/rooms/ArenaRoom.ts` (modify) | per-slot ammo, gun specs, pellets, taser, throw/tick/explode, slot-aware drops, `selectWeapon` |
| `packages/client/src/net.ts` (modify) | `NetPlayer.gun/grenades`, `NetDrop.slot`, `NetGrenade`, `state.grenades` |
| `packages/client/src/game/weapons.ts` (modify) | four slots, per-slot ammo/reload, auto fire, taser, grenades, zoom |
| `packages/client/src/render/gunProps.ts` (create) | `buildGunProp(kind)`, `buildGrenadeProp()`, `disposeProp` reuse |
| `packages/client/src/render/viewmodel.ts`, `humanoid.ts`, `humanoidAnim.ts`, `dropsView.ts` (modify) | show pistol/primary/melee/grenade props by slot |
| `packages/client/src/render/grenadesView.ts` (create) | live grenades + blast burst |
| `packages/client/src/screens/game.ts` (modify) | keys 1–4, throw, rays, explode, pickup toast, zoom, HUD wiring |
| `packages/client/src/hud/hud.ts`, `killFeed.ts`, `icons.ts`, `style.css` (modify) | ammo per gun, grenade count, slot strip, icons |
| `README.md`, `AGENTS.md`, `docs/ARCHITECTURE.md` (modify) | numbers, code map, combat section |

---

### Task 1: Four slots in `protocol.ts` + rename sweep

**Files:**
- Modify: `packages/shared/src/protocol.ts:8-27`
- Modify: `packages/shared/test/protocol.test.ts`
- Modify (mechanical rename): every `WEAPON_GUN` → `WEAPON_PISTOL`, `WEAPON_SWORD` → `WEAPON_MELEE` under `packages/*/src`, `packages/*/test`
- Modify: `packages/server/src/rooms/validate.ts:97-103` (`parsePose` weapon)

**Interfaces:**
- Produces: `WEAPON_PISTOL|WEAPON_MELEE|WEAPON_PRIMARY|WEAPON_GRENADE`, `type Weapon`, `WEAPONS` (key order), `GUN_SLOTS`, `isWeapon(v)`, `isGunSlot(w)`, `weaponAllowed(mode, w)`, `defaultWeapon(mode)`, `allowedWeapons(mode)`.

- [ ] **Step 1: Write the failing tests** (append to `packages/shared/test/protocol.test.ts`, import the new names from `../src/protocol`)

```ts
describe('weapon slots', () => {
  it('has four slots in key order, gun slots first two of them', () => {
    expect(WEAPON_PISTOL).toBe(0);
    expect(WEAPON_MELEE).toBe(1);
    expect(WEAPONS).toEqual([WEAPON_PRIMARY, WEAPON_PISTOL, WEAPON_MELEE, WEAPON_GRENADE]);
    expect(GUN_SLOTS).toEqual([WEAPON_PISTOL, WEAPON_PRIMARY]);
    expect(isWeapon(3)).toBe(true);
    expect(isWeapon(4)).toBe(false);
    expect(isGunSlot(WEAPON_GRENADE)).toBe(false);
  });
  it('gun mode allows every slot but melee; sword mode only melee; all everything', () => {
    expect(allowedWeapons('all')).toEqual([WEAPON_PRIMARY, WEAPON_PISTOL, WEAPON_MELEE, WEAPON_GRENADE]);
    expect(allowedWeapons('gun')).toEqual([WEAPON_PRIMARY, WEAPON_PISTOL, WEAPON_GRENADE]);
    expect(allowedWeapons('sword')).toEqual([WEAPON_MELEE]);
    expect(weaponAllowed('gun', WEAPON_GRENADE)).toBe(true);
    expect(weaponAllowed('sword', WEAPON_PRIMARY)).toBe(false);
    expect(defaultWeapon('all')).toBe(WEAPON_PISTOL);
    expect(defaultWeapon('sword')).toBe(WEAPON_MELEE);
  });
});
```

- [ ] **Step 2: Run to verify it fails**: `npx vitest run test/protocol.test.ts -w @mineshoot/shared` → FAIL (`WEAPON_PRIMARY` not exported).

- [ ] **Step 3: Implement in `protocol.ts`** (replace lines 8–27)

```ts
/** Weapon slots (the number a pose/message carries). Keys 1..4 map to WEAPONS order. */
export const WEAPON_PISTOL = 0;
export const WEAPON_MELEE = 1;
export const WEAPON_PRIMARY = 2;
export const WEAPON_GRENADE = 3;
export type Weapon = typeof WEAPON_PISTOL | typeof WEAPON_MELEE | typeof WEAPON_PRIMARY | typeof WEAPON_GRENADE;
/** Slots in key order: 1 primary (big gun), 2 pistol, 3 melee, 4 grenade. */
export const WEAPONS: readonly Weapon[] = [WEAPON_PRIMARY, WEAPON_PISTOL, WEAPON_MELEE, WEAPON_GRENADE];
/** Slots that fire bullets. */
export const GUN_SLOTS: readonly Weapon[] = [WEAPON_PISTOL, WEAPON_PRIMARY];
export function isWeapon(v: unknown): v is Weapon {
  return v === WEAPON_PISTOL || v === WEAPON_MELEE || v === WEAPON_PRIMARY || v === WEAPON_GRENADE;
}
export function isGunSlot(w: Weapon): boolean {
  return w === WEAPON_PISTOL || w === WEAPON_PRIMARY;
}

export type Phase = 'playing' | 'ended';

/** Which weapons a room allows; chosen at creation. 'gun' = pistol, primary and grenades; 'sword' = melee only. */
export const WEAPON_MODES = ['all', 'gun', 'sword'] as const;
export type WeaponMode = (typeof WEAPON_MODES)[number];
export const DEFAULT_WEAPON_MODE: WeaponMode = 'all';
export function weaponAllowed(mode: WeaponMode, w: Weapon): boolean {
  if (mode === 'all') return true;
  return mode === 'gun' ? w !== WEAPON_MELEE : w === WEAPON_MELEE;
}
/** The slot a player starts with (and is forced to) under `mode`: the pistol, or melee in a sword-only room. */
export function defaultWeapon(mode: WeaponMode): Weapon {
  return mode === 'sword' ? WEAPON_MELEE : WEAPON_PISTOL;
}
/** Allowed slots in key order. */
export function allowedWeapons(mode: WeaponMode): Weapon[] {
  return WEAPONS.filter((w) => weaponAllowed(mode, w));
}
```

- [ ] **Step 4: Rename sweep** (from repo root):

```sh
grep -rlE "WEAPON_GUN|WEAPON_SWORD" packages/*/src packages/*/test scripts | xargs sed -i '' -e 's/WEAPON_GUN/WEAPON_PISTOL/g' -e 's/WEAPON_SWORD/WEAPON_MELEE/g'
grep -rnE "WEAPON_GUN|WEAPON_SWORD" packages scripts   # must print nothing
```
Then fix `parsePose` in `validate.ts`:
```ts
  const w = (msg as Record<string, unknown>).weapon;
  const weapon: Weapon = isWeapon(w) ? w : WEAPON_PISTOL;
```
(add `isWeapon`, `WEAPON_PISTOL` to the import). Existing tests that assert `allowedWeapons('all')` equals `[0, 1]` (search `allowedWeapons` in `packages/*/test`) → update to the four-slot order. In `packages/client/src/game/weapons.ts` the constructor's `this.current = this.allowed[0]` would now start on the (empty) primary: change to `this.current = this.allowed.includes(WEAPON_PISTOL) ? WEAPON_PISTOL : this.allowed[0];` and `toggle()` to cycle: `const i = this.allowed.indexOf(this.current); this.select(this.allowed[(i + 1) % this.allowed.length]);` (Task 10 rewrites this class fully; this keeps tests green now).

- [ ] **Step 5: Run everything**: `npm test` and `npm run build` → PASS (fix any test that hard-coded `[0, 1]`).

---

### Task 2: `guns.ts` — gun kinds, specs, pellets; `resolveRay`

**Files:**
- Create: `packages/shared/src/guns.ts`, `packages/shared/test/guns.test.ts`
- Modify: `packages/shared/src/gun.ts`, `packages/shared/src/index.ts` (add `export * from './guns';`)

**Interfaces:**
- Produces: `GUN_NONE=0, GUN_PISTOL=1, GUN_RIFLE=2, GUN_SMG=3, GUN_SHOTGUN=4, GUN_SNIPER=5, GUN_TASER=6`, `type GunKind`, `GUN_KINDS`, `PRIMARY_KINDS`, `interface GunSpec`, `GUN_STATS`, `gunSpec(kind)`, `isGunKind(v)`, `isPrimaryKind(v)`, `pelletDirections(yaw, pitch, spec, rng): Vec3[]`, `resolveRay(world, from, dir, targets, range, damage): ShotResult`.

- [ ] **Step 1: Failing tests** `packages/shared/test/guns.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { GUN_COOLDOWN_MS, GUN_DAMAGE, GUN_MAG_SIZE, GUN_RANGE, GUN_RELOAD_MS } from '../src/constants';
import { GUN_KINDS, GUN_NONE, GUN_PISTOL, GUN_SHOTGUN, GUN_SNIPER, GUN_TASER, PRIMARY_KINDS, gunSpec, isGunKind, isPrimaryKind, pelletDirections } from '../src/guns';
import { forwardVector } from '../src/playerPhysics';
import { createRng } from '../src/rng';

describe('guns', () => {
  it('the pistol is today\'s gun', () => {
    const p = gunSpec(GUN_PISTOL);
    expect(p).toMatchObject({ magSize: GUN_MAG_SIZE, cooldownMs: GUN_COOLDOWN_MS, reloadMs: GUN_RELOAD_MS, range: GUN_RANGE, damage: GUN_DAMAGE, pellets: 1, spreadDeg: 0, auto: false });
  });
  it('every kind keeps the server rate limit slightly looser than the client cooldown', () => {
    for (const k of GUN_KINDS) {
      const s = gunSpec(k);
      expect(s.serverMinIntervalMs).toBeLessThan(s.cooldownMs);
      expect(s.serverMinIntervalMs).toBeGreaterThanOrEqual(s.cooldownMs - 60);
      if (s.reloadMs > 0) expect(s.serverReloadMinMs).toBeLessThan(s.reloadMs);
    }
  });
  it('primaries are every kind but none/pistol; the taser is consumable and cannot reload', () => {
    expect(PRIMARY_KINDS).not.toContain(GUN_NONE);
    expect(PRIMARY_KINDS).not.toContain(GUN_PISTOL);
    expect(isPrimaryKind(GUN_SNIPER)).toBe(true);
    expect(isPrimaryKind(GUN_PISTOL)).toBe(false);
    expect(isGunKind(7)).toBe(false);
    const t = gunSpec(GUN_TASER);
    expect(t.consumable).toBe(true);
    expect(t.magSize).toBe(2);
    expect(t.reloadMs).toBe(0);
    expect(t.damage).toEqual({ head: 100, torso: 100, legs: 100 });
    expect(gunSpec(GUN_SNIPER).damage.torso).toBe(100);
    expect(gunSpec(GUN_SNIPER).zoom).toBeGreaterThan(1);
  });
  it('unknown kinds fall back to the pistol spec', () => {
    expect(gunSpec(42 as never)).toBe(gunSpec(GUN_PISTOL));
  });
  it('pelletDirections: one exact ray for tight guns, N rays inside the cone for the shotgun (deterministic)', () => {
    const fwd = forwardVector(0.3, -0.1);
    expect(pelletDirections(0.3, -0.1, gunSpec(GUN_PISTOL), createRng(1))).toEqual([fwd]);
    const s = gunSpec(GUN_SHOTGUN);
    const a = pelletDirections(0.3, -0.1, s, createRng(5));
    const b = pelletDirections(0.3, -0.1, s, createRng(5));
    expect(a).toHaveLength(s.pellets);
    expect(a).toEqual(b);
    const cosMax = Math.cos((s.spreadDeg * Math.PI) / 180) - 1e-6;
    for (const d of a) {
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 6);
      expect(d.x * fwd.x + d.y * fwd.y + d.z * fwd.z).toBeGreaterThanOrEqual(cosMax);
    }
    expect(new Set(a.map((d) => d.x)).size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run test/guns.test.ts -w @mineshoot/shared` → FAIL (module missing).

- [ ] **Step 3: Implement `packages/shared/src/guns.ts`**

```ts
import { GUN_COOLDOWN_MS, GUN_DAMAGE, GUN_MAG_SIZE, GUN_RANGE, GUN_RELOAD_MS, GUN_RELOAD_SERVER_MIN_MS, GUN_SERVER_MIN_INTERVAL_MS } from './constants';
import type { HitPart } from './hitbox';
import { forwardVector } from './playerPhysics';
import type { Vec3 } from './types';

/*
 * Gun kinds. Slot 2 (pistol) always holds GUN_PISTOL; slot 1 (primary) holds
 * one of PRIMARY_KINDS picked up from a drop, or GUN_NONE when empty.
 */
export const GUN_NONE = 0;
export const GUN_PISTOL = 1;
export const GUN_RIFLE = 2;
export const GUN_SMG = 3;
export const GUN_SHOTGUN = 4;
export const GUN_SNIPER = 5;
export const GUN_TASER = 6;
export type GunKind = typeof GUN_NONE | typeof GUN_PISTOL | typeof GUN_RIFLE | typeof GUN_SMG | typeof GUN_SHOTGUN | typeof GUN_SNIPER | typeof GUN_TASER;
export const GUN_KINDS: readonly GunKind[] = [GUN_PISTOL, GUN_RIFLE, GUN_SMG, GUN_SHOTGUN, GUN_SNIPER, GUN_TASER];
/** Kinds that can sit in the primary slot (drops / training keys). */
export const PRIMARY_KINDS: readonly GunKind[] = [GUN_RIFLE, GUN_SMG, GUN_SHOTGUN, GUN_SNIPER, GUN_TASER];

export interface GunSpec {
  name: string;
  /** Rounds per magazine (taser: total charges, see `consumable`). */
  magSize: number;
  cooldownMs: number;
  /** Server-side minimum interval between shots (slack for network jitter). */
  serverMinIntervalMs: number;
  /** 0 = cannot reload. */
  reloadMs: number;
  serverReloadMinMs: number;
  range: number;
  damage: Record<HitPart, number>;
  /** Rays per shot. */
  pellets: number;
  /** Cone half-angle (degrees) the pellets / auto-fire jitter spread over; 0 = exact. */
  spreadDeg: number;
  /** Keeps firing while LMB is held. */
  auto: boolean;
  /** RMB zoom factor (1 = none). */
  zoom: number;
  /** Empty magazine ⇒ the weapon is gone (taser). */
  consumable: boolean;
}

type SpecInput = Omit<GunSpec, 'serverMinIntervalMs' | 'serverReloadMinMs'>;
const spec = (s: SpecInput): GunSpec => ({ ...s, serverMinIntervalMs: s.cooldownMs - 50, serverReloadMinMs: Math.max(0, s.reloadMs - 100) });

export const GUN_STATS: Record<GunKind, GunSpec> = {
  [GUN_NONE]: spec({ name: 'Empty', magSize: 0, cooldownMs: 1000, reloadMs: 0, range: 0, damage: { head: 0, torso: 0, legs: 0 }, pellets: 0, spreadDeg: 0, auto: false, zoom: 1, consumable: false }),
  // Today's gun, unchanged.
  [GUN_PISTOL]: { name: 'Pistol', magSize: GUN_MAG_SIZE, cooldownMs: GUN_COOLDOWN_MS, serverMinIntervalMs: GUN_SERVER_MIN_INTERVAL_MS, reloadMs: GUN_RELOAD_MS, serverReloadMinMs: GUN_RELOAD_SERVER_MIN_MS, range: GUN_RANGE, damage: { ...GUN_DAMAGE }, pellets: 1, spreadDeg: 0, auto: false, zoom: 1, consumable: false },
  [GUN_RIFLE]: spec({ name: 'Rifle', magSize: 25, cooldownMs: 150, reloadMs: 2000, range: 60, damage: { head: 70, torso: 25, legs: 12 }, pellets: 1, spreadDeg: 1.5, auto: true, zoom: 1, consumable: false }),
  [GUN_SMG]: spec({ name: 'SMG', magSize: 35, cooldownMs: 80, reloadMs: 1800, range: 40, damage: { head: 40, torso: 15, legs: 8 }, pellets: 1, spreadDeg: 3, auto: true, zoom: 1, consumable: false }),
  [GUN_SHOTGUN]: spec({ name: 'Shotgun', magSize: 6, cooldownMs: 900, reloadMs: 2500, range: 18, damage: { head: 30, torso: 15, legs: 8 }, pellets: 8, spreadDeg: 8, auto: false, zoom: 1, consumable: false }),
  [GUN_SNIPER]: spec({ name: 'Sniper', magSize: 4, cooldownMs: 1200, reloadMs: 2800, range: 60, damage: { head: 100, torso: 100, legs: 60 }, pellets: 1, spreadDeg: 0, auto: false, zoom: 3, consumable: false }),
  // Two charges, then it's gone.
  [GUN_TASER]: spec({ name: 'Taser', magSize: 2, cooldownMs: 1000, reloadMs: 0, range: 5, damage: { head: 100, torso: 100, legs: 100 }, pellets: 1, spreadDeg: 0, auto: false, zoom: 1, consumable: true }),
};

export function isGunKind(v: unknown): v is GunKind {
  return typeof v === 'number' && (GUN_KINDS as readonly number[]).includes(v);
}
export function isPrimaryKind(v: unknown): v is GunKind {
  return typeof v === 'number' && (PRIMARY_KINDS as readonly number[]).includes(v);
}
export function gunSpec(kind: GunKind): GunSpec {
  return GUN_STATS[kind] ?? GUN_STATS[GUN_PISTOL];
}

/**
 * Directions of the rays one shot fires: the exact view direction for a tight
 * gun; otherwise `pellets` directions uniformly inside the spread cone, drawn
 * from `rng` (the server's seeded rng → deterministic, replayable).
 */
export function pelletDirections(yaw: number, pitch: number, spec: GunSpec, rng: () => number): Vec3[] {
  if (spec.spreadDeg <= 0) return [forwardVector(yaw, pitch)];
  const spread = (spec.spreadDeg * Math.PI) / 180;
  const out: Vec3[] = [];
  for (let i = 0; i < spec.pellets; i++) {
    const r = spread * Math.sqrt(rng());
    const a = rng() * Math.PI * 2;
    out.push(forwardVector(yaw + r * Math.cos(a), pitch + r * Math.sin(a)));
  }
  return out;
}
```
Note: `GUN_DAMAGE` is `as const` (readonly); spread it into a mutable record as shown so `damage: Record<HitPart, number>` typechecks.

- [ ] **Step 4: `gun.ts` — split `resolveShot`**

```ts
/** One hitscan ray from `from` along unit `dir`: nearest of voxels vs. body-part boxes; damage from `damage` by part. */
export function resolveRay(world: World, from: Vec3, dir: Vec3, targets: ShotTarget[], range: number, damage: Record<HitPart, number> = GUN_DAMAGE): ShotResult {
  const voxel = raycastVoxels(world, from, dir, range);
  let bestT = voxel.hit ? voxel.t : range;
  const far: Vec3 = { x: from.x + dir.x * range, y: from.y + dir.y * range, z: from.z + dir.z * range };
  let hitPlayerId: string | null = null;
  let part: HitPart | null = null;
  for (const target of targets) {
    for (const hb of playerHitboxes(target.pose)) {
      const t01 = segmentVsAABB(from, far, hb.box);
      if (t01 === null) continue;
      const t = t01 * range;
      if (t < bestT) {
        bestT = t;
        hitPlayerId = target.id;
        part = hb.part;
      }
    }
  }
  const to: Vec3 = { x: from.x + dir.x * bestT, y: from.y + dir.y * bestT, z: from.z + dir.z * bestT };
  return { from, to, hitPlayerId, part, damage: part ? damage[part] : 0 };
}

export function resolveShot(world: World, shooter: PlayerPose, targets: ShotTarget[], range: number): ShotResult {
  return resolveRay(world, eyePosition(shooter), forwardVector(shooter.yaw, shooter.pitch), targets, range);
}
```
Import `GUN_DAMAGE` from `./constants`; drop the now-unused `damageForPart` import if nothing else uses it (keep the export in `hitbox.ts`).

- [ ] **Step 5: Run** `npm run test -w @mineshoot/shared` and `npm run build` → PASS.

---

### Task 3: `grenade.ts` — projectile sim + blast

**Files:**
- Create: `packages/shared/src/grenade.ts`, `packages/shared/test/grenade.test.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from './grenade';`)

**Interfaces:**
- Produces: constants `GRENADE_START, GRENADE_MAX, GRENADE_DROP_AMOUNT, GRENADE_THROW_SPEED, GRENADE_RADIUS, GRENADE_BOUNCE, GRENADE_FRICTION, GRENADE_FUSE_MS, GRENADE_THROW_COOLDOWN_MS, GRENADE_SERVER_MIN_INTERVAL_MS, GRENADE_BLAST_RADIUS, GRENADE_DAMAGE_CENTER, GRENADE_DAMAGE_EDGE, GRENADE_SUBSTEPS`; `interface GrenadeState {x,y,z,vx,vy,vz,bornAt}`; `throwGrenade(pose, now)`, `stepGrenade(world, g, dt)`, `grenadeFuseDone(g, now)`, `blastDamage(dist)`, `interface BlastVictim {id, damage}`, `explosionVictims(world, at, targets: ShotTarget[])`.

- [ ] **Step 1: Failing tests** `packages/shared/test/grenade.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { EYE_HEIGHT } from '../src/constants';
import { GRENADE_BLAST_RADIUS, GRENADE_DAMAGE_CENTER, GRENADE_DAMAGE_EDGE, GRENADE_FUSE_MS, GRENADE_THROW_SPEED, blastDamage, explosionVictims, grenadeFuseDone, stepGrenade, throwGrenade } from '../src/grenade';
import { Block } from '../src/types';
import { createWorld, setBlock } from '../src/world';

/** Flat 32×16×32 world: stone floor at y=0, air above. */
function flat(): ReturnType<typeof createWorld> {
  const w = createWorld(32, 16, 32);
  for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) setBlock(w, x, 0, z, Block.Stone);
  return w;
}
const pose = { x: 16, y: 1, z: 16, yaw: 0, pitch: 0 };

describe('grenade', () => {
  it('leaves the eye along the view direction at throw speed', () => {
    const g = throwGrenade(pose, 1000);
    expect(g.bornAt).toBe(1000);
    expect(g.y).toBeCloseTo(1 + EYE_HEIGHT - 0.1, 1);
    expect(g.vz).toBeCloseTo(-GRENADE_THROW_SPEED, 5); // yaw 0 looks down -Z
    expect(g.vx).toBeCloseTo(0, 5);
  });
  it('falls under gravity, bounces off the floor and comes to rest', () => {
    const w = flat();
    let g = throwGrenade({ ...pose, pitch: 0.4 }, 0);
    let maxY = g.y;
    let bounced = false;
    for (let i = 0; i < 400; i++) {
      const prev = g;
      g = stepGrenade(w, g, 1 / 80);
      maxY = Math.max(maxY, g.y);
      if (prev.vy < 0 && g.vy > 0) bounced = true;
      expect(g.y).toBeGreaterThan(0.9); // never inside the floor
    }
    expect(maxY).toBeGreaterThan(2);
    expect(bounced).toBe(true);
    expect(Math.abs(g.vy)).toBeLessThan(0.5);
    expect(g.y).toBeLessThan(1.3); // resting on the floor
  });
  it('bounces back off a wall', () => {
    const w = flat();
    for (let y = 1; y < 6; y++) for (let x = 0; x < 32; x++) setBlock(w, x, y, 10, Block.Stone);
    let g = throwGrenade({ ...pose, pitch: 0.2 }, 0); // toward -Z, wall at z=10
    for (let i = 0; i < 60; i++) g = stepGrenade(w, g, 1 / 80);
    expect(g.z).toBeGreaterThan(11);
    expect(g.vz).toBeGreaterThan(0);
  });
  it('fuse and damage falloff', () => {
    const g = throwGrenade(pose, 0);
    expect(grenadeFuseDone(g, GRENADE_FUSE_MS - 1)).toBe(false);
    expect(grenadeFuseDone(g, GRENADE_FUSE_MS)).toBe(true);
    expect(blastDamage(0)).toBe(GRENADE_DAMAGE_CENTER);
    expect(blastDamage(GRENADE_BLAST_RADIUS)).toBe(GRENADE_DAMAGE_EDGE);
    expect(blastDamage(GRENADE_BLAST_RADIUS / 2)).toBe(Math.round((GRENADE_DAMAGE_CENTER + GRENADE_DAMAGE_EDGE) / 2));
    expect(blastDamage(GRENADE_BLAST_RADIUS + 0.1)).toBe(0);
  });
  it('explosionVictims: by distance, out of range ignored, walls block', () => {
    const w = flat();
    const at = { x: 16, y: 1.5, z: 16 };
    const near = { id: 'near', pose: { x: 16, y: 1, z: 17 } };
    const far = { id: 'far', pose: { x: 16, y: 1, z: 16 + GRENADE_BLAST_RADIUS + 2 } };
    const behind = { id: 'behind', pose: { x: 19, y: 1, z: 16 } };
    for (let y = 1; y < 4; y++) setBlock(w, 18, y, 16, Block.Stone); // wall between `at` and `behind`
    const v = explosionVictims(w, at, [near, far, behind]);
    expect(v.map((x) => x.id)).toEqual(['near']);
    expect(v[0].damage).toBeGreaterThan(80);
  });
});
```

- [ ] **Step 2: Run** → FAIL (module missing).

- [ ] **Step 3: Implement `packages/shared/src/grenade.ts`**

```ts
import { EYE_HEIGHT, GRAVITY, LEGS_TOP, TORSO_TOP } from './constants';
import { aabbCenter } from './aabb';
import { moveAABB } from './collision';
import type { ShotTarget } from './gun';
import { forwardVector } from './playerPhysics';
import { raycastVoxels } from './raycast';
import type { AABB, PlayerPose, Vec3, World } from './types';

/*
 * Grenades (slot 4). Thrown from the eye along the view direction, they fly
 * ballistically, bounce off voxels and burst after a fixed fuse; damage falls
 * off linearly with distance and is blocked by walls. Server-simulated; the
 * client only renders `state.grenades`.
 */
export const GRENADE_START = 2;
export const GRENADE_MAX = 4;
/** A "Grenades" drop adds this many. */
export const GRENADE_DROP_AMOUNT = 2;
export const GRENADE_THROW_SPEED = 18;
export const GRENADE_RADIUS = 0.15;
/** Speed kept (and reversed) along the axis that hit a voxel. */
export const GRENADE_BOUNCE = 0.4;
/** Tangential speed kept on a floor bounce. */
export const GRENADE_FRICTION = 0.7;
export const GRENADE_FUSE_MS = 2500;
export const GRENADE_THROW_COOLDOWN_MS = 600;
export const GRENADE_SERVER_MIN_INTERVAL_MS = 550;
export const GRENADE_BLAST_RADIUS = 4;
export const GRENADE_DAMAGE_CENTER = 100;
export const GRENADE_DAMAGE_EDGE = 20;
/** Physics sub-steps per 50 ms server tick. */
export const GRENADE_SUBSTEPS = 4;

export interface GrenadeState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  bornAt: number;
}

/** A grenade leaving the thrower's eye (a little ahead, so it never starts inside their own head box). */
export function throwGrenade(pose: PlayerPose, now: number): GrenadeState {
  const d = forwardVector(pose.yaw, pose.pitch);
  return {
    x: pose.x + d.x * 0.4,
    y: pose.y + EYE_HEIGHT - 0.1 + d.y * 0.4,
    z: pose.z + d.z * 0.4,
    vx: d.x * GRENADE_THROW_SPEED,
    vy: d.y * GRENADE_THROW_SPEED,
    vz: d.z * GRENADE_THROW_SPEED,
    bornAt: now,
  };
}

/** Advance one grenade by `dt` seconds: gravity, swept voxel collision, bounce. */
export function stepGrenade(world: World, g: GrenadeState, dt: number): GrenadeState {
  const vy = g.vy - GRAVITY * dt;
  const r = GRENADE_RADIUS;
  const box: AABB = { min: { x: g.x - r, y: g.y - r, z: g.z - r }, max: { x: g.x + r, y: g.y + r, z: g.z + r } };
  const m = moveAABB(world, box, { x: g.vx * dt, y: vy * dt, z: g.vz * dt });
  let nvx = g.vx;
  let nvy = vy;
  let nvz = g.vz;
  if (m.hitY) {
    nvy = -vy * GRENADE_BOUNCE;
    if (Math.abs(nvy) < 1) nvy = 0;
    nvx *= GRENADE_FRICTION;
    nvz *= GRENADE_FRICTION;
  }
  if (m.hitX) nvx = -g.vx * GRENADE_BOUNCE;
  if (m.hitZ) nvz = -g.vz * GRENADE_BOUNCE;
  const c = aabbCenter(m.box);
  return { x: c.x, y: c.y, z: c.z, vx: nvx, vy: nvy, vz: nvz, bornAt: g.bornAt };
}

export function grenadeFuseDone(g: GrenadeState, now: number): boolean {
  return now - g.bornAt >= GRENADE_FUSE_MS;
}

/** Damage at `dist` blocks from the burst: linear from the centre value to the edge value, 0 beyond the radius. */
export function blastDamage(dist: number): number {
  if (dist > GRENADE_BLAST_RADIUS) return 0;
  return Math.round(GRENADE_DAMAGE_CENTER + (GRENADE_DAMAGE_EDGE - GRENADE_DAMAGE_CENTER) * (dist / GRENADE_BLAST_RADIUS));
}

export interface BlastVictim {
  id: string;
  damage: number;
}

/** Everyone in `targets` the burst at `at` reaches (distance to the torso centre; voxels in between block it). */
export function explosionVictims(world: World, at: Vec3, targets: ShotTarget[]): BlastVictim[] {
  const out: BlastVictim[] = [];
  for (const t of targets) {
    const torso: Vec3 = { x: t.pose.x, y: t.pose.y + (LEGS_TOP + TORSO_TOP) / 2, z: t.pose.z };
    const dx = torso.x - at.x;
    const dy = torso.y - at.y;
    const dz = torso.z - at.z;
    const dist = Math.hypot(dx, dy, dz);
    const damage = blastDamage(dist);
    if (damage <= 0) continue;
    if (dist > 1e-3 && raycastVoxels(world, at, { x: dx / dist, y: dy / dist, z: dz / dist }, dist).hit) continue;
    out.push({ id: t.id, damage });
  }
  return out;
}
```

- [ ] **Step 4: Run** `npx vitest run test/grenade.test.ts -w @mineshoot/shared` → PASS. If the "comes to rest" test is flaky about `g.y < 1.3`, that is the resting height `1 + GRENADE_RADIUS + EPS` ≈ 1.15 — assert against that instead of loosening physics.

---

### Task 4: `drops.ts` — pool by weapon mode

**Files:**
- Modify: `packages/shared/src/drops.ts`, `packages/shared/test/drops.test.ts`

**Interfaces:**
- Produces: `type DropSlot`, `interface DropKind { slot: DropSlot; kind: number }`, `interface Drop extends DropKind {id,x,y,z}`, `dropPool(mode: WeaponMode): DropKind[]`, `pickDropKind(rng, mode = 'all'): DropKind`, `dropName(d: DropKind): string`. `pickDropSpot` unchanged.

- [ ] **Step 1: Failing tests** (replace the first test in `drops.test.ts`; add imports `WEAPON_GRENADE, WEAPON_MELEE, WEAPON_PRIMARY` from `../src/protocol`, `PRIMARY_KINDS` from `../src/guns`, `GRENADE_DROP_AMOUNT` from `../src/grenade`, `dropName, dropPool` from `../src/drops`)

```ts
  it('dropPool follows the weapon mode: guns+grenades for gun rooms, knives for sword rooms, both for all', () => {
    const gun = dropPool('gun');
    expect(gun.filter((d) => d.slot === WEAPON_PRIMARY).map((d) => d.kind).sort()).toEqual([...PRIMARY_KINDS].sort());
    expect(gun.filter((d) => d.slot === WEAPON_GRENADE)).toEqual([{ slot: WEAPON_GRENADE, kind: GRENADE_DROP_AMOUNT }]);
    expect(gun.some((d) => d.slot === WEAPON_MELEE)).toBe(false);
    const sword = dropPool('sword');
    expect(sword.every((d) => d.slot === WEAPON_MELEE)).toBe(true);
    expect(sword.map((d) => d.kind).sort()).toEqual([...DROP_KINDS].sort());
    expect(dropPool('all')).toHaveLength(gun.length + sword.length);
  });
  it('pickDropKind never yields the sword and covers the whole pool of the mode', () => {
    const rng = createRng(1);
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const k = pickDropKind(rng, 'all');
      expect(k.slot === WEAPON_MELEE && k.kind === MELEE_SWORD).toBe(false);
      seen.add(`${k.slot}:${k.kind}`);
    }
    expect(seen.size).toBe(dropPool('all').length);
    for (let i = 0; i < 50; i++) expect(pickDropKind(rng, 'gun').slot).not.toBe(WEAPON_MELEE);
  });
  it('names drops for toasts', () => {
    expect(dropName({ slot: WEAPON_GRENADE, kind: 2 })).toBe('Grenades ×2');
    expect(dropName({ slot: WEAPON_MELEE, kind: MELEE_KATANA })).toBe('Katana');
    expect(dropName({ slot: WEAPON_PRIMARY, kind: GUN_SHOTGUN })).toBe('Shotgun');
  });
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** in `drops.ts` (replace the `Drop` interface and `pickDropKind`; keep `pickDropSpot`)

```ts
import { GRENADE_DROP_AMOUNT } from './grenade';
import { PRIMARY_KINDS, gunSpec } from './guns';
import type { GunKind } from './guns';
import { DROP_KINDS, DROP_MIN_SPACING, meleeStats } from './melee';
import type { MeleeKind } from './melee';
import { WEAPON_GRENADE, WEAPON_MELEE, WEAPON_PRIMARY, weaponAllowed } from './protocol';
import type { WeaponMode } from './protocol';

/** Slots a drop can fill. */
export type DropSlot = typeof WEAPON_PRIMARY | typeof WEAPON_MELEE | typeof WEAPON_GRENADE;
/** What a drop gives: a GunKind (primary), a MeleeKind (melee) or a grenade count (grenade). */
export interface DropKind {
  slot: DropSlot;
  kind: number;
}
/** A weapon lying on the ground (feet position of a player standing on it). */
export interface Drop extends DropKind {
  id: string;
  x: number;
  y: number;
  z: number;
}

/** Everything that can drop in a room with this weapon rule (uniform pick). */
export function dropPool(mode: WeaponMode): DropKind[] {
  const pool: DropKind[] = [];
  if (weaponAllowed(mode, WEAPON_PRIMARY)) {
    for (const k of PRIMARY_KINDS) pool.push({ slot: WEAPON_PRIMARY, kind: k });
    pool.push({ slot: WEAPON_GRENADE, kind: GRENADE_DROP_AMOUNT });
  }
  if (weaponAllowed(mode, WEAPON_MELEE)) for (const k of DROP_KINDS) pool.push({ slot: WEAPON_MELEE, kind: k });
  return pool;
}

/** A random drop for the mode (never the plain sword, never the pistol). */
export function pickDropKind(rng: () => number, mode: WeaponMode = 'all'): DropKind {
  const pool = dropPool(mode);
  return pool[Math.floor(rng() * pool.length)];
}

export function dropName(d: DropKind): string {
  if (d.slot === WEAPON_GRENADE) return `Grenades ×${d.kind}`;
  if (d.slot === WEAPON_PRIMARY) return gunSpec(d.kind as GunKind).name;
  return meleeStats(d.kind as MeleeKind).name;
}
```

- [ ] **Step 4: Run** `npm run test -w @mineshoot/shared` → PASS; `npm run build` will now fail in the server (`d.kind = pickDropKind(...)`) — that is fixed in Task 9; until then run `npx tsc --noEmit -p packages/shared` to check shared alone.

---

### Task 5: Bots use the gun they hold

**Files:**
- Modify: `packages/shared/src/bot.ts`, `packages/shared/test/bot.test.ts`

**Interfaces:**
- Consumes: `gunSpec`, `GUN_NONE`, `GUN_PISTOL`, `GunKind` (Task 2); slots (Task 1).
- Produces: `BotView.gun?: GunKind` (primary in slot 1; `GUN_NONE`/absent = empty). `BotDecision` unchanged (`weapon` is the slot).

- [ ] **Step 1: Failing tests** (append to `bot.test.ts`; reuse that file's world/bot fixtures — look at how existing tests build `BotView` with an enemy in sight, then copy that helper)

```ts
  it('brings out the primary gun when it holds one, else the pistol', () => {
    const bot = createBot(createRng(3), spawns, { weapons: 'gun', skill: 'hard' });
    const view = enemyInSight(30); // your fixture: enemy 30 blocks ahead, clear LOS
    expect(bot.compute(world, { ...view, gun: GUN_NONE }, 0.05).weapon).toBe(WEAPON_PISTOL);
    expect(bot.compute(world, { ...view, gun: GUN_RIFLE }, 0.05).weapon).toBe(WEAPON_PRIMARY);
  });
  it('a taser bot closes to point blank before firing', () => {
    const bot = createBot(createRng(3), spawns, { weapons: 'gun', skill: 'hard' });
    const view = { ...enemyInSight(12), gun: GUN_TASER, now: 10_000 };
    let d = bot.compute(world, view, 0.05);
    for (let i = 0; i < 40; i++) d = bot.compute(world, { ...view, now: 10_000 + i * 50 }, 0.05);
    expect(d.shoot).toBe(false); // out of taser range: no shot
    expect(d.input.forward).toBeGreaterThan(0); // closing in
  });
```
(`enemyInSight(dist)` = however the existing tests place an enemy at distance `dist` on the flat test world; if there is no such helper write one next to the tests: `{ self: createPhysState(x, y, z), enemies: [{ id: 'e', x, y, z: z - dist }], now: 10_000 }` with the bot facing -Z.)

- [ ] **Step 2: Run** `npx vitest run test/bot.test.ts -w @mineshoot/shared` → FAIL (`weapon` is 0 for the rifle case; taser bot shoots at 12).

- [ ] **Step 3: Implement** in `bot.ts`

Imports: replace `WEAPON_GUN, WEAPON_SWORD` (already renamed to `WEAPON_PISTOL, WEAPON_MELEE`) and add `WEAPON_PRIMARY`; add `import { GUN_NONE, GUN_PISTOL, gunSpec } from './guns'; import type { GunKind } from './guns';`.

`BotView`: add
```ts
  /** Primary gun held (slot 1); GUN_NONE / absent = empty, the bot uses the pistol. */
  gun?: GunKind;
```
In `compute` after `const carrying = ...`:
```ts
      const gunKind: GunKind = view.gun && view.gun !== GUN_NONE ? view.gun : GUN_PISTOL;
      const gunSlot: Weapon = gunKind === GUN_PISTOL ? WEAPON_PISTOL : WEAPON_PRIMARY;
      const gun = gunSpec(gunKind);
      // Short guns (shotgun, taser) want to be close; long ones keep the usual band.
      const shortGun = gun.range < PREFERRED_MAX * 2;
      const preferredMax = shortGun ? gun.range * 0.8 : PREFERRED_MAX;
      const preferredMin = shortGun ? 0 : PREFERRED_MIN;
```
Replace `let weapon: Weapon = gunOk ? WEAPON_PISTOL : WEAPON_MELEE;` with `let weapon: Weapon = gunOk ? gunSlot : WEAPON_MELEE;`; in the carrying branch `weapon = swordOk ? WEAPON_MELEE : gunSlot;`. In the `else if (best)` branch:
```ts
        const closeIn = !gunOk || best.d > preferredMax || (swordOk && best.d <= SWORD_RANGE * 0.9);
        if (closeIn) navigate(world, self, best, input, dt, now, false);
        else if (best.d < preferredMin && best.d > SWORD_RANGE) input.forward = -0.6;
        if (!closeIn) input.strafe = strafeDir * 0.8;
        ...
        } else if (gunOk) {
          shoot = aligned && reacted && best.d <= gun.range;
        }
```
The server-side per-shot cooldown already gates fire rate; keep `skill.attackIntervalMs` as is.

- [ ] **Step 4: Run** `npm run test -w @mineshoot/shared` → PASS.

---

### Task 6: Protocol messages + `validate.ts`

**Files:**
- Modify: `packages/shared/src/protocol.ts` (messages), `packages/server/src/rooms/validate.ts`, `packages/server/test/validate.test.ts`

**Interfaces (produced):**
```ts
export interface ShootMsg { x; y; z; yaw; pitch; epoch; weapon: Weapon /* WEAPON_PISTOL | WEAPON_PRIMARY */ }
export interface ThrowMsg { x; y; z; yaw; pitch; epoch }
export interface ReloadMsg { epoch: number; weapon: Weapon }
export interface SelectWeaponMsg { epoch: number; slot: Weapon; kind: number }   // replaces SelectMeleeMsg
export interface ShotRay { to: Vec3; hitPlayerId: string; part: HitPart | ''; damage: number }
export interface ShotMsg { shooterId: string; gun: GunKind; from: Vec3; rays: ShotRay[] }
export interface ExplodeMsg { ownerId: string; x; y; z; victims: { id: string; damage: number }[] }
export interface PickupMsg { playerId: string; slot: Weapon; kind: number }
export interface KillMsg extends KillAwards { ...; weapon: Weapon; melee: MeleeKind; gun: GunKind; headshot: boolean }
MSG: + throw: 'throw', explode: 'explode', selectWeapon: 'selectWeapon' (remove selectMelee)
```
- `parseShoot(msg, bounds): ShootMsg | null` (weapon must be a gun slot; missing → `WEAPON_PISTOL`), `parseThrow(msg, bounds): ThrowMsg | null` (= `parsePoseLike`), `parseReload(msg): ReloadMsg | null` (integer epoch + gun slot; a bare integer → `{ epoch, weapon: WEAPON_PISTOL }` for backwards tolerance), `parseSelectWeapon(msg): SelectWeaponMsg | null` (slot MELEE with `isMeleeKind`, or PRIMARY with `isPrimaryKind`).

- [ ] **Step 1: Failing tests** (append to `validate.test.ts`)

```ts
describe('gun/grenade messages', () => {
  const pose = { x: 5, y: 5, z: 5, yaw: 0, pitch: 0, epoch: 1 };
  it('parseShoot keeps a gun slot and defaults to the pistol', () => {
    expect(parseShoot({ ...pose, weapon: WEAPON_PRIMARY })!.weapon).toBe(WEAPON_PRIMARY);
    expect(parseShoot(pose)!.weapon).toBe(WEAPON_PISTOL);
    expect(parseShoot({ ...pose, weapon: WEAPON_MELEE })!.weapon).toBe(WEAPON_PISTOL);
    expect(parseShoot({ ...pose, weapon: WEAPON_GRENADE })!.weapon).toBe(WEAPON_PISTOL);
  });
  it('parseThrow is a pose-like message', () => {
    expect(parseThrow(pose)).toMatchObject({ x: 5, epoch: 1 });
    expect(parseThrow({ ...pose, x: 'a' })).toBeNull();
  });
  it('parseReload accepts {epoch, weapon} for gun slots and a bare epoch for the pistol', () => {
    expect(parseReload({ epoch: 3, weapon: WEAPON_PRIMARY })).toEqual({ epoch: 3, weapon: WEAPON_PRIMARY });
    expect(parseReload(3)).toEqual({ epoch: 3, weapon: WEAPON_PISTOL });
    expect(parseReload({ epoch: 3, weapon: WEAPON_MELEE })).toBeNull();
    expect(parseReload({ epoch: 1.5, weapon: WEAPON_PISTOL })).toBeNull();
  });
  it('parseSelectWeapon takes melee kinds into the melee slot and primary kinds into the primary slot', () => {
    expect(parseSelectWeapon({ epoch: 1, slot: WEAPON_MELEE, kind: MELEE_KATANA })).toEqual({ epoch: 1, slot: WEAPON_MELEE, kind: MELEE_KATANA });
    expect(parseSelectWeapon({ epoch: 1, slot: WEAPON_PRIMARY, kind: GUN_SNIPER })).toEqual({ epoch: 1, slot: WEAPON_PRIMARY, kind: GUN_SNIPER });
    expect(parseSelectWeapon({ epoch: 1, slot: WEAPON_PRIMARY, kind: GUN_PISTOL })).toBeNull();
    expect(parseSelectWeapon({ epoch: 1, slot: WEAPON_GRENADE, kind: 2 })).toBeNull();
    expect(parseSelectWeapon({ epoch: 1, slot: WEAPON_MELEE, kind: 99 })).toBeNull();
  });
});
```
Also update the existing `parseSelectMelee` tests to `parseSelectWeapon` (same expectations with `slot: WEAPON_MELEE`).

- [ ] **Step 2: Run** `npx vitest run test/validate.test.ts -w @mineshoot/server` → FAIL.

- [ ] **Step 3: Implement**

`protocol.ts` (imports: add `import type { GunKind } from './guns';`):
```ts
export interface ShootMsg {
  x: number; y: number; z: number; yaw: number; pitch: number; epoch: number;
  /** Which gun slot fired: WEAPON_PISTOL or WEAPON_PRIMARY. */
  weapon: Weapon;
}
/** Grenade throw: the thrower's pose (the grenade leaves the eye along yaw/pitch). */
export interface ThrowMsg { x: number; y: number; z: number; yaw: number; pitch: number; epoch: number; }
export interface SwingMsg { x: number; y: number; z: number; yaw: number; pitch: number; epoch: number; attack: AttackKind; }
/** Sent when the player starts reloading a gun slot. */
export interface ReloadMsg { epoch: number; weapon: Weapon; }
/** Training rooms only: arm `kind` in `slot` right away (melee kinds → WEAPON_MELEE, PRIMARY_KINDS → WEAPON_PRIMARY). */
export interface SelectWeaponMsg { epoch: number; slot: Weapon; kind: number; }
/** One ray of a shot (a shotgun fires several). */
export interface ShotRay { to: Vec3; hitPlayerId: string; part: HitPart | ''; damage: number; }
export interface ShotMsg { shooterId: string; gun: GunKind; from: Vec3; rays: ShotRay[]; }
/** A grenade burst: where, whose, and who it hurt (damage per victim). */
export interface ExplodeMsg { ownerId: string; x: number; y: number; z: number; victims: { id: string; damage: number }[]; }
/** A player walked over a drop and now holds it (the drop is gone from the state). */
export interface PickupMsg { playerId: string; slot: Weapon; kind: number; }
```
`KillMsg`: add `/** Gun kind for gun kills (GUN_NONE for melee / grenade kills). */ gun: GunKind;`. `SwingMsg` was `extends ShootMsg` — make it standalone as above (so it has no `weapon`). Remove `SelectMeleeMsg` and `MSG.selectMelee`; add `throw: 'throw', explode: 'explode', selectWeapon: 'selectWeapon'` to `MSG`.

`validate.ts`:
```ts
export function parseShoot(msg: unknown, bounds: Bounds = ARENA_BOUNDS): ShootMsg | null {
  const p = parsePoseLike(msg, bounds);
  if (!p) return null;
  const w = (msg as Record<string, unknown>).weapon;
  return { ...p, weapon: isWeapon(w) && isGunSlot(w) ? w : WEAPON_PISTOL };
}
export function parseThrow(msg: unknown, bounds: Bounds = ARENA_BOUNDS): ThrowMsg | null {
  return parsePoseLike(msg, bounds);
}
/** Reload payload: {epoch, weapon} for a gun slot (a bare epoch means the pistol). */
export function parseReload(msg: unknown): ReloadMsg | null {
  if (Number.isInteger(msg)) return { epoch: msg as number, weapon: WEAPON_PISTOL };
  if (typeof msg !== 'object' || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (!Number.isInteger(m.epoch) || !isWeapon(m.weapon) || !isGunSlot(m.weapon)) return null;
  return { epoch: m.epoch as number, weapon: m.weapon };
}
/** Training-range weapon pick: integer epoch + a melee kind for the melee slot or a primary kind for the primary slot. */
export function parseSelectWeapon(msg: unknown): SelectWeaponMsg | null {
  if (typeof msg !== 'object' || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (!Number.isInteger(m.epoch)) return null;
  if (m.slot === WEAPON_MELEE && isMeleeKind(m.kind)) return { epoch: m.epoch as number, slot: WEAPON_MELEE, kind: m.kind };
  if (m.slot === WEAPON_PRIMARY && isPrimaryKind(m.kind)) return { epoch: m.epoch as number, slot: WEAPON_PRIMARY, kind: m.kind };
  return null;
}
```
Keep `parseCharge`/`parseChargeCancel`/`parseDropFlag` as they are (bare epoch); `parseReload` is no longer an alias. `parseSwing` builds `SwingMsg` from `parsePoseLike` exactly as now.

- [ ] **Step 4: Run** the validate tests → PASS. `npm run build` still fails in `ArenaRoom.ts`/client until Tasks 7–12; verify shared + validate with `npx vitest run -w @mineshoot/server test/validate.test.ts` and `npx tsc --noEmit -p packages/shared`.

---

### Task 7: Server — schema, per-slot ammo, gun specs, pellets, taser

**Files:**
- Modify: `packages/server/src/rooms/schema.ts`, `packages/server/src/rooms/ArenaRoom.ts`, `packages/server/test/arenaRoom.integration.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 6.
- Produces: `PlayerSchema.gun: uint8` (GunKind in slot 1), `PlayerSchema.grenades: uint8`; `PlayerMeta.ammo: Record<number, number>`, `reloadDoneAt: Record<number, number>`; `ArenaRoom.gunKindFor(p, slot): GunKind`, `attackShoot(id, p, pose, now, slot)`.

- [ ] **Step 1: Failing integration tests** (append to `describe('arena room')`; use the file's `me`, `poseOf`, `pitchToHeight`, `ready`, `until`, `sleep`, `SKY_Y` helpers; imports: `GUN_SHOTGUN, GUN_SNIPER, GUN_TASER, GUN_NONE, GUN_PISTOL, WEAPON_PRIMARY, gunSpec, WEAPON_PISTOL`)

```ts
  it('shots carry the gun kind and one ray per pellet; the primary slot is empty until a drop', async () => {
    const alice: AnyRoom = await new Client(wsUrl).create(ROOM_NAME, { name: 'guns', durationMin: 3, nickname: 'Alice', testOverrides: { spawnProtectMs: 0 } });
    const shots: ShotMsg[] = [];
    alice.onMessage(MSG.shot, (m: ShotMsg) => shots.push(m));
    alice.onMessage(MSG.kill, () => {});
    try {
      await ready(alice);
      expect(me(alice).gun).toBe(GUN_NONE);
      expect(me(alice).grenades).toBe(2);
      // Primary slot empty: a primary shot is dropped, a pistol shot goes through.
      alice.send(MSG.shoot, { ...poseOf(alice, 32, 40, 0), weapon: WEAPON_PRIMARY });
      alice.send(MSG.shoot, { ...poseOf(alice, 32, 40, 0), weapon: WEAPON_PISTOL });
      await until(() => shots.length === 1, 3000, 'pistol shot');
      await sleep(100);
      expect(shots).toHaveLength(1);
      expect(shots[0].gun).toBe(GUN_PISTOL);
      expect(shots[0].rays).toHaveLength(1);
      expect(shots[0].rays[0].hitPlayerId).toBe('');
    } finally {
      await alice.leave();
    }
  });
  it('training room: a picked shotgun fires 8 rays; the taser is gone after two shots', async () => {
    const alice: AnyRoom = await new Client(wsUrl).create(ROOM_NAME, { name: 'range', durationMin: 3, nickname: 'Alice', mode: 'training', bots: 0, testOverrides: { spawnProtectMs: 0 } });
    const shots: ShotMsg[] = [];
    alice.onMessage(MSG.shot, (m: ShotMsg) => shots.push(m));
    try {
      await ready(alice);
      alice.send(MSG.selectWeapon, { epoch: me(alice).spawnEpoch, slot: WEAPON_PRIMARY, kind: GUN_SHOTGUN });
      await until(() => me(alice).gun === GUN_SHOTGUN, 3000, 'shotgun armed');
      alice.send(MSG.shoot, { ...poseOf(alice, 32, 40, 0), weapon: WEAPON_PRIMARY });
      await until(() => shots.length === 1, 3000, 'shotgun shot');
      expect(shots[0].gun).toBe(GUN_SHOTGUN);
      expect(shots[0].rays).toHaveLength(gunSpec(GUN_SHOTGUN).pellets);
      alice.send(MSG.selectWeapon, { epoch: me(alice).spawnEpoch, slot: WEAPON_PRIMARY, kind: GUN_TASER });
      await until(() => me(alice).gun === GUN_TASER, 3000, 'taser armed');
      alice.send(MSG.shoot, { ...poseOf(alice, 32, 40, 0), weapon: WEAPON_PRIMARY });
      await until(() => shots.length === 2, 3000, 'taser shot 1');
      await sleep(gunSpec(GUN_TASER).cooldownMs);
      alice.send(MSG.shoot, { ...poseOf(alice, 32, 40, 0), weapon: WEAPON_PRIMARY });
      await until(() => shots.length === 3, 3000, 'taser shot 2');
      await until(() => me(alice).gun === GUN_NONE, 3000, 'taser consumed');
      expect(me(alice).weapon).toBe(WEAPON_PISTOL);
      await sleep(gunSpec(GUN_TASER).cooldownMs);
      alice.send(MSG.shoot, { ...poseOf(alice, 32, 40, 0), weapon: WEAPON_PRIMARY });
      await sleep(150);
      expect(shots).toHaveLength(3);
    } finally {
      await alice.leave();
    }
  });
```
Also update the existing shot assertions in this file (`shots[0].hitPlayerId` → `shots[0].rays[0].hitPlayerId`, `.part`, `.damage`; `MSG.reload, epoch` → `{ epoch, weapon: WEAPON_PISTOL }` still works via the bare-integer path but change it anyway; `MSG.selectMelee` → `MSG.selectWeapon` with `{ epoch, slot: WEAPON_MELEE, kind }`; the training-room test that asserts `me(alice).melee`).

- [ ] **Step 2: Run** `npm run test -w @mineshoot/server` → FAIL (typecheck/ runtime).

- [ ] **Step 3: Implement**

`schema.ts` — `PlayerSchema`:
```ts
  /** Primary gun in slot 1 (GunKind): GUN_NONE until a drop / training pick. Reset on every spawn. */
  @type('uint8') gun = GUN_NONE;
  /** Grenades in slot 4. */
  @type('uint8') grenades = GRENADE_START;
```
(import `GUN_NONE`, `GRENADE_START` from `@mineshoot/shared`).

`ArenaRoom.ts`:
- `PlayerMeta`: replace `ammo: number; reloadDoneAt: number;` with
```ts
  /** Rounds left per gun slot (WEAPON_PISTOL / WEAPON_PRIMARY). */
  ammo: Record<number, number>;
  /** When the running reload of each gun slot completes (0 = not reloading). */
  reloadDoneAt: Record<number, number>;
  lastThrowAt: number;
```
  and `freshMeta`: `ammo: { [WEAPON_PISTOL]: GUN_MAG_SIZE, [WEAPON_PRIMARY]: 0 }, reloadDoneAt: { [WEAPON_PISTOL]: 0, [WEAPON_PRIMARY]: 0 }, lastThrowAt: 0`.
- Helper:
```ts
  /** The gun kind in a gun slot: the pistol, or whatever primary the player picked up (GUN_NONE = empty). */
  private gunKindFor(p: PlayerSchema, slot: Weapon): GunKind {
    return slot === WEAPON_PISTOL ? GUN_PISTOL : (p.gun as GunKind);
  }
```
- `takeRound(id, meta, now, slot, spec)`:
```ts
  private takeRound(id: string, meta: PlayerMeta, now: number, slot: Weapon, spec: GunSpec): boolean {
    const done = meta.reloadDoneAt[slot];
    if (done) {
      if (now >= done) {
        meta.ammo[slot] = spec.magSize;
        meta.reloadDoneAt[slot] = 0;
      } else if (meta.ammo[slot] > 0) {
        meta.reloadDoneAt[slot] = 0;
      } else {
        return false;
      }
    }
    if (meta.ammo[slot] <= 0) {
      if (this.bots.has(id) && spec.reloadMs > 0) meta.reloadDoneAt[slot] = now + spec.reloadMs;
      return false;
    }
    meta.ammo[slot]--;
    return true;
  }
```
- `handleReload`:
```ts
  private handleReload(client: Client, raw: unknown): void {
    const m = parseReload(raw);
    if (!m || !weaponAllowed(this.weaponMode, m.weapon)) return;
    const p = this.actor(client, m.epoch);
    if (!p) return;
    const kind = this.gunKindFor(p, m.weapon);
    if (kind === GUN_NONE) return;
    const spec = gunSpec(kind);
    const meta = this.meta.get(client.sessionId)!;
    if (spec.reloadMs === 0 || meta.reloadDoneAt[m.weapon] || meta.ammo[m.weapon] >= spec.magSize) return;
    const now = Date.now();
    meta.reloadDoneAt[m.weapon] = now + spec.serverReloadMinMs;
    this.syncFlags(client.sessionId, p, now);
  }
```
- `syncFlags`: `const reloading = p.alive && Object.values(meta.reloadDoneAt).some((t) => t > 0 && now < t);`
- `handleShoot`: `const m = parseShoot(raw, this.world); if (!m || !weaponAllowed(this.weaponMode, m.weapon)) return; ... this.attackShoot(client.sessionId, p, m, Date.now(), m.weapon);`
- `attackShoot(id, p, pose, now, slot: Weapon)`:
```ts
  private attackShoot(id: string, p: PlayerSchema, pose: PlayerPose, now: number, slot: Weapon): void {
    const meta = this.meta.get(id)!;
    if (this.ctf && carriedFlag(this.flagStates(), id)) return;
    const kind = this.gunKindFor(p, slot);
    if (kind === GUN_NONE) return;
    const spec = gunSpec(kind);
    if (now - meta.lastShotAt < spec.serverMinIntervalMs) return;
    const fired = this.takeRound(id, meta, now, slot, spec);
    this.syncFlags(id, p, now);
    if (!fired) return;
    meta.lastShotAt = now;
    if (p.weapon !== slot) p.weapon = slot;
    this.dropProtection(p, meta);

    const from = eyePosition(pose);
    const targets = this.targetsExcluding(id, now);
    const rays: ShotRay[] = [];
    const hits: { id: string; damage: number; head: boolean }[] = [];
    for (const dir of pelletDirections(pose.yaw, pose.pitch, spec, this.rng)) {
      const r = resolveRay(this.world, from, dir, targets, spec.range, spec.damage);
      rays.push({ to: r.to, hitPlayerId: r.hitPlayerId ?? '', part: r.part ?? '', damage: r.damage });
      if (r.hitPlayerId) hits.push({ id: r.hitPlayerId, damage: r.damage, head: r.part === 'head' });
    }
    const shot: ShotMsg = { shooterId: id, gun: kind, from, rays };
    this.broadcast(MSG.shot, shot);
    for (const h of hits) this.damage(id, h.id, h.damage, slot, h.head, MELEE_SWORD, kind);
    // Consumable (taser): the last charge takes the weapon with it.
    if (spec.consumable && meta.ammo[slot] <= 0) this.clearPrimary(p, meta);
  }

  /** Empty the primary slot (taser spent, death) and fall back to an allowed slot. */
  private clearPrimary(p: PlayerSchema, meta: PlayerMeta): void {
    p.gun = GUN_NONE;
    meta.ammo[WEAPON_PRIMARY] = 0;
    meta.reloadDoneAt[WEAPON_PRIMARY] = 0;
    if (p.weapon === WEAPON_PRIMARY) p.weapon = defaultWeapon(this.weaponMode);
  }
  /** Put `kind` in the primary slot with a full magazine. */
  private armPrimary(p: PlayerSchema, meta: PlayerMeta, kind: GunKind): void {
    p.gun = kind;
    meta.ammo[WEAPON_PRIMARY] = gunSpec(kind).magSize;
    meta.reloadDoneAt[WEAPON_PRIMARY] = 0;
  }
```
- `damage(attackerId, victimId, amount, weapon, headshot, melee = MELEE_SWORD, gun: GunKind = GUN_NONE)` and `kill(..., melee, gun)` → `KillMsg` gets `gun`. Melee calls pass `(…, kind)` as today (gun defaults to `GUN_NONE`).
- `spawn()`: `meta.ammo = { [WEAPON_PISTOL]: GUN_MAG_SIZE, [WEAPON_PRIMARY]: 0 }; meta.reloadDoneAt = { [WEAPON_PISTOL]: 0, [WEAPON_PRIMARY]: 0 }; p.gun = GUN_NONE; p.grenades = GRENADE_START;`.
- Bots (`tickBots`): `const view: BotView = { self: rt.phys, enemies, now, gun: p.gun as GunKind };` and `if (d.shoot) this.attackShoot(id, p, phys, now, d.weapon === WEAPON_PRIMARY ? WEAPON_PRIMARY : WEAPON_PISTOL);`.
- `handleSelectMelee` → `handleSelectWeapon` (registered on `MSG.selectWeapon`):
```ts
  /** Training range: arm any melee / primary kind on request (a match makes you find a drop instead). */
  private handleSelectWeapon(client: Client, raw: unknown): void {
    const m = parseSelectWeapon(raw);
    if (!m) return;
    if (m.slot === WEAPON_MELEE && !meleeSelectable(this.mode, this.weaponMode)) return;
    if (m.slot === WEAPON_PRIMARY && !(this.mode === 'training' && weaponAllowed(this.weaponMode, WEAPON_PRIMARY))) return;
    const p = this.actor(client, m.epoch);
    if (!p) return;
    const meta = this.meta.get(client.sessionId)!;
    if (m.slot === WEAPON_MELEE) {
      if (p.melee === m.kind) return;
      p.melee = m.kind;
      meta.chargeStartAt = 0;
    } else {
      this.armPrimary(p, meta, m.kind as GunKind);
    }
    this.syncFlags(client.sessionId, p, Date.now());
  }
```
- Imports to add: `GUN_NONE, GUN_PISTOL, GRENADE_START, WEAPON_PRIMARY, WEAPON_MELEE, WEAPON_PISTOL, eyePosition, gunSpec, pelletDirections, resolveRay, parseSelectWeapon, parseReload` and types `GunKind, GunSpec, ShotRay`. Remove `GUN_RANGE, GUN_RELOAD_MS, GUN_RELOAD_SERVER_MIN_MS, GUN_SERVER_MIN_INTERVAL_MS, resolveShot, parseSelectMelee` if unused.

- [ ] **Step 4: Run** `npm run test -w @mineshoot/server` → PASS for these tests (drop tests still red until Task 9 — acceptable mid-way; `tsc` will still complain about `pickDropKind` in `spawnDrop` — patch it minimally now: `const k = pickDropKind(this.rng, this.weaponMode); d.slot = k.slot; d.kind = k.kind;` after adding `@type('uint8') slot = WEAPON_MELEE;` to `DropSchema`; the pickup logic is finished in Task 9).

---

### Task 8: Server — grenades (throw, tick, explode)

**Files:**
- Modify: `packages/server/src/rooms/schema.ts`, `packages/server/src/rooms/ArenaRoom.ts`, `packages/server/test/arenaRoom.integration.test.ts`

**Interfaces:**
- Produces: `GrenadeSchema { ownerId: string; x, y, z: float32 }`, `RoomState.grenades: MapSchema<GrenadeSchema>`; `MSG.throw` handler; `MSG.explode` broadcast (`ExplodeMsg`); `ArenaRoom.tickGrenades(now)`.

- [ ] **Step 1: Failing integration test**

```ts
  it('grenades: thrown from slot 4, bounce, burst after the fuse and hurt by distance (thrower included)', async () => {
    const alice: AnyRoom = await new Client(wsUrl).create(ROOM_NAME, { name: 'nades', durationMin: 3, nickname: 'Alice', testOverrides: { spawnProtectMs: 0, respawnMs: 200 } });
    const bursts: ExplodeMsg[] = [];
    alice.onMessage(MSG.explode, (m: ExplodeMsg) => bursts.push(m));
    alice.onMessage(MSG.kill, () => {});
    alice.onMessage(MSG.shot, () => {});
    let bob: AnyRoom | null = null;
    try {
      await ready(alice);
      bob = await new Client(wsUrl).joinById(alice.roomId, { nickname: 'Bob' });
      bob.onMessage(MSG.explode, () => {});
      bob.onMessage(MSG.kill, () => {});
      await until(() => me(bob!) !== undefined, 3000, 'bob');
      await ready(bob);
      // Both stand on the sky plane; Alice lobs one at Bob 3 blocks ahead (it lands near him and cooks off).
      bob.send(MSG.pose, poseOf(bob, 32, 30, 0));
      alice.send(MSG.pose, poseOf(alice, 32, 33, 0));
      await until(() => alice.state.players.get(bob!.sessionId).z === 30, 3000, 'poses');
      alice.send(MSG.throw, { ...poseOf(alice, 32, 33, 0), pitch: -0.9 }); // steep down: lands at Bob's feet
      await until(() => alice.state.grenades.size === 1, 3000, 'grenade in state');
      expect(me(alice).grenades).toBe(1);
      const g = [...alice.state.grenades.values()][0];
      expect(g.ownerId).toBe(alice.sessionId);
      await until(() => bursts.length === 1, GRENADE_FUSE_MS + 2000, 'burst');
      expect(alice.state.grenades.size).toBe(0);
      const b = bursts[0];
      expect(b.ownerId).toBe(alice.sessionId);
      const bobHit = b.victims.find((v) => v.id === bob!.sessionId);
      expect(bobHit).toBeDefined();
      expect(bobHit!.damage).toBeGreaterThan(50);
      const bobHp = alice.state.players.get(bob.sessionId).hp;
      expect(bobHp).toBe(bobHit!.damage >= 100 ? 0 : 100 - bobHit!.damage);
      // A third throw after the second is fine, but stock is limited: 2 at spawn.
      alice.send(MSG.throw, poseOf(alice, 32, 33, 0));
      await until(() => me(alice).grenades === 0, 3000, 'second grenade');
      alice.send(MSG.throw, poseOf(alice, 32, 33, 0));
      await sleep(GRENADE_SERVER_MIN_INTERVAL_MS + 100);
      expect(alice.state.grenades.size).toBe(1); // third throw ignored (empty)
    } finally {
      await bob?.leave();
      await alice.leave();
    }
  });
```
Note: `SKY_Y = 20` is above every structure — the grenade falls to the arena floor below unless it lands on something, so make the burst distance robust: pose Bob directly under the impact is impossible to guarantee. Instead put both players on the ground: use `pickSpawn`-like coordinates from the state (`me(alice).x/y/z`) and Bob 2 blocks away on the same y (`bob.send(MSG.pose, { ...poseOf(bob, ax, az - 2, 0), y: ay })`), throwing at pitch `-1.2` (almost straight down). Adjust the assertions to "Bob damaged > 0".

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

`schema.ts`:
```ts
/** A live grenade (server-simulated; clients just draw it). */
export class GrenadeSchema extends Schema {
  @type('string') ownerId = '';
  @type('float32') x = 0;
  @type('float32') y = 0;
  @type('float32') z = 0;
}
// RoomState:
  @type({ map: GrenadeSchema }) grenades = new MapSchema<GrenadeSchema>();
```
`ArenaRoom.ts`:
```ts
  private readonly grenadeSim = new Map<string, GrenadeState>();
  private grenadeSeq = 0;

  private handleThrow(client: Client, raw: unknown): void {
    if (!weaponAllowed(this.weaponMode, WEAPON_GRENADE)) return;
    const m = parseThrow(raw, this.world);
    if (!m) return;
    const p = this.actor(client, m.epoch);
    if (!p) return;
    this.applyPose(p, m);
    this.throwFrom(client.sessionId, p, m, Date.now());
  }

  /** Server-authoritative grenade throw: stock, carrier lock and rate limit checked here. */
  private throwFrom(id: string, p: PlayerSchema, pose: PlayerPose, now: number): void {
    const meta = this.meta.get(id)!;
    if (this.ctf && carriedFlag(this.flagStates(), id)) return;
    if (p.grenades <= 0 || now - meta.lastThrowAt < GRENADE_SERVER_MIN_INTERVAL_MS) return;
    meta.lastThrowAt = now;
    p.grenades--;
    if (p.weapon !== WEAPON_GRENADE) p.weapon = WEAPON_GRENADE;
    this.dropProtection(p, meta);
    const g = throwGrenade(pose, now);
    const gid = `g${++this.grenadeSeq}`;
    const s = new GrenadeSchema();
    s.ownerId = id;
    s.x = g.x;
    s.y = g.y;
    s.z = g.z;
    this.state.grenades.set(gid, s);
    this.grenadeSim.set(gid, g);
  }

  /** Advance every grenade; burst the ones whose fuse ran out. */
  private tickGrenades(now: number): void {
    if (this.grenadeSim.size === 0) return;
    const dt = SERVER_TICK_MS / 1000 / GRENADE_SUBSTEPS;
    for (const [gid, g0] of this.grenadeSim) {
      let g = g0;
      for (let i = 0; i < GRENADE_SUBSTEPS; i++) g = stepGrenade(this.world, g, dt);
      this.grenadeSim.set(gid, g);
      const s = this.state.grenades.get(gid);
      if (s) {
        s.x = g.x;
        s.y = g.y;
        s.z = g.z;
      }
      if (grenadeFuseDone(g, now)) this.explode(gid, g, now);
    }
  }

  private explode(gid: string, g: GrenadeState, now: number): void {
    const owner = this.state.grenades.get(gid)?.ownerId ?? '';
    this.grenadeSim.delete(gid);
    this.state.grenades.delete(gid);
    const at = { x: g.x, y: g.y, z: g.z };
    // Enemies (no friendly fire in CTF) plus the thrower: your own grenade hurts you.
    const targets = this.targetsExcluding(owner, now);
    const self = this.state.players.get(owner);
    if (self && this.targetable(owner, self, now)) targets.push({ id: owner, pose: { x: self.x, y: self.y, z: self.z } });
    const victims = explosionVictims(this.world, at, targets);
    const msg: ExplodeMsg = { ownerId: owner, ...at, victims };
    this.broadcast(MSG.explode, msg);
    for (const v of victims) this.damage(owner, v.id, v.damage, WEAPON_GRENADE, false);
  }
```
Register `this.onMessage(MSG.throw, (client, raw: unknown) => this.handleThrow(client, raw));` and call `this.tickGrenades(now);` in `tickLifecycle` after `tickDrops`. `kill()`: a self-kill (`killerId === victimId`) must not add a kill — `if (killer && killerId !== victimId) killer.kills++;` (check `KillTracker.recordKill` copes with self; if it counts a streak, pass through unchanged — it's a stat, not a crash). Imports: `GRENADE_SERVER_MIN_INTERVAL_MS, GRENADE_SUBSTEPS, WEAPON_GRENADE, explosionVictims, grenadeFuseDone, stepGrenade, throwGrenade, parseThrow`, types `ExplodeMsg, GrenadeState`; `GrenadeSchema` from `./schema`.

- [ ] **Step 4: Run** the server tests → PASS.

---

### Task 9: Server — slot-aware drops and pickups

**Files:**
- Modify: `packages/server/src/rooms/schema.ts` (`DropSchema.slot`), `packages/server/src/rooms/ArenaRoom.ts`, `packages/server/test/arenaRoom.integration.test.ts`

- [ ] **Step 1: Failing integration tests** (replace `'gun-only rooms never spawn drops'`, extend the melee-drop test)

```ts
  it('gun-only rooms (incl. CTF) drop guns and grenades, never knives; picking a gun fills the primary slot', async () => {
    const alice: AnyRoom = await new Client(wsUrl).create(ROOM_NAME, { name: 'gunsonly', durationMin: 3, nickname: 'Alice', weapons: 'gun', mode: 'ctf', testOverrides: { dropIntervalMs: 60, dropLifetimeMs: 10_000, spawnProtectMs: 0 } });
    const pickups: PickupMsg[] = [];
    alice.onMessage(MSG.pickup, (m: PickupMsg) => pickups.push(m));
    alice.onMessage(MSG.flag, () => {});
    try {
      await ready(alice);
      await until(() => alice.state.drops.size >= 3, 4000, 'drops');
      const drops = [...alice.state.drops.values()];
      for (const d of drops) expect([WEAPON_PRIMARY, WEAPON_GRENADE]).toContain(d.slot);
      const gunDrop = [...alice.state.drops.entries()].find(([, d]) => d.slot === WEAPON_PRIMARY);
      if (gunDrop) {
        const [, d] = gunDrop;
        alice.send(MSG.pose, { x: d.x, y: d.y, z: d.z, yaw: 0, pitch: 0, epoch: me(alice).spawnEpoch, weapon: WEAPON_PISTOL });
        await until(() => pickups.length === 1, 3000, 'pickup');
        expect(pickups[0]).toMatchObject({ playerId: alice.sessionId, slot: WEAPON_PRIMARY, kind: d.kind });
        await until(() => me(alice).gun === d.kind, 3000, 'primary armed');
      }
      const nadeDrop = [...alice.state.drops.values()].find((d) => d.slot === WEAPON_GRENADE);
      if (nadeDrop) {
        alice.send(MSG.pose, { x: nadeDrop.x, y: nadeDrop.y, z: nadeDrop.z, yaw: 0, pitch: 0, epoch: me(alice).spawnEpoch, weapon: WEAPON_PISTOL });
        await until(() => me(alice).grenades === GRENADE_START + GRENADE_DROP_AMOUNT, 3000, 'grenades topped up');
      }
    } finally {
      await alice.leave();
    }
  });
  it('sword-only rooms drop only knives', async () => {
    const alice: AnyRoom = await new Client(wsUrl).create(ROOM_NAME, { name: 'swords', durationMin: 3, nickname: 'Alice', weapons: 'sword', testOverrides: { dropIntervalMs: 60, dropLifetimeMs: 10_000 } });
    try {
      await ready(alice);
      await until(() => alice.state.drops.size >= 2, 4000, 'drops');
      for (const d of alice.state.drops.values()) expect(d.slot).toBe(WEAPON_MELEE);
    } finally {
      await alice.leave();
    }
  });
```
(With `dropIntervalMs: 60` and `DROP_MAX_ACTIVE = 3` / `CTF_DROP_MAX_ACTIVE = 5` several drops appear within a second.) In the existing melee-drop test, assert `pickups[0]` as `{ slot: WEAPON_MELEE, kind: MELEE_… }` and drops as `d.slot === WEAPON_MELEE`; note that in an `'all'` room the drop may now be a gun — restrict that test's room to `weapons: 'sword'` so it keeps testing the melee path.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — `schema.ts` `DropSchema`: add `/** Slot the drop fills: WEAPON_PRIMARY (kind = GunKind), WEAPON_MELEE (MeleeKind) or WEAPON_GRENADE (kind = count). */ @type('uint8') slot = WEAPON_MELEE;`. `ArenaRoom.ts`:

```ts
  /** Something drops in every mode now (guns/grenades, knives, or both). */
  private get dropsEnabled(): boolean {
    return dropPool(this.weaponMode).length > 0;
  }

  private spawnDrop(now: number): void {
    ...
    const k = pickDropKind(this.rng, this.weaponMode);
    d.slot = k.slot;
    d.kind = k.kind;
    ...
  }

  /** Give a drop to `p`; false if they cannot take it (grenades already full). */
  private givePickup(pid: string, p: PlayerSchema, d: DropSchema): boolean {
    const meta = this.meta.get(pid)!;
    if (d.slot === WEAPON_GRENADE) {
      if (p.grenades >= GRENADE_MAX) return false;
      p.grenades = Math.min(GRENADE_MAX, p.grenades + d.kind);
    } else if (d.slot === WEAPON_PRIMARY) {
      this.armPrimary(p, meta, d.kind as GunKind);
    } else {
      p.melee = d.kind;
    }
    return true;
  }
```
and in `tickDrops`: `if (!canPickUp(p, d) || !this.givePickup(pid, p, d)) continue; this.removeDrop(did); const msg: PickupMsg = { playerId: pid, slot: d.slot as Weapon, kind: d.kind }; this.broadcast(MSG.pickup, msg); break;`. Imports: `dropPool, GRENADE_MAX`.

- [ ] **Step 4: Run** `npm run test -w @mineshoot/server` → PASS (all server tests, including the older ones you updated in Task 7). Also `npx tsc --noEmit -p packages/server`.

---

### Task 10: Client — `net.ts` view types + `Weapons` state machine

**Files:**
- Modify: `packages/client/src/net.ts`, `packages/client/src/game/weapons.ts`, `packages/client/test/weapons.test.ts`

**Interfaces:**
- `NetPlayer` + `gun: number; grenades: number;`, `NetDrop` + `slot: number;`, `NetGrenade { ownerId: string; x; y; z }`, `NetRoomState.grenades: MapSchema-like` (mirror how `drops` is typed).
- `Weapons` public API (Produces):
```ts
new Weapons(events: WeaponEvents, allowed: readonly Weapon[] = [...WEAPONS])
current: Weapon; melee: MeleeKind; gun: GunKind (primary, GUN_NONE = empty); grenades: number
select(w), next(dir: 1 | -1), setMelee(kind), setGun(kind), setGrenades(n), setLockedToMelee(b)
mouseDown/mouseUp/altDown/altUp/cancel/reload(now)/resetAmmo()/update(now)
ammoOf(slot): number; magOf(slot): number; ammo (getter → ammoOf(current)); reloadFraction(now); chargeFraction(now); cooldownFraction(now)
get zooming(): boolean; get zoomFactor(): number; get chargeSpeedScale()
canUse(w): boolean  // allowed, not empty (primary needs a gun, grenade needs stock), not locked
events: onFire(slot: Weapon), onThrow(), onChargeStart, onChargeCancel, onSwing(attack), onSwitch(w), onReload(slot: Weapon), onMeleeChange(kind), onGunChange(kind: GunKind), onGrenadesChange(n)
```

- [ ] **Step 1: Failing tests** (rewrite `make()` in `weapons.test.ts` to log the new events — `onFire: (s) => log.push(\`fire:${s}\`)`, `onThrow: () => log.push('throw')`, `onReload: (s) => log.push(\`reload:${s}\`)`, `onGunChange: (k) => log.push(\`gun:${k}\`)`, `onGrenadesChange: (n) => log.push(\`nades:${n}\`)`; update existing expectations `'fire'` → `` `fire:${WEAPON_PISTOL}` `` and `'reload'` → `` `reload:${WEAPON_PISTOL}` ``), then add:

```ts
  it('starts on the pistol; the empty primary and empty grenade slot cannot be selected', () => {
    const { w, log } = make();
    expect(w.current).toBe(WEAPON_PISTOL);
    w.select(WEAPON_PRIMARY);
    expect(w.current).toBe(WEAPON_PISTOL);
    w.setGun(GUN_RIFLE);
    w.select(WEAPON_PRIMARY);
    expect(w.current).toBe(WEAPON_PRIMARY);
    expect(log).toEqual([`gun:${GUN_RIFLE}`, `switch:${WEAPON_PRIMARY}`]);
    w.setGrenades(0);
    w.select(WEAPON_GRENADE);
    expect(w.current).toBe(WEAPON_PRIMARY);
  });
  it('next() cycles through usable slots in key order and skips empty ones', () => {
    const { w } = make();
    // primary empty, grenades 2 → pistol → melee → grenade → pistol
    w.next(1);
    expect(w.current).toBe(WEAPON_MELEE);
    w.next(1);
    expect(w.current).toBe(WEAPON_GRENADE);
    w.next(1);
    expect(w.current).toBe(WEAPON_PISTOL);
    w.next(-1);
    expect(w.current).toBe(WEAPON_GRENADE);
  });
  it('the primary has its own magazine, auto-fires while held and reloads with its own timing', () => {
    const { w, log } = make();
    w.setGun(GUN_RIFLE);
    w.select(WEAPON_PRIMARY);
    const s = gunSpec(GUN_RIFLE);
    expect(w.ammo).toBe(s.magSize);
    w.mouseDown(0);
    w.update(s.cooldownMs + 1);
    w.update(s.cooldownMs * 2 + 2);
    w.mouseUp(s.cooldownMs * 2 + 3);
    expect(log.filter((l) => l === `fire:${WEAPON_PRIMARY}`)).toHaveLength(3);
    expect(w.ammo).toBe(s.magSize - 3);
    expect(w.ammoOf(WEAPON_PISTOL)).toBe(GUN_MAG_SIZE);
    w.reload(1000);
    expect(log.at(-1)).toBe(`reload:${WEAPON_PRIMARY}`);
    w.update(1000 + s.reloadMs - 1);
    expect(w.ammo).toBe(s.magSize - 3);
    w.update(1000 + s.reloadMs);
    expect(w.ammo).toBe(s.magSize);
  });
  it('the pistol does not auto-fire while held', () => {
    const { w, log } = make();
    w.mouseDown(0);
    w.update(GUN_COOLDOWN_MS + 1);
    w.update(GUN_COOLDOWN_MS * 2 + 2);
    w.mouseUp(0);
    expect(log.filter((l) => l.startsWith('fire'))).toHaveLength(1);
  });
  it('taser: two shots then the primary slot empties and we fall back to the pistol', () => {
    const { w, log } = make();
    w.setGun(GUN_TASER);
    w.select(WEAPON_PRIMARY);
    w.mouseDown(0);
    w.mouseUp(1);
    w.mouseDown(2000);
    w.mouseUp(2001);
    expect(log.filter((l) => l === `fire:${WEAPON_PRIMARY}`)).toHaveLength(2);
    expect(w.gun).toBe(GUN_NONE);
    expect(w.current).toBe(WEAPON_PISTOL);
    w.reload(3000); // nothing to reload on the pistol (full)
    expect(log.filter((l) => l.startsWith('reload'))).toHaveLength(0);
  });
  it('grenades: LMB throws one per cooldown, stock counts down, empty slot switches away', () => {
    const { w, log } = make();
    w.select(WEAPON_GRENADE);
    w.mouseDown(0);
    w.mouseUp(1);
    w.mouseDown(10);
    w.mouseUp(11); // inside the throw cooldown
    w.mouseDown(GRENADE_THROW_COOLDOWN_MS + 1);
    w.mouseUp(GRENADE_THROW_COOLDOWN_MS + 2);
    expect(log.filter((l) => l === 'throw')).toHaveLength(2);
    expect(w.grenades).toBe(0);
    expect(w.current).toBe(WEAPON_PISTOL);
    w.setGrenades(2);
    expect(log.at(-1)).toBe('nades:2');
  });
  it('sniper zooms while RMB is held', () => {
    const { w } = make();
    w.setGun(GUN_SNIPER);
    w.select(WEAPON_PRIMARY);
    w.altDown(0);
    expect(w.zooming).toBe(true);
    expect(w.zoomFactor).toBe(gunSpec(GUN_SNIPER).zoom);
    w.altUp(1);
    expect(w.zooming).toBe(false);
    w.select(WEAPON_PISTOL);
    w.altDown(2);
    expect(w.zooming).toBe(false);
  });
  it('setGun/setGrenades come from the server (pickup / respawn) and are idempotent', () => {
    const { w, log } = make();
    w.setGun(GUN_SHOTGUN);
    w.setGun(GUN_SHOTGUN);
    w.setGrenades(2); // already 2
    expect(log).toEqual([`gun:${GUN_SHOTGUN}`]);
    w.select(WEAPON_PRIMARY);
    w.setGun(GUN_NONE); // died / consumed
    expect(w.current).toBe(WEAPON_PISTOL);
  });
```
Also: the CTF lock test(s) still hold (`setLockedToMelee(true)` selects melee; the pistol/primary/grenade won't fire while locked).

- [ ] **Step 2: Run** `npx vitest run test/weapons.test.ts -w @mineshoot/client` → FAIL.

- [ ] **Step 3: Rewrite `packages/client/src/game/weapons.ts`**

```ts
import {
  ATTACK_HEAVY, ATTACK_LIGHT, GRENADE_START, GRENADE_THROW_COOLDOWN_MS, GUN_NONE, GUN_PISTOL,
  MELEE_MIN_CHARGE_FRACTION, MELEE_SWORD, WEAPONS, WEAPON_GRENADE, WEAPON_MELEE, WEAPON_PISTOL, WEAPON_PRIMARY,
  attackSpec, chargeFraction, gunSpec, isGunSlot, meleeChargeMaxMs, meleeStats,
} from '@mineshoot/shared';
import type { AttackKind, GunKind, GunSpec, MeleeKind, MeleeStats, Weapon } from '@mineshoot/shared';

export interface WeaponEvents {
  /** A gun slot fired (WEAPON_PISTOL / WEAPON_PRIMARY). */
  onFire(slot: Weapon): void;
  onThrow(): void;
  onChargeStart(): void;
  onChargeCancel(): void;
  onSwing(attack: AttackKind): void;
  onSwitch(w: Weapon): void;
  onReload(slot: Weapon): void;
  onMeleeChange(kind: MeleeKind): void;
  /** The primary slot now holds `kind` (GUN_NONE = empty). */
  onGunChange(kind: GunKind): void;
  onGrenadesChange(n: number): void;
}

/** Ammo/reload/cooldown bookkeeping for one gun slot. */
interface GunSlot {
  kind: GunKind;
  ammo: number;
  lastFireAt: number;
  reloadStartAt: number | null;
}

/**
 * Local weapon state for the four slots: primary (a picked-up gun, empty at
 * spawn), pistol, melee and grenades. Guns fire on LMB press (auto guns keep
 * firing while held), spend rounds from their own magazine and reload with
 * their own timing; a consumable gun (taser) empties the primary slot with its
 * last round. Grenades throw on LMB per GRENADE_THROW_COOLDOWN_MS while stock
 * lasts. Melee is unchanged (light on LMB, charge/heavy on RMB). RMB on a gun
 * with `zoom > 1` zooms while held. Slots that cannot be used (no primary, no
 * grenades, not allowed by the room, or gun slots while carrying a flag) cannot
 * be selected; when the held slot empties we fall back to the best other slot.
 * The server owns what is in the slots (`setGun`/`setMelee`/`setGrenades`).
 */
export class Weapons {
  current: Weapon;
  melee: MeleeKind = MELEE_SWORD;
  grenades = GRENADE_START;
  private stats: MeleeStats = meleeStats(MELEE_SWORD);
  private readonly guns: Record<number, GunSlot> = {
    [WEAPON_PISTOL]: { kind: GUN_PISTOL, ammo: gunSpec(GUN_PISTOL).magSize, lastFireAt: -Infinity, reloadStartAt: null },
    [WEAPON_PRIMARY]: { kind: GUN_NONE, ammo: 0, lastFireAt: -Infinity, reloadStartAt: null },
  };
  private readonly allowed: readonly Weapon[];
  private lastSwingAt = -Infinity;
  private lastThrowAt = -Infinity;
  private lastAttack: AttackKind = ATTACK_LIGHT;
  private holding = false;
  private chargeStartAt: number | null = null;
  private zoomHeld = false;
  private lockedToMelee = false;

  constructor(private readonly events: WeaponEvents, allowed: readonly Weapon[] = WEAPONS) {
    this.allowed = allowed.length > 0 ? allowed : [WEAPON_PISTOL];
    this.current = this.allowed.includes(WEAPON_PISTOL) ? WEAPON_PISTOL : this.allowed.includes(WEAPON_MELEE) ? WEAPON_MELEE : this.allowed[0];
  }

  get gun(): GunKind { return this.guns[WEAPON_PRIMARY].kind; }
  get canSwitch(): boolean { return this.allowed.length > 1; }
  get meleeLocked(): boolean { return this.lockedToMelee; }
  get charging(): boolean { return this.chargeStartAt !== null; }
  get chargeSpeedScale(): number { return this.stats.chargeSpeedScale; }
  /** Rounds in the held gun slot (0 for melee / grenades). */
  get ammo(): number { return this.ammoOf(this.current); }
  ammoOf(slot: Weapon): number { return this.guns[slot]?.ammo ?? 0; }
  magOf(slot: Weapon): number { const g = this.guns[slot]; return g ? gunSpec(g.kind).magSize : 0; }
  private specOf(slot: Weapon): GunSpec { return gunSpec(this.guns[slot].kind); }
  get zooming(): boolean { return this.zoomHeld && isGunSlot(this.current) && this.specOf(this.current).zoom > 1; }
  get zoomFactor(): number { return this.zooming ? this.specOf(this.current).zoom : 1; }

  /** Allowed by the room, loaded (primary needs a gun, grenade slot needs stock) and not blocked by the flag lock. */
  canUse(w: Weapon): boolean {
    if (!this.allowed.includes(w)) return false;
    if (w === WEAPON_PRIMARY && this.gun === GUN_NONE) return false;
    if (w === WEAPON_GRENADE && this.grenades <= 0) return false;
    if (this.lockedToMelee && w !== WEAPON_MELEE) return false;
    return true;
  }

  setLockedToMelee(locked: boolean): void {
    if (locked === this.lockedToMelee) return;
    this.lockedToMelee = locked;
    if (locked && this.allowed.includes(WEAPON_MELEE)) this.select(WEAPON_MELEE);
  }

  select(w: Weapon): void {
    if (w === this.current || !this.canUse(w)) return;
    this.cancel();
    this.zoomHeld = false;
    for (const g of Object.values(this.guns)) g.reloadStartAt = null;
    this.current = w;
    this.events.onSwitch(w);
  }

  /** Wheel: the next usable slot in key order (dir +1 / -1). */
  next(dir: 1 | -1): void {
    const i = WEAPONS.indexOf(this.current);
    for (let step = 1; step < WEAPONS.length; step++) {
      const w = WEAPONS[(i + dir * step + WEAPONS.length * step) % WEAPONS.length];
      if (this.canUse(w)) { this.select(w); return; }
    }
  }

  /** Legacy toggle (tests / smoke): same as next(1). */
  toggle(): void { this.next(1); }

  /** The held slot became unusable: fall back to pistol → melee → anything usable. */
  private fallBack(): void {
    if (this.canUse(this.current)) return;
    for (const w of [WEAPON_PISTOL, WEAPON_MELEE, WEAPON_PRIMARY, WEAPON_GRENADE] as Weapon[]) {
      if (this.canUse(w)) { this.select(w); return; }
    }
  }

  setMelee(kind: MeleeKind): void {
    if (kind === this.melee) return;
    this.melee = kind;
    this.stats = meleeStats(kind);
    this.dropCharge();
    this.events.onMeleeChange(kind);
  }

  /** Server-driven primary slot: a pickup arms it (full magazine), death / a spent taser empties it. */
  setGun(kind: GunKind): void {
    const g = this.guns[WEAPON_PRIMARY];
    if (kind === g.kind) return;
    g.kind = kind;
    g.ammo = gunSpec(kind).magSize;
    g.reloadStartAt = null;
    g.lastFireAt = -Infinity;
    this.events.onGunChange(kind);
    this.fallBack();
  }

  setGrenades(n: number): void {
    if (n === this.grenades) return;
    this.grenades = n;
    this.events.onGrenadesChange(n);
    this.fallBack();
  }

  mouseDown(now: number): void {
    this.holding = true;
    if (isGunSlot(this.current)) this.tryFire(now);
    else if (this.current === WEAPON_GRENADE) this.tryThrow(now);
    else this.tryLight(now);
  }
  mouseUp(_now: number = performance.now()): void { this.holding = false; }

  /** RMB: melee charge; zoom on a gun that has one; nothing otherwise. */
  altDown(now: number): void {
    if (this.current === WEAPON_MELEE) {
      if (this.chargeStartAt !== null) return;
      this.chargeStartAt = now;
      this.events.onChargeStart();
    } else if (isGunSlot(this.current)) {
      this.zoomHeld = true;
    }
  }
  altUp(now: number = performance.now()): void {
    this.zoomHeld = false;
    if (this.chargeStartAt !== null) this.release(now);
  }

  cancel(): void {
    this.holding = false;
    this.zoomHeld = false;
    this.dropCharge();
  }

  /** Reload the held gun (R, or automatically on empty). No-op if full, reloading, not a gun, or the gun cannot reload. */
  reload(now: number): void {
    if (!isGunSlot(this.current)) return;
    const g = this.guns[this.current];
    const spec = gunSpec(g.kind);
    if (g.kind === GUN_NONE || spec.reloadMs === 0 || g.reloadStartAt !== null || g.ammo >= spec.magSize) return;
    g.reloadStartAt = now;
    this.events.onReload(this.current);
  }

  /** Respawn: full pistol, primary emptied by the server via setGun, grenades via setGrenades. */
  resetAmmo(): void {
    for (const g of Object.values(this.guns)) {
      g.ammo = gunSpec(g.kind).magSize;
      g.reloadStartAt = null;
    }
  }

  update(now: number): void {
    for (const g of Object.values(this.guns)) {
      if (g.reloadStartAt !== null && now - g.reloadStartAt >= gunSpec(g.kind).reloadMs) {
        g.reloadStartAt = null;
        g.ammo = gunSpec(g.kind).magSize;
      }
    }
    if (this.holding) {
      if (isGunSlot(this.current)) { if (this.specOf(this.current).auto) this.tryFire(now); }
      else if (this.current === WEAPON_GRENADE) this.tryThrow(now);
      else this.tryLight(now);
    }
    if (this.chargeStartAt !== null && now - this.chargeStartAt >= meleeChargeMaxMs(this.melee)) this.release(now);
  }

  reloadFraction(now: number): number | null {
    if (!isGunSlot(this.current)) return null;
    const g = this.guns[this.current];
    if (g.reloadStartAt === null) return null;
    return Math.min(1, (now - g.reloadStartAt) / gunSpec(g.kind).reloadMs);
  }
  chargeFraction(now: number): number | null {
    if (this.chargeStartAt === null) return null;
    return Math.min(1, (now - this.chargeStartAt) / this.stats.chargeMs);
  }
  cooldownFraction(now: number): number {
    if (isGunSlot(this.current)) {
      const g = this.guns[this.current];
      return Math.min(1, (now - g.lastFireAt) / gunSpec(g.kind).cooldownMs);
    }
    if (this.current === WEAPON_GRENADE) return Math.min(1, (now - this.lastThrowAt) / GRENADE_THROW_COOLDOWN_MS);
    return Math.min(1, (now - this.lastSwingAt) / attackSpec(this.melee, this.lastAttack).cooldownMs);
  }

  private ready(now: number): boolean { return now - this.lastSwingAt >= attackSpec(this.melee, this.lastAttack).cooldownMs; }
  private tryLight(now: number): void { if (this.chargeStartAt === null && this.ready(now)) this.swing(now, ATTACK_LIGHT); }
  private swing(now: number, attack: AttackKind): void { this.lastSwingAt = now; this.lastAttack = attack; this.events.onSwing(attack); }
  private release(now: number): void {
    const enough = chargeFraction(this.melee, now - this.chargeStartAt!) >= MELEE_MIN_CHARGE_FRACTION;
    this.chargeStartAt = null;
    if (enough && this.ready(now)) this.swing(now, ATTACK_HEAVY);
    else this.events.onChargeCancel();
  }
  private dropCharge(): void {
    if (this.chargeStartAt === null) return;
    this.chargeStartAt = null;
    this.events.onChargeCancel();
  }

  private tryFire(now: number): void {
    if (this.lockedToMelee) return;
    const slot = this.current;
    const g = this.guns[slot];
    const spec = gunSpec(g.kind);
    if (g.kind === GUN_NONE || g.reloadStartAt !== null) return;
    if (g.ammo <= 0) { this.reload(now); return; }
    if (now - g.lastFireAt < spec.cooldownMs) return;
    g.lastFireAt = now;
    g.ammo--;
    this.events.onFire(slot);
    // A consumable gun leaves with its last round (the server confirms via the state patch).
    if (spec.consumable && g.ammo <= 0) this.setGun(GUN_NONE);
  }

  private tryThrow(now: number): void {
    if (this.lockedToMelee || this.grenades <= 0) return;
    if (now - this.lastThrowAt < GRENADE_THROW_COOLDOWN_MS) return;
    this.lastThrowAt = now;
    this.events.onThrow();
    this.setGrenades(this.grenades - 1);
  }
}
```
Note on `next()`: the modulo expression must stay non-negative for `dir = -1`; the `+ WEAPONS.length * step` term guarantees that.

`net.ts`: add to `NetPlayer` `/** Primary gun in slot 1 (GunKind; GUN_NONE = empty). */ gun: number; grenades: number;`, to the drop view type `slot: number;`, and
```ts
export interface NetGrenade { ownerId: string; x: number; y: number; z: number; }
```
with `grenades` on `NetRoomState` typed like `drops`/`flags` (same map-view shape).

- [ ] **Step 4: Run** `npx vitest run test/weapons.test.ts -w @mineshoot/client` → PASS.

---

### Task 11: Client — gun props, view model, remote humanoid, drops view

**Files:**
- Create: `packages/client/src/render/gunProps.ts`, `packages/client/test/gunProps.test.ts`
- Modify: `packages/client/src/render/viewmodel.ts`, `humanoid.ts`, `humanoidAnim.ts`, `dropsView.ts`, `packages/client/test/viewmodel.test.ts`, `humanoid.test.ts`, `dropsView.test.ts`

**Interfaces:**
- Produces: `buildGunProp(kind: GunKind): MeleeProp` (same `{group, glow}` shape as `meleeProps.ts`; modelled grip at origin, barrel down -Z, humanoid scale ≈ 0.6–1.1 long), `buildGrenadeProp(): MeleeProp`, `buildDropProp(slot: Weapon, kind: number): MeleeProp`, `PROP_LENGTH: Record<GunKind, number>` (for the drops view centring). `disposeProp` reused from `meleeProps.ts`.
- `ViewModel.setWeapon(w)`, `setMelee(kind)`, `setGun(kind: GunKind)`; `fire()` uses whichever gun group is visible; `Humanoid.setWeapon(w)`, `setMelee`, `setGun(kind)`; `HumanoidAnim.setWeapon(w)` treats PISTOL/PRIMARY as gun poses, GRENADE as a "held low" pose (arm pitch 0.3), MELEE as today.

- [ ] **Step 1: Failing tests** `packages/client/test/gunProps.test.ts` (mirror `meleeProps.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GUN_KINDS, GUN_NONE, GUN_SHOTGUN, WEAPON_GRENADE, WEAPON_MELEE, WEAPON_PRIMARY, MELEE_AXE } from '@mineshoot/shared';
import { buildDropProp, buildGrenadeProp, buildGunProp } from '../src/render/gunProps';
import { disposeProp } from '../src/render/meleeProps';

describe('gunProps', () => {
  it('builds a distinct mesh group for every gun kind, pointing down -Z', () => {
    const seen = new Set<number>();
    for (const k of GUN_KINDS) {
      const p = buildGunProp(k);
      let meshes = 0;
      p.group.traverse((o) => { if (o instanceof THREE.Mesh) meshes++; });
      expect(meshes).toBeGreaterThan(1);
      const box = new THREE.Box3().setFromObject(p.group);
      expect(box.min.z).toBeLessThan(-0.3);
      expect(box.max.z).toBeLessThan(0.3);
      seen.add(meshes * 100 + Math.round(-box.min.z * 100));
      disposeProp(p);
    }
    expect(seen.size).toBe(GUN_KINDS.length); // no two kinds look identical
    expect(buildGunProp(GUN_NONE).group.children).toHaveLength(0);
  });
  it('grenade prop is a small ball; buildDropProp routes by slot', () => {
    const g = buildGrenadeProp();
    const box = new THREE.Box3().setFromObject(g.group);
    expect(box.max.y - box.min.y).toBeLessThan(0.5);
    expect(buildDropProp(WEAPON_PRIMARY, GUN_SHOTGUN).group.userData.gunProp).toBe(true);
    expect(buildDropProp(WEAPON_MELEE, MELEE_AXE).group.userData.meleeProp).toBe(true);
    expect(buildDropProp(WEAPON_GRENADE, 2).group.userData.grenadeProp).toBe(true);
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement `gunProps.ts`**

```ts
import * as THREE from 'three';
import { GUN_NONE, GUN_PISTOL, GUN_RIFLE, GUN_SHOTGUN, GUN_SMG, GUN_SNIPER, GUN_TASER, WEAPON_GRENADE, WEAPON_PRIMARY } from '@mineshoot/shared';
import type { GunKind, MeleeKind, Weapon } from '@mineshoot/shared';
import { buildMeleeProp } from './meleeProps';
import type { MeleeProp } from './meleeProps';

/*
 * Blocky gun props (and the grenade), shared by the view model, the remote
 * humanoids and the ground drops. Grip at the origin, barrel down -Z, at
 * humanoid scale; holders rotate/scale them into place. `glow` = muzzle
 * material(s) that flash on a shot.
 */
const DARK = 0x2b2b2b;
const GUNMETAL = 0x555a63;
const STEEL = 0x8a919c;
const WOOD = 0x6b4423;
const OLIVE = 0x4f5b3a;
const YELLOW = 0xd9c22a;
const MUZZLE = 0xffd36b;

const box = (w: number, h: number, d: number, color: number): THREE.Mesh =>
  new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
const at = (m: THREE.Mesh, x: number, y: number, z: number): THREE.Mesh => { m.position.set(x, y, z); return m; };
const muzzleFlash = (glow: THREE.MeshLambertMaterial[], z: number): THREE.Mesh => {
  const mat = new THREE.MeshLambertMaterial({ color: MUZZLE, emissive: MUZZLE, emissiveIntensity: 0, transparent: true, opacity: 0 });
  glow.push(mat);
  return at(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), mat), 0, 0.03, z);
};

/** Overall length (blocks) of each prop along -Z; used to centre drops on their spin axis. */
export const PROP_LENGTH: Record<GunKind, number> = {
  [GUN_NONE]: 0, [GUN_PISTOL]: 0.5, [GUN_RIFLE]: 1.05, [GUN_SMG]: 0.7, [GUN_SHOTGUN]: 1.0, [GUN_SNIPER]: 1.3, [GUN_TASER]: 0.45,
};

export function buildGunProp(kind: GunKind): MeleeProp {
  const group = new THREE.Group();
  group.userData.gunProp = true;
  const glow: THREE.MeshLambertMaterial[] = [];
  switch (kind) {
    case GUN_PISTOL:
      group.add(at(box(0.12, 0.16, 0.45, DARK), 0, 0, -0.15), at(box(0.06, 0.06, 0.2, GUNMETAL), 0, 0.03, -0.45), at(box(0.08, 0.16, 0.08, WOOD), 0, -0.14, 0.02), muzzleFlash(glow, -0.6));
      break;
    case GUN_RIFLE:
      group.add(at(box(0.12, 0.16, 0.7, DARK), 0, 0, -0.35), at(box(0.06, 0.06, 0.4, GUNMETAL), 0, 0.03, -0.9), at(box(0.1, 0.22, 0.25, WOOD), 0, -0.05, 0.15), at(box(0.08, 0.16, 0.08, WOOD), 0, -0.16, -0.05), at(box(0.06, 0.2, 0.08, DARK), 0, -0.18, -0.35), muzzleFlash(glow, -1.15));
      break;
    case GUN_SMG:
      group.add(at(box(0.12, 0.14, 0.5, GUNMETAL), 0, 0, -0.25), at(box(0.05, 0.05, 0.25, DARK), 0, 0.03, -0.6), at(box(0.08, 0.14, 0.08, DARK), 0, -0.13, 0), at(box(0.06, 0.26, 0.06, DARK), 0, -0.2, -0.3), at(box(0.04, 0.04, 0.3, STEEL), 0, 0.02, 0.15), muzzleFlash(glow, -0.78));
      break;
    case GUN_SHOTGUN:
      group.add(at(box(0.12, 0.14, 0.45, WOOD), 0, 0, -0.1), at(box(0.09, 0.09, 0.75, GUNMETAL), 0, 0.03, -0.62), at(box(0.09, 0.09, 0.75, GUNMETAL), 0, -0.06, -0.62), at(box(0.1, 0.18, 0.2, WOOD), 0, -0.06, 0.15), at(box(0.1, 0.1, 0.25, WOOD), 0, -0.1, -0.55), muzzleFlash(glow, -1.05));
      break;
    case GUN_SNIPER:
      group.add(at(box(0.11, 0.15, 0.7, OLIVE), 0, 0, -0.3), at(box(0.05, 0.05, 0.75, GUNMETAL), 0, 0.03, -1.0), at(box(0.07, 0.07, 0.3, DARK), 0, 0.14, -0.35), at(box(0.09, 0.2, 0.25, OLIVE), 0, -0.05, 0.15), at(box(0.06, 0.16, 0.06, DARK), 0, -0.14, -0.05), at(box(0.04, 0.16, 0.04, DARK), 0, -0.15, -0.9), muzzleFlash(glow, -1.4));
      break;
    case GUN_TASER:
      group.add(at(box(0.12, 0.14, 0.3, YELLOW), 0, 0, -0.1), at(box(0.1, 0.06, 0.15, DARK), 0, 0.03, -0.32), at(box(0.03, 0.03, 0.12, STEEL), -0.03, 0.03, -0.42), at(box(0.03, 0.03, 0.12, STEEL), 0.03, 0.03, -0.42), at(box(0.08, 0.16, 0.08, DARK), 0, -0.14, 0.02), muzzleFlash(glow, -0.5));
      break;
    default:
      break; // GUN_NONE: nothing in the hand
  }
  return { group, glow };
}

/** A grenade: olive body, dark cap, small lever; ~0.3 tall, centred at the origin. */
export function buildGrenadeProp(): MeleeProp {
  const group = new THREE.Group();
  group.userData.grenadeProp = true;
  group.add(at(box(0.22, 0.26, 0.22, OLIVE), 0, 0, 0), at(box(0.1, 0.08, 0.1, DARK), 0, 0.17, 0), at(box(0.03, 0.14, 0.06, STEEL), 0.06, 0.12, 0));
  return { group, glow: [] };
}

/** The prop for a ground drop, by slot. */
export function buildDropProp(slot: Weapon, kind: number): MeleeProp {
  if (slot === WEAPON_PRIMARY) return buildGunProp(kind as GunKind);
  if (slot === WEAPON_GRENADE) return buildGrenadeProp();
  return buildMeleeProp(kind as MeleeKind);
}
```

- [ ] **Step 4: `viewmodel.ts`** — replace the hand-built `gun` group with three holders: `pistol` (= `buildGunProp(GUN_PISTOL)`), `primary` (prop swapped by `setGun`), `nade` (`buildGrenadeProp()`), plus the melee `sword` group. Keep the flash logic but drive it through the visible gun prop's `glow` materials (`opacity`), and keep `recoil` for the visible gun holder:
```ts
  private readonly pistol = new THREE.Group();
  private readonly primary = new THREE.Group();
  private readonly nade = new THREE.Group();
  private pistolProp = buildGunProp(GUN_PISTOL);
  private primaryProp = buildGunProp(GUN_NONE);
  private nadeProp = buildGrenadeProp();
  private gunKind: GunKind = GUN_NONE;
  private slot: Weapon = WEAPON_PISTOL;
  // constructor: this.pistol.add(this.mountGun(this.pistolProp)); this.primary.add(this.mountGun(this.primaryProp)); this.nade.add(this.nadeProp.group); this.nade.scale.setScalar(0.5); this.nade.position.set(-0.05, -0.05, 0.05);
  // this.group.add(this.pistol, this.primary, this.nade, this.sword, light);
  private mountGun(prop: MeleeProp): THREE.Group { const h = new THREE.Group(); h.scale.setScalar(0.5); h.position.set(0, -0.02, 0.05); h.add(prop.group); return h; }
  setWeapon(w: Weapon): void {
    this.slot = w;
    this.pistol.visible = w === WEAPON_PISTOL;
    this.primary.visible = w === WEAPON_PRIMARY;
    this.nade.visible = w === WEAPON_GRENADE;
    this.sword.visible = w === WEAPON_MELEE;
  }
  setGun(kind: GunKind): void {
    if (kind === this.gunKind) return;
    this.gunKind = kind;
    disposeProp(this.primaryProp);
    this.primary.clear();
    this.primaryProp = buildGunProp(kind);
    this.primary.add(this.mountGun(this.primaryProp));
  }
  private activeGun(): { holder: THREE.Group; prop: MeleeProp } | null {
    if (this.slot === WEAPON_PISTOL) return { holder: this.pistol, prop: this.pistolProp };
    if (this.slot === WEAPON_PRIMARY) return { holder: this.primary, prop: this.primaryProp };
    return null;
  }
  fire(): void { this.recoil = 1; for (const m of this.activeGun()?.prop.glow ?? []) { m.opacity = 1; m.emissiveIntensity = 1; } }
  /** Grenade throw: quick forward flick of the hand. */
  throwAnim(): void { this.recoil = 1; }
```
In `update()`, replace the `this.gun.position/rotation` block with the same maths applied to `activeGun()?.holder` (and to `this.nade` when the grenade is out), and fade every gun glow: `for (const g of [this.pistolProp, this.primaryProp]) for (const m of g.glow) { m.opacity = Math.max(0, m.opacity - dt * 14); m.emissiveIntensity = m.opacity; }`. `dispose()` unchanged (traverses the group). Update `viewmodel.test.ts` expectations for the changed child structure (assert on `visible` flags per slot after `setWeapon(WEAPON_PRIMARY)` etc.).

- [ ] **Step 5: `humanoid.ts` / `humanoidAnim.ts`** — same shape: replace the hand-built gun with `pistol`/`primary`/`nade` holders (position `(0, -0.6, 0)`, rotation.x `-π/2` like today's gun; the grenade holder at `(0, -0.55, 0)` unrotated); `setWeapon(w)` sets visibility (`this.anim.setWeapon(w)`), new `setGun(kind: GunKind)` swaps the primary prop, `shot(now)` flashes the visible gun's glow instead of `this.muzzle`. In `humanoidAnim.ts` treat `WEAPON_PISTOL`/`WEAPON_PRIMARY` as the gun pose (`GUN_IDLE_PITCH`, recoil kick, reload lower), `WEAPON_MELEE` as today, `WEAPON_GRENADE` as arm pitch `GUN_IDLE_PITCH * 0.4` with no kick — i.e. every existing `this.weapon !== WEAPON_MELEE` check stays valid; only add a `const gunOut = this.weapon === WEAPON_PISTOL || this.weapon === WEAPON_PRIMARY;` where kick/reload are computed. `remotePlayers.ts`: track `gun` next to `melee` (`if (p.gun !== r.gun) { r.gun = p.gun as GunKind; r.humanoid.setGun(r.gun); }`), and in `add()`. Update `humanoid.test.ts`/`humanoidAnim.test.ts` for names.

- [ ] **Step 6: `dropsView.ts`** — `add(id, slot: Weapon, kind: number, x, y, z)`: `const prop = buildDropProp(slot, kind);` centring `prop.group.position.z = slot === WEAPON_MELEE ? CENTER_Z : slot === WEAPON_PRIMARY ? PROP_LENGTH[kind as GunKind] / 2 : 0;` roll only for melee (`if (slot === WEAPON_MELEE) prop.group.rotation.z = ROLL;`), grenade drops hover a bit lower (`HOVER_Y - 0.2`) and use a green beacon tint (`0x9be36b`) — keep one shared beacon material and add a second `padMat`/`beaconMat` pair for grenades. Update `dropsView.test.ts` for the new `add` signature.

- [ ] **Step 7: Run** `npm run test -w @mineshoot/client` → PASS for these files (`game.ts` still fails to typecheck until Task 12).

---

### Task 12: Client — game screen wiring, grenades view, HUD, feed, icons

**Files:**
- Create: `packages/client/src/render/grenadesView.ts`
- Modify: `packages/client/src/screens/game.ts`, `packages/client/src/render/tracers.ts` (only if it needs a per-ray API — it already has `spawn(from, to, color)`), `packages/client/src/hud/hud.ts`, `hud/killFeed.ts`, `hud/icons.ts`, `hud/style.css`, `packages/client/test/killFeed.test.ts`, `icons.test.ts`

**Interfaces:**
- `GrenadesView { group; sync(state: Map-like<NetGrenade>); burst(at: Vec3, now); update(now); dispose() }`
- HUD: `setWeapon(w: Weapon, melee: MeleeKind, gun: GunKind)`, `setAmmo(ammo, mag, reloading)` (hidden unless a gun slot), `setGrenades(n)`, `setSlots(usable: Record<Weapon, boolean>, current: Weapon)`, `setWeaponRules(mode, roomMode)` text updated (`1 Primary · 2 Pistol · 3 Melee · 4 Grenade …`, training: `F1–F5 pick primary` — no: use `Digit5..Digit9` for melee picks and `KeyZ/X/C/V/B` for primaries? Keep it simple: melee picks stay on `5–9` (shifted from 3–7 because 3/4 are now slots), primaries on `Z X C V B` (Rifle/SMG/Shotgun/Sniper/Taser)); `showDeath(killerName, weapon, headshot, badges, melee, gun)`.
- Kill feed line: `weapon`/`melee`/`gun` → emoji `🔫` pistol, `🎯` sniper… use: pistol 🔫, rifle 🔫, smg 🔫, shotgun 💥, sniper 🎯, taser ⚡, grenade 💣; `weaponIcon(weapon, melee, gun)`.

- [ ] **Step 1: Failing tests** — `killFeed.test.ts`: `killFeedLine({ ..., weapon: WEAPON_GRENADE, gun: GUN_NONE })` contains `💣`; `weapon: WEAPON_PRIMARY, gun: GUN_TASER` contains `⚡`. `icons.test.ts`: `weaponIcon(WEAPON_PRIMARY, MELEE_SWORD, GUN_SNIPER)` contains `icon-sniper`; `weaponIcon(WEAPON_GRENADE)` contains `icon-grenade`. Run → FAIL.

- [ ] **Step 2: Implement HUD bits**
  - `icons.ts`: add `IconName` entries `'pistol' | 'rifle' | 'smg' | 'shotgun' | 'sniper' | 'taser' | 'grenade'` with 16×16 pixel-rect drawings in the same style as `gun` (copy the existing `gun` art for `pistol`; rifle = longer barrel + stock; smg = short + magazine; shotgun = twin barrel; sniper = long + scope block; taser = short yellow with two prongs; grenade = round olive blob with cap). `GUN_ICONS: Record<GunKind, IconName>`; `weaponIcon(weapon, melee = MELEE_SWORD, gun: number = GUN_NONE, cls = '')`: melee slot → melee icon, grenade slot → `'grenade'`, pistol → `'pistol'`, primary → `GUN_ICONS[gun] ?? 'rifle'`.
  - `killFeed.ts`: `KillLineInput` gains `gun?: GunKind`; `const GUN_EMOJI: Record<GunKind, string> = { [GUN_NONE]: '🔫', [GUN_PISTOL]: '🔫', [GUN_RIFLE]: '🔫', [GUN_SMG]: '🔫', [GUN_SHOTGUN]: '💥', [GUN_SNIPER]: '🎯', [GUN_TASER]: '⚡' };` icon = grenade slot `'💣'`, melee slot as today, gun slots `GUN_EMOJI[k.gun ?? GUN_PISTOL]`. Feed rows that render icons via `weaponIcon` pass `gun`.
  - `hud.ts`: `setWeapon(w, melee = MELEE_SWORD, gun: GunKind = GUN_NONE)`: name/label from `gunSpec(gun).name` for the primary, `'Pistol'` for the pistol, `'Grenade'` for slot 4; `this.ammo.classList.toggle('hidden', !isGunSlot(w))`. New `setGrenades(n)` renders `💣 ×n` in a small `grenades` element next to the ammo box; `setSlots(usable, current)` renders a 4-cell strip (`slots` div, one `span.slot` per `WEAPONS` entry with `1..4`, `.active`/`.empty` classes). `showDeath(..., gun)` uses `weaponIcon(weapon, melee, gun)`. `setWeaponRules`: gun mode `'1 Primary · 2 Pistol · 4 Grenade · wheel to switch · R reload · RMB zoom (sniper)'`, all `'1 Primary · 2 Pistol · 3 Melee · 4 Grenade · wheel · R reload · melee: LMB slash, hold RMB to charge'`, plus training hints `'5–9 pick melee · Z X C V B pick Rifle/SMG/Shotgun/Sniper/Taser'` where selectable. `style.css`: `.slots { display:flex; gap:6px } .slot { padding:2px 6px; border:1px solid rgba(255,255,255,.35); border-radius:4px; opacity:.5 } .slot.active { opacity:1; border-color:#ffd766 } .slot.empty { opacity:.25 }`, `.grenades { margin-top:4px }`, `.zoomed .crosshair { transform: scale(0.6) }`.

- [ ] **Step 3: `grenadesView.ts`**

```ts
import * as THREE from 'three';
import type { Vec3 } from '@mineshoot/shared';
import type { NetGrenade } from '../net';
import { buildGrenadeProp, } from './gunProps';
import { disposeProp } from './meleeProps';
import type { MeleeProp } from './meleeProps';

/** Live grenades from the room state (server-simulated) plus a short expanding blast on MSG.explode. */
export class GrenadesView {
  readonly group = new THREE.Group();
  private readonly live = new Map<string, MeleeProp>();
  private readonly blasts: { mesh: THREE.Mesh; bornAt: number }[] = [];
  private readonly blastGeo = new THREE.SphereGeometry(1, 8, 6);

  sync(grenades: { forEach(cb: (g: NetGrenade, id: string) => void): void } | undefined): void {
    const seen = new Set<string>();
    grenades?.forEach((g, id) => {
      seen.add(id);
      let p = this.live.get(id);
      if (!p) {
        p = buildGrenadeProp();
        this.live.set(id, p);
        this.group.add(p.group);
      }
      p.group.position.set(g.x, g.y, g.z);
    });
    for (const [id, p] of [...this.live]) if (!seen.has(id)) { this.live.delete(id); disposeProp(p); }
  }

  burst(at: Vec3, now: number): void {
    const mesh = new THREE.Mesh(this.blastGeo, new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9, depthWrite: false }));
    mesh.position.set(at.x, at.y, at.z);
    mesh.scale.setScalar(0.3);
    this.group.add(mesh);
    this.blasts.push({ mesh, bornAt: now });
  }

  update(now: number): void {
    for (const p of this.live.values()) p.group.rotation.y = now / 200;
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      const t = (now - b.bornAt) / 350;
      if (t >= 1) { this.group.remove(b.mesh); (b.mesh.material as THREE.Material).dispose(); this.blasts.splice(i, 1); continue; }
      b.mesh.scale.setScalar(0.3 + t * 4);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
    }
  }

  dispose(): void {
    for (const p of this.live.values()) disposeProp(p);
    this.live.clear();
    for (const b of this.blasts) { (b.mesh.material as THREE.Material).dispose(); }
    this.blasts.length = 0;
    this.blastGeo.dispose();
    this.group.removeFromParent();
  }
}
```

- [ ] **Step 4: `game.ts` wiring** (edits, in order of the file):
  - Imports: `GRENADE_MAX`, `GUN_NONE`, `WEAPONS`, `WEAPON_GRENADE`, `WEAPON_MELEE`, `WEAPON_PISTOL`, `WEAPON_PRIMARY`, `PRIMARY_KINDS`, `dropName`, `gunSpec`, `isGunSlot`, types `ExplodeMsg, GunKind, SelectWeaponMsg, ShotRay, ThrowMsg`; `GrenadesView`.
  - Key maps: `const MELEE_PICK_KEYS = ['Digit5','Digit6','Digit7','Digit8','Digit9']` (→ `MELEE_KINDS[i]`), `const PRIMARY_PICK_KEYS = ['KeyZ','KeyX','KeyC','KeyV','KeyB']` (→ `PRIMARY_KINDS[i]`); `const canPickPrimary = roomMode === 'training' && weaponAllowed(weaponMode, WEAPON_PRIMARY);` (offline sandbox: `room === null` counts as training already via `roomMode`).
  - Scene: `const grenades = new GrenadesView(); scene.add(grenades.group);` and dispose in `finish()`.
  - `Weapons` events: `onFire(slot) { viewModel.fire(); if (room) room.send(MSG.shoot, { ...currentPose(), weapon: slot }); else { …offline tracer as today… } }`, `onThrow() { viewModel.throwAnim(); room?.send(MSG.throw, currentPose() as ThrowMsg); }`, `onSwitch(w) { viewModel.setWeapon(w); hud.setWeapon(w, weapons.melee, weapons.gun); }`, `onReload(slot) { room?.send(MSG.reload, { epoch, weapon: slot }); }`, `onMeleeChange(kind) { viewModel.setMelee(kind); hud.setWeapon(weapons.current, kind, weapons.gun); }`, `onGunChange(kind) { viewModel.setGun(kind); hud.setWeapon(weapons.current, weapons.melee, kind); }`, `onGrenadesChange(n) { hud.setGrenades(n); }`.
  - `pickMelee(kind)` → sends `{ epoch, slot: WEAPON_MELEE, kind } as SelectWeaponMsg` on `MSG.selectWeapon`; new `pickPrimary(kind: GunKind)` sends `{ epoch, slot: WEAPON_PRIMARY, kind }`, offline: `weapons.setGun(kind)`; then `weapons.select(WEAPON_PRIMARY)`; toast `gunSpec(kind).name`.
  - Wheel: `look.onWheel = (dir) => weapons.next(dir > 0 ? 1 : -1);` — check `PointerLook.onWheel`'s signature in `input/pointerLock.ts`; if it passes no delta, add the `deltaY` sign as its argument.
  - `onPatch` own player: after `weapons.setMelee(...)`: `weapons.setGun(me.gun as GunKind); weapons.setGrenades(me.grenades);`. Drops: `drops.add(id, d.slot as Weapon, d.kind, d.x, d.y, d.z)`. Grenades: `grenades.sync(state.grenades);`.
  - `onShot(m)`: `const from = m.shooterId === meId ? muzzle() : m.from; let hitMe = 0; let hitOther = false; let head = false; for (const r of m.rays) { tracers.spawn(from, r.to, m.shooterId === meId ? 0xfff2a8 : 0xffb46b); if (r.hitPlayerId === meId) hitMe += r.damage; else if (r.hitPlayerId) { hitOther = true; head ||= r.part === 'head'; blood.burst(r.to, r.damage, { x: r.to.x - from.x, y: r.to.y - from.y, z: r.to.z - from.z }); } } if (m.shooterId === meId && hitOther) hud.hitmark(head); if (hitMe > 0) hud.damageFlash(hitMe); if (m.shooterId !== meId) remotes.shot(m.shooterId, performance.now());`
  - `onExplode(m: ExplodeMsg)`: `grenades.burst(m, performance.now()); const mine = m.victims.find((v) => v.id === meId); if (mine) hud.damageFlash(mine.damage); if (m.ownerId === meId && m.victims.some((v) => v.id !== meId)) hud.hitmark(false); for (const v of m.victims) { const at = v.id === meId ? null : remotes.position(v.id); if (at) blood.burst({ x: at.x, y: at.y + PLAYER_HEIGHT * 0.55, z: at.z }, v.damage, { x: at.x - m.x, y: 0.5, z: at.z - m.z }); }`; register `room.onMessage(MSG.explode, onExplode)`.
  - `onPickup(m)`: `if (m.playerId !== meId) return; if (m.slot === WEAPON_MELEE) { weapons.setMelee(m.kind as MeleeKind); weapons.select(WEAPON_MELEE); } else if (m.slot === WEAPON_PRIMARY) { weapons.setGun(m.kind as GunKind); weapons.select(WEAPON_PRIMARY); } else weapons.setGrenades(Math.min(GRENADE_MAX, weapons.grenades + m.kind)); hud.toast(\`Picked up ${dropName({ slot: m.slot as DropSlot, kind: m.kind })}\`);` (import `DropSlot` type).
  - `onKill`: `hud.showDeath(killerName, m.weapon, m.headshot, badges, m.melee ?? MELEE_SWORD, m.gun ?? GUN_NONE)`; feed line gets `gun: m.gun`.
  - Frame loop keys: `if (keys.wasPressed('Digit1')) weapons.select(WEAPON_PRIMARY); if (keys.wasPressed('Digit2')) weapons.select(WEAPON_PISTOL); if (keys.wasPressed('Digit3')) weapons.select(WEAPON_MELEE); if (keys.wasPressed('Digit4')) weapons.select(WEAPON_GRENADE); if (canPickMelee) MELEE_PICK_KEYS…; if (canPickPrimary) PRIMARY_PICK_KEYS.forEach((code, i) => keys.wasPressed(code) && pickPrimary(PRIMARY_KINDS[i]));`
  - HUD per frame: `hud.setAmmo(weapons.ammo, weapons.magOf(weapons.current), reload !== null); hud.setSlots(Object.fromEntries(WEAPONS.map((w) => [w, weapons.canUse(w)])) as Record<Weapon, boolean>, weapons.current);` Zoom: `const zoom = weapons.zoomFactor; if (camera.fov !== BASE_FOV / zoom) { camera.fov = BASE_FOV / zoom; camera.updateProjectionMatrix(); } container.classList.toggle('zoomed', zoom > 1);` where `BASE_FOV = camera.fov` captured once after `createScene`.
  - Initial: `hud.setWeapon(weapons.current, weapons.melee, weapons.gun); hud.setGrenades(weapons.grenades);`
  - Dev hook: add `pickPrimary`.

- [ ] **Step 5: Run** `npm run test -w @mineshoot/client` and `npm run build` → PASS. Fix any lingering `WEAPON_GUN` in `scripts/smoke.mjs` (grep) — the smoke test uses `__mineshoot.weapons`; if it selects slot `1`, keep it selecting the pistol (`WEAPON_PISTOL = 0` value unchanged, so `weapons.select(0)` still works).

---

### Task 13: Docs + full verification

**Files:**
- Modify: `README.md` (controls table, Gameplay bullets, "Weapon drops" section, CTF note), `AGENTS.md` (code map + "Weapon mode is enforced server-side" paragraph + gotchas), `docs/ARCHITECTURE.md` (combat/messages), `docs/plans/2026-08-19-guns-and-grenades.md` ("Changes made during implementation" section if anything shifted).

- [ ] **Step 1: README** — controls: `1 / 2 / 3 / 4 / wheel` = Primary / Pistol / Melee / Grenade; `RMB` also "zoom (sniper)"; training keys `5–9` melee, `Z X C V B` primaries. Gameplay: replace the **Gun** bullet with **Pistol** (same numbers) and add a **Guns** table (copy the table from the spec's "Guns" section, values from `guns.ts`), a **Grenades** paragraph (2 at spawn, max 4, fuse 2.5 s, radius 4, 100 → 20 dmg, walls block, hurts you too, `Grenades ×2` drops), and rewrite **Weapon drops**: "In every room drops land …; a room that allows guns drops the five primaries and grenade packs; a room that allows melee drops the four blades; Gun + Sword drops both. Primaries fill slot 1 (a new one replaces the old) and are lost on death; the taser vanishes after its two shots." Fix the CTF paragraph that says drops "fall on the central plateau more often" to mention guns.
- [ ] **Step 2: AGENTS.md** — code map lines for `guns.ts`, `grenade.ts`, `drops.ts` (pool by mode), `render/gunProps.ts`, `render/grenadesView.ts`; the "Weapon mode is enforced server-side" paragraph: `weaponAllowed(mode, slot)` over four slots, `throw` gated too; a gotcha: "`WEAPON_PISTOL`/`WEAPON_MELEE` keep values 0/1; `WEAPON_PRIMARY`/`WEAPON_GRENADE` are 2/3 — key order differs from slot value order (`WEAPONS`)".
- [ ] **Step 3: docs/ARCHITECTURE.md** — combat section: per-slot ammo, `ShotMsg.rays`, grenade sim (server ticks 4 sub-steps per 50 ms; `state.grenades` for rendering; `MSG.explode`), drops pool.
- [ ] **Step 4: Verify**: `npm test`, `npm run build`, then `MINESHOOT_TEST=1 make server` + `make client` in the background and `npm run smoke` (must reach results without console errors); stop the servers. Paste the tails in the summary. If Chrome is unavailable, say so explicitly.
- [ ] **Step 5: Manual playtest checklist** (`make start`, offline sandbox `?offline`): pick each primary with Z–B, fire, reload; throw grenades, watch bounce + burst; pick up drops of each slot in an `all` room with bots; taser vanishes after 2 shots; kill feed icons; HUD slot strip; sniper zoom.

---

## Self-review notes

- Spec coverage: slots (T1), guns/pellets (T2), grenades (T3, T8), drops by mode incl. CTF gun-only (T4, T9), bots (T5), messages/validation (T6), server shoot/reload/taser/selectWeapon (T7), client state machine (T10), props/views (T11), game/HUD/feed/icons/zoom (T12), docs+smoke (T13). Bots don't throw grenades (spec: out of scope).
- Type consistency: `ShotRay`, `ShotMsg.rays`, `ExplodeMsg`, `PickupMsg {slot, kind}`, `SelectWeaponMsg {epoch, slot, kind}`, `ReloadMsg {epoch, weapon}`, `KillMsg.gun`, `GunKind`, `DropKind {slot, kind}` are named identically across tasks; `armPrimary`/`clearPrimary`/`gunKindFor`/`givePickup` are defined in T7/T9 and used only there; client `Weapons` API (`setGun`, `setGrenades`, `next`, `canUse`, `ammoOf`, `magOf`, `zoomFactor`) matches T12 usage.

## Progress (2026-08-19, session 1)

- DONE: Tasks 1–10 (shared: slots/guns/grenade/drops/bot; server: schema, validate, ArenaRoom shoot/reload/taser/throw/explode/drops/selectWeapon; client: net.ts + `Weapons` state machine). `npm test` green in shared (150) and server (38); client `weapons.test.ts` (27) and `gunProps.test.ts` green.
- DONE (Task 11 partial): `packages/client/src/render/gunProps.ts` + `test/gunProps.test.ts`.
- Deviations from the plan: server `PlayerMeta.lastShotAt` is per gun slot (`Record<number, number>`) and `armPrimary` resets it, so a fresh primary fires at once; the pistol is semi-auto (`auto: false`) — holding LMB no longer repeats (test updated).
- TODO next: Task 11 rest (viewmodel.ts / humanoid.ts / humanoidAnim.ts / dropsView.ts / remotePlayers.ts use the new props; `dropsView.add(id, slot, kind, x, y, z)`), Task 12 (grenadesView, game.ts wiring, HUD/killFeed/icons), Task 13 (README/AGENTS/ARCHITECTURE, `npm run build`, `npm run smoke`). `npm run build` currently FAILS in the client until Tasks 11–12 land.

## Progress (2026-08-20, session 2)

- DONE: Tasks 11–13 code + docs. All suites green: shared 151, server 39, client 114; `npm run build` green.
- New user requirement (2026-08-20): **gun-only deathmatch spawns roll a random primary** — `spawnPrimary(mode, weapons, rng)` in `guns.ts` (`SPAWN_PRIMARY_KINDS` = rifle/SMG/shotgun/sniper, taser excluded as a dud roll); applied in `ArenaRoom.spawn`; team modes (CTF, future team DM) and `all` rooms keep pistol-only/empty-primary spawns. Covered by a shared test + an integration test.
- Deviations in this session: training primary pick keys are `Z X C V B` (digits 5–9 stayed melee); grenade drops hover lower with a green beacon; `Weapons.next(dir)` replaces `toggle()` for the wheel (empty slots skipped).
- Known cosmetic gap: the offline sandbox (`?offline`) decrements grenade stock but shows no grenade flight/burst (grenades are server-simulated); noted, not fixed.
- Smoke: flaky under load (three dev stacks running — the 12 s match budget expires mid-script, the known issue from AGENTS gotchas); run isolated (`PORT=2611` + `VITE_SERVER_URL=ws://localhost:2611 vite --port 5211` + `SMOKE_URL`) on a quiet machine.
- A parallel session added `nametagVisibility.ts` + humanoid `setColor` in the same tree; its tests are part of the green client run.

## Final (2026-08-20)

- COMPLETE. All tasks + the spawn-roll feature done; the rolled primary is held at spawn (server sets `p.weapon = WEAPON_PRIMARY`, client selects it on the epoch change).
- Verification: `npm test` green (shared 151 / server 39 / client 114), `npm run build` green, `npm run smoke` FULL PASS (all four scenarios, "console errors: none") on an isolated stack with `SMOKE_DURATION_MS=30000` — that env knob was added to `scripts/smoke.mjs` (default 12000 unchanged) because the 12 s budget expires mid-script on a loaded machine; documented in AGENTS.md.
- Not committed (per working agreement).

## Revision (2026-08-20, after user feedback)

- **The `'gun'` (Gun-only) weapon mode is removed** — the user clarified the
  "gun deathmatch" means Guns + Sword (`'all'`). `WEAPON_MODES = ['all',
  'sword']`; `parseWeaponMode('gun')` falls back to `'all'`; the lobby offers
  Guns + Sword / Sword only. `spawnPrimary` now rolls whenever a `match` room
  allows guns (i.e. `'all'`); CTF/training/sword-only unchanged (no roll).
- Fallout: smoke scenario 1 selects the pistol before the scripted headshot
  (deathmatch spawns now hold a rolled primary); the gun-only bot tests and the
  gun-only halves of the weapon-rule tests were removed/reworked; the CTF drop
  test hunts a primary drop out of the mixed 'all' pool.
- Verified after the change: shared 149 / server 39 / client 114, build green.

## Revision 2 (2026-08-20, playtest feedback)

- **Shotgun buffed**: per-pellet damage 30/15/8 → 35/20/10, spread 8° → 6°
  (point-blank torso ≈ one-shot).
- **Sniper scope**: RMB shows a circular scope overlay (black surround + its
  own reticle, `hud .scope`); the default crosshair is hidden whenever a
  zoom-capable gun is held (`Weapons.zoomCapable`, `Hud.setScope`).
- **Grenade wind-up**: hold LMB to charge the throw (speed 10 → 24 over 0.9 s,
  `GRENADE_THROW_MIN/MAX_SPEED`, `GRENADE_THROW_CHARGE_MS`); only release
  throws; holding has no auto-release; weapon switch / pointer unlock cancels
  without spending a grenade. `ThrowMsg.charge` (validated 0..1) → server
  `throwGrenade(pose, now, charge)`. The HUD reuses the melee charge meter.
- **Taser moved to its own slot 5** (`WEAPON_TASER`, key `5`): schema
  `PlayerSchema.taser`, drops fill it (`{slot: WEAPON_TASER, kind: GUN_TASER}`),
  `PRIMARY_KINDS` no longer includes the taser, training pick key `B`; melee
  pick keys shifted to `6`–`0`. Bots ignore the taser slot (they use primary/
  pistol only).
- Verified: shared 149 / server 39 / client 114, build green.
