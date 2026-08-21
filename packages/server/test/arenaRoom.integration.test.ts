import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { Client } from 'colyseus.js';
import type { Room } from 'colyseus.js';
import {
  ATTACK_HEAVY,
  ATTACK_LIGHT,
  EYE_HEIGHT,
  GUN_MAG_SIZE,
  GUN_RELOAD_SERVER_MIN_MS,
  GUN_SERVER_MIN_INTERVAL_MS,
  MSG,
  PLAYER_HALF_W,
  ROOM_NAME,
  SWORD_CHARGE_MS,
  SWORD_SERVER_MIN_INTERVAL_MS,
  WEAPON_PISTOL,
  WEAPON_MELEE,
} from '@mineshoot/shared';
import type { ExplodeMsg, FlagEventMsg, HitMsg, KillMsg, PickupMsg, RoundEventMsg, ShotMsg, SwungMsg } from '@mineshoot/shared';
import { CTF_WORLD_SX, DROP_MAX_ACTIVE, DROP_THROWN_LIFETIME_MS, GRENADE_FUSE_MS, GRENADE_SERVER_MIN_INTERVAL_MS, GRENADE_START, GUN_NONE, GUN_PISTOL, GUN_SHOTGUN, GUN_SNIPER, GUN_TASER, MAX_PLAYERS, MELEE_KATANA, MELEE_STATS, MELEE_SWORD, PLATEAU_MAX, PLATEAU_MIN, SPAWN_PRIMARY_KINDS, TD_WORLD_SZ, TEAM_BLUE, TEAM_RED, WEAPON_GRENADE, WEAPON_PRIMARY, WEAPON_TASER, gunSpec } from '@mineshoot/shared';
import { createApp } from '../src/app';
import type { RoomListEntry } from '../src/app';

process.env.MINESHOOT_TEST = '1';

let gameServer: ReturnType<typeof createApp>['gameServer'];
let wsUrl: string;
let httpUrl: string;

beforeAll(async () => {
  const app = createApp({ gracefullyShutdown: false });
  gameServer = app.gameServer;
  await gameServer.listen(0);
  const port = (app.httpServer.address() as AddressInfo).port;
  wsUrl = `ws://127.0.0.1:${port}`;
  httpUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await gameServer.gracefullyShutdown(false);
});

async function until(cond: () => boolean, timeoutMs = 3000, what = 'condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyRoom = Room<any>;

const SKY_Y = 20; // above every structure: clean hitscan lines

function me(room: AnyRoom): any {
  return room.state?.players?.get(room.sessionId);
}
function poseOf(room: AnyRoom, x: number, z: number, yaw: number, weapon = WEAPON_PISTOL, pitch = 0): Record<string, number> {
  return { x, y: SKY_Y, z, yaw, pitch, epoch: me(room).spawnEpoch, weapon };
}
/** Pitch (yaw 0, shooting toward -Z) that lands the ray `height` above a target's feet `dz` blocks ahead. */
const pitchToHeight = (height: number, dz: number): number => Math.atan2(height - EYE_HEIGHT, dz - PLAYER_HALF_W);
/** Click-to-play: the server spawns us only after MSG.ready. Resolves once we are alive. */
async function ready(room: AnyRoom): Promise<void> {
  await until(() => me(room) !== undefined, 3000, 'own player in state');
  room.send(MSG.ready);
  await until(() => me(room).alive === true, 3000, 'spawned after ready');
}

describe('http', () => {
  it('GET /health returns ok', async () => {
    const res = await fetch(`${httpUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });
});

describe('arena room', () => {
  it('create → list → join → pose sync → gun kill → respawn → sword kill', async () => {
    const alice: AnyRoom = await new Client(wsUrl).create(ROOM_NAME, {
      name: 'Test Room',
      durationMin: 3,
      nickname: 'Alice',
      testOverrides: { respawnMs: 200, spawnProtectMs: 0 },
    });
    const shots: ShotMsg[] = [];
    const hits: HitMsg[] = [];
    const kills: KillMsg[] = [];
    const swings: SwungMsg[] = [];
    alice.onMessage(MSG.shot, (m: ShotMsg) => shots.push(m));
    alice.onMessage(MSG.hit, (m: HitMsg) => hits.push(m));
    alice.onMessage(MSG.kill, (m: KillMsg) => kills.push(m));
    alice.onMessage(MSG.swung, (m: SwungMsg) => swings.push(m));

    let bob: AnyRoom | null = null;
    try {
      await until(() => me(alice) !== undefined, 3000, 'own player in state');
      // Not spawned until "click to play" (MSG.ready): parked at a spawn point, not alive, epoch 0.
      expect(me(alice).alive).toBe(false);
      expect(me(alice).spawnEpoch).toBe(0);
      expect(me(alice).y).toBeGreaterThan(0);
      await ready(alice);
      expect(alice.state.phase).toBe('playing');
      expect(alice.state.name).toBe('Test Room');
      expect(alice.state.durationMin).toBe(3);
      expect(alice.state.seed).toBeGreaterThan(0);
      expect(alice.state.timeLeftMs).toBeGreaterThan(170_000);
      const a = me(alice);
      expect(a.name).toBe('Alice');
      expect(a.alive).toBe(true);
      expect(a.spawnEpoch).toBe(1);
      expect(a.y).toBeGreaterThan(0);

      // Lobby listing with metadata
      const rooms = (await (await fetch(`${httpUrl}/rooms`)).json()) as RoomListEntry[];
      const listed = rooms.find((r) => r.roomId === alice.roomId)!;
      expect(listed).toBeDefined();
      expect(listed.clients).toBe(1);
      expect(listed.metadata.name).toBe('Test Room');
      expect(listed.metadata.durationMin).toBe(3);
      expect(listed.metadata.endsAt).toBeGreaterThan(Date.now());

      // Bob joins mid-match
      bob = await new Client(wsUrl).joinById(alice.roomId, { nickname: '  Bob<>  ' });
      const bobKills: KillMsg[] = [];
      bob.onMessage(MSG.kill, (m: KillMsg) => bobKills.push(m));
      bob.onMessage(MSG.shot, () => {});
      bob.onMessage(MSG.hit, () => {});
      await until(() => alice.state.players.size === 2 && me(bob!) !== undefined, 3000, 'bob visible');
      await ready(bob);
      expect(alice.state.players.get(bob.sessionId).name).toBe('Bob');
      expect(alice.state.players.get(bob.sessionId).color).not.toBe(a.color);

      // Pose sync (Bob moves; Alice sees it). Wrong epoch is ignored.
      bob.send(MSG.pose, poseOf(bob, 32, 30, 0));
      await until(() => Math.abs(alice.state.players.get(bob!.sessionId).x - 32) < 0.01, 3000, 'bob pose synced');
      expect(alice.state.players.get(bob.sessionId).z).toBeCloseTo(30, 3);
      bob.send(MSG.pose, { ...poseOf(bob, 5, 5, 0), epoch: 99 });
      await sleep(150);
      expect(alice.state.players.get(bob.sessionId).x).toBeCloseTo(32, 3);

      const bobView = (): any => alice.state.players.get(bob!.sessionId);
      expect(bobView().hp).toBe(100);

      // Alice shoots Bob in the chest (yaw 0 → -Z, 10 blocks ahead), two shots quickly: 2nd is rate-limited.
      const chest = poseOf(alice, 32, 40, 0, WEAPON_PISTOL, pitchToHeight(1.0, 10));
      alice.send(MSG.shoot, chest);
      alice.send(MSG.shoot, chest);
      await until(() => shots.length === 1, 3000, 'shot broadcast');
      await sleep(100);
      expect(shots).toHaveLength(1);
      expect(shots[0].shooterId).toBe(alice.sessionId);
      expect(shots[0].gun).toBe(GUN_PISTOL);
      expect(shots[0].rays).toHaveLength(1);
      expect(shots[0].rays[0].hitPlayerId).toBe(bob.sessionId);
      expect(shots[0].rays[0].part).toBe('torso');
      expect(shots[0].rays[0].damage).toBe(30);
      await until(() => bobView().hp === 70, 3000, 'bob hp 70');
      expect(bobView().alive).toBe(true);
      expect(kills).toHaveLength(0);

      // After the rate limit lapses, a level shot is a headshot: 100 damage → kill.
      await sleep(250);
      alice.send(MSG.shoot, poseOf(alice, 32, 40, 0));
      await until(() => kills.length === 1, 3000, 'kill broadcast');
      await sleep(100);
      expect(shots).toHaveLength(2);
      expect(shots[1].rays[0]).toMatchObject({ hitPlayerId: bob.sessionId, part: 'head', damage: 100 });
      expect(kills[0]).toMatchObject({
        killerId: alice.sessionId,
        killerName: 'Alice',
        victimId: bob.sessionId,
        victimName: 'Bob',
        weapon: WEAPON_PISTOL,
        headshot: true,
        multi: 1,
        streak: 1,
        revenge: false,
        shutdown: false,
      });
      await until(() => bobKills.length === 1, 3000, 'bob got kill msg');
      await until(() => me(alice).kills === 1, 3000, 'alice kills');
      await until(() => bobView().deaths === 1, 3000, 'bob deaths');
      // Bob might have respawned already (200ms), so check the death happened via counters, then respawn.
      await until(() => bobView().alive === true && bobView().spawnEpoch === 2, 3000, 'bob respawned');
      await until(() => me(bob!).spawnEpoch === 2, 3000, 'bob sees own epoch');
      expect(bobView().hp).toBe(100); // respawn restores full health

      // Poses sent while dead / with the stale epoch were dropped: Bob is at a spawn point, not (32,30).
      expect(Math.abs(bobView().x - 32) > 0.01 || Math.abs(bobView().z - 30) > 0.01).toBe(true);

      // Sword: Bob walks up in front of Alice. A plain (level) light swing lands on the head for 45.
      await sleep(350); // let gun cooldown lapse (irrelevant for sword but keeps timings sane)
      alice.send(MSG.pose, poseOf(alice, 32, 40, 0));
      bob.send(MSG.pose, poseOf(bob, 32, 42, 0, WEAPON_MELEE)); // 2 blocks behind Alice, facing -Z toward her
      await until(() => Math.abs(bobView().z - 42) < 0.01, 3000, 'bob repositioned');
      // Claiming the heavy without having announced a charge lands as a light slash.
      bob.send(MSG.swing, { ...poseOf(bob, 32, 42, 0), attack: ATTACK_HEAVY });
      await until(() => hits.length === 1, 3000, 'sword hit');
      expect(hits[0]).toMatchObject({ attackerId: bob.sessionId, victimId: alice.sessionId, part: 'head', damage: 45, attack: ATTACK_LIGHT });
      await until(() => me(alice).hp === 55, 3000, 'alice hp 55');
      expect(kills).toHaveLength(1);

      // Heavy swing: announce the charge, hold ≥ SWORD_CHARGE_MS, release aiming at the chest → 70 → kill.
      bob.send(MSG.charge, me(bob).spawnEpoch);
      await sleep(SWORD_CHARGE_MS + 100);
      bob.send(MSG.swing, { ...poseOf(bob, 32, 42, 0, WEAPON_MELEE, pitchToHeight(1.0, 2)), attack: ATTACK_HEAVY });
      await until(() => kills.length === 2, 3000, 'sword kill');
      expect(hits[1]).toMatchObject({ victimId: alice.sessionId, part: 'body', damage: 70, attack: ATTACK_HEAVY });
      // Body hit, and Bob was last killed by Alice → revenge.
      expect(kills[1]).toMatchObject({
        killerId: bob.sessionId,
        victimId: alice.sessionId,
        weapon: WEAPON_MELEE,
        headshot: false,
        multi: 1,
        streak: 1,
        revenge: true,
        shutdown: false,
      });
      await until(() => me(alice).deaths === 1 && me(bob!).kills === 1, 3000, 'counters');
      await until(() => me(alice).alive && me(alice).spawnEpoch === 2, 3000, 'alice respawned');

      // Light swings repeat while LMB is held; the light's own recovery gates each one server-side.
      alice.send(MSG.pose, poseOf(alice, 32, 40, 0));
      bob.send(MSG.pose, poseOf(bob, 32, 42, 0, WEAPON_MELEE));
      await until(() => Math.abs(bobView().z - 42) < 0.01, 3000, 'bob back behind alice');
      await sleep(SWORD_SERVER_MIN_INTERVAL_MS);
      const swungBefore = swings.length;
      bob.send(MSG.swing, { ...poseOf(bob, 32, 42, 0, WEAPON_MELEE), attack: ATTACK_LIGHT });
      bob.send(MSG.swing, { ...poseOf(bob, 32, 42, 0, WEAPON_MELEE), attack: ATTACK_LIGHT }); // too soon: dropped
      await until(() => hits.length === 3, 3000, 'third hit');
      await sleep(100);
      expect(swings).toHaveLength(swungBefore + 1);
      expect(hits[2]).toMatchObject({ victimId: alice.sessionId, part: 'head', damage: 45, attack: ATTACK_LIGHT, melee: MELEE_SWORD });
      await sleep(SWORD_SERVER_MIN_INTERVAL_MS + 20);
      bob.send(MSG.swing, { ...poseOf(bob, 32, 42, 0, WEAPON_MELEE), attack: ATTACK_LIGHT });
      await until(() => hits.length === 4, 3000, 'fourth hit');
      expect(swings).toHaveLength(swungBefore + 2);

      // A heavy released after half the charge still lands as a heavy, at about half damage (body 70 → ~35; Alice is at 10 HP → kill).
      await sleep(SWORD_SERVER_MIN_INTERVAL_MS + 20);
      bob.send(MSG.charge, me(bob).spawnEpoch);
      await sleep(SWORD_CHARGE_MS / 2);
      bob.send(MSG.swing, { ...poseOf(bob, 32, 42, 0, WEAPON_MELEE, pitchToHeight(1.0, 2)), attack: ATTACK_HEAVY });
      await until(() => hits.length === 5, 3000, 'partial heavy hit');
      expect(hits[4]).toMatchObject({ victimId: alice.sessionId, part: 'body', attack: ATTACK_HEAVY, melee: MELEE_SWORD });
      expect(hits[4].damage).toBeGreaterThanOrEqual(28);
      expect(hits[4].damage).toBeLessThanOrEqual(42);
      await until(() => kills.length === 3, 3000, 'third kill');
      await until(() => me(alice).alive && me(alice).spawnEpoch === 3, 5000, 'alice respawned again');
      alice.send(MSG.pose, poseOf(alice, 32, 40, 0));
      bob.send(MSG.pose, poseOf(bob, 32, 42, 0, WEAPON_MELEE));
      await until(() => Math.abs(me(alice).z - 40) < 0.01 && Math.abs(bobView().z - 42) < 0.01, 3000, 'both repositioned');
      // Released almost at once (under the minimum fraction): it is only a light.
      await sleep(SWORD_SERVER_MIN_INTERVAL_MS + 20);
      bob.send(MSG.charge, me(bob).spawnEpoch);
      bob.send(MSG.swing, { ...poseOf(bob, 32, 42, 0, WEAPON_MELEE, pitchToHeight(1.0, 2)), attack: ATTACK_HEAVY });
      await until(() => hits.length === 6, 3000, 'tap heavy → light');
      expect(hits[5]).toMatchObject({ victimId: alice.sessionId, part: 'body', damage: 30, attack: ATTACK_LIGHT });
      await until(() => me(alice).hp === 70, 3000, 'alice hp 70');

      // ping/pong
      let pong = -1;
      alice.onMessage(MSG.pong, (t: number) => (pong = t));
      alice.send(MSG.ping, 12345);
      await until(() => pong === 12345, 2000, 'pong');

      // Bob leaves → removed from state
      await bob.leave();
      const left = bob;
      bob = null;
      await until(() => !alice.state.players.has(left.sessionId), 3000, 'bob removed');
    } finally {
      await bob?.leave();
      await alice.leave();
    }
  }, 15000);

  it('drops melee weapons mid-arena; walking over one arms you until you die', async () => {
    const alice: AnyRoom = await new Client(wsUrl).create(ROOM_NAME, {
      nickname: 'Alice',
      durationMin: 3,
      testOverrides: { respawnMs: 200, spawnProtectMs: 0, dropIntervalMs: 100, dropLifetimeMs: 1500 },
    });
    const pickups: PickupMsg[] = [];
    const hits: HitMsg[] = [];
    const kills: KillMsg[] = [];
    alice.onMessage(MSG.pickup, (m: PickupMsg) => pickups.push(m));
    alice.onMessage(MSG.hit, (m: HitMsg) => hits.push(m));
    alice.onMessage(MSG.kill, (m: KillMsg) => kills.push(m));
    alice.onMessage(MSG.shot, () => {});
    alice.onMessage(MSG.swung, () => {});
    let bob: AnyRoom | null = null;
    try {
      await ready(alice);
      expect(me(alice).melee).toBe(MELEE_SWORD);
      // Drops appear on the central plateau and are capped; in an 'all' room guns and knives both drop — wait for a knife.
      await until(() => alice.state.drops.size >= 1, 3000, 'first drop');
      await sleep(600);
      expect(alice.state.drops.size).toBeLessThanOrEqual(DROP_MAX_ACTIVE);
      let dropId = '';
      let drop: any = null;
      await until(() => {
        drop = null;
        alice.state.drops.forEach((d: any, id: string) => {
          if (!drop && d.slot === WEAPON_MELEE) {
            drop = d;
            dropId = id;
          }
        });
        return drop !== null;
      }, 8000, 'a melee drop');
      expect(drop.kind).not.toBe(MELEE_SWORD);
      expect(drop.x).toBeGreaterThanOrEqual(PLATEAU_MIN);
      expect(drop.x).toBeLessThanOrEqual(PLATEAU_MAX + 1);
      expect(drop.z).toBeGreaterThanOrEqual(PLATEAU_MIN);
      expect(drop.z).toBeLessThanOrEqual(PLATEAU_MAX + 1);
      const kind = drop.kind as number;

      // Walk onto it: picked up, gone from the state, everyone told.
      alice.send(MSG.pose, { x: drop.x, y: drop.y, z: drop.z, yaw: 0, pitch: 0, epoch: me(alice).spawnEpoch, weapon: WEAPON_MELEE });
      await until(() => pickups.length === 1, 3000, 'pickup broadcast');
      expect(pickups[0]).toEqual({ playerId: alice.sessionId, slot: WEAPON_MELEE, kind });
      await until(() => me(alice).melee === kind, 3000, 'melee synced');
      expect(alice.state.drops.has(dropId)).toBe(false);

      // The new weapon's own damage table applies: Bob stands 2 blocks ahead in the sky, light swing to the head.
      bob = await new Client(wsUrl).joinById(alice.roomId, { nickname: 'Bob' });
      bob.onMessage(MSG.shot, () => {});
      bob.onMessage(MSG.hit, () => {});
      bob.onMessage(MSG.kill, () => {});
      bob.onMessage(MSG.swung, () => {});
      bob.onMessage(MSG.pickup, () => {});
      await until(() => me(bob!) !== undefined && alice.state.players.has(bob!.sessionId), 3000, 'bob in state');
      await ready(bob);
      const bobView = (): any => alice.state.players.get(bob!.sessionId);
      bob.send(MSG.pose, poseOf(bob, 32, 40, 0));
      await until(() => Math.abs(bobView().x - 32) < 0.01 && Math.abs(bobView().y - SKY_Y) < 0.01, 3000, 'bob in the sky');
      alice.send(MSG.pose, poseOf(alice, 32, 42, 0, WEAPON_MELEE));
      await until(() => Math.abs(me(alice).z - 42) < 0.01, 3000, 'alice behind bob');
      alice.send(MSG.swing, { ...poseOf(alice, 32, 42, 0, WEAPON_MELEE), attack: ATTACK_LIGHT });
      await until(() => hits.length === 1, 3000, 'melee hit');
      const expected = MELEE_STATS[kind as keyof typeof MELEE_STATS].attacks[ATTACK_LIGHT].damage.head;
      expect(hits[0]).toMatchObject({ attackerId: alice.sessionId, victimId: bob.sessionId, part: 'head', damage: expected, attack: ATTACK_LIGHT, melee: kind });
      // Kill messages carry the melee kind (Bob's gun kill reports the sword slot as MELEE_SWORD).
      bob.send(MSG.pose, poseOf(bob, 32, 44, 0)); // turn around: 2 blocks behind Alice, facing -Z at her
      await until(() => Math.abs(bobView().z - 44) < 0.01, 3000, 'bob repositioned');
      bob.send(MSG.shoot, poseOf(bob, 32, 44, 0));
      await until(() => kills.length === 1, 3000, 'alice killed');
      expect(kills[0]).toMatchObject({ killerId: bob.sessionId, victimId: alice.sessionId, weapon: WEAPON_PISTOL, melee: MELEE_SWORD });
      // Death loses the drop weapon.
      await until(() => me(alice).alive && me(alice).spawnEpoch === 2, 3000, 'alice respawned');
      expect(me(alice).melee).toBe(MELEE_SWORD);
    } finally {
      await bob?.leave();
      await alice.leave();
    }
  }, 15000);

  it('CTF rooms drop from the full pool (guns, grenade packs, knives); picking a gun fills the primary slot', async () => {
    const alice: AnyRoom = await new Client(wsUrl).create(ROOM_NAME, {
      name: 'ctfdrops',
      durationMin: 3,
      nickname: 'Alice',
      weapons: 'all',
      mode: 'ctf',
      testOverrides: { dropIntervalMs: 60, dropLifetimeMs: 3_000, spawnProtectMs: 0 },
    });
    const pickups: PickupMsg[] = [];
    alice.onMessage(MSG.pickup, (m: PickupMsg) => pickups.push(m));
    alice.onMessage(MSG.flag, () => {});
    const stepOn = (d: { x: number; y: number; z: number }): void =>
      alice.send(MSG.pose, { x: d.x, y: d.y, z: d.z, yaw: 0, pitch: 0, epoch: me(alice).spawnEpoch, weapon: WEAPON_PISTOL });
    try {
      await ready(alice);
      // CTF spawns are pistol-only (no deathmatch roll).
      expect(me(alice).gun).toBe(GUN_NONE);
      await until(() => alice.state.drops.size >= 3, 4000, 'drops');
      for (const d of alice.state.drops.values()) expect([WEAPON_PRIMARY, WEAPON_GRENADE, WEAPON_MELEE, WEAPON_TASER]).toContain((d as any).slot);
      // Hunt a primary drop: occupied slots never auto-swap now, so wait for one
      // to spawn (the short lifetime keeps the ground churning past the cap) and
      // step on it while it is fresh; retry if it expired under us.
      const deadline = Date.now() + 15_000;
      while (me(alice).gun === GUN_NONE && Date.now() < deadline) {
        const primary = [...alice.state.drops.entries()].find(([, d]) => (d as any).slot === WEAPON_PRIMARY);
        if (!primary) {
          await sleep(50);
          continue;
        }
        const [id, d] = primary;
        stepOn(d as any);
        await until(() => !alice.state.drops.has(id), 4000, 'primary drop picked up or expired');
      }
      expect(me(alice).gun).not.toBe(GUN_NONE);
      expect(pickups.find((p) => p.slot === WEAPON_PRIMARY)).toMatchObject({ playerId: alice.sessionId, slot: WEAPON_PRIMARY, kind: me(alice).gun });
    } finally {
      await alice.leave();
    }
  }, 20000);

  it('G throws the held gun down; only an empty slot auto-picks up, the thrower waits out a grace, thrown guns expire', async () => {
    const alice: AnyRoom = await new Client(wsUrl).create(ROOM_NAME, {
      name: 'gdrop',
      durationMin: 3,
      nickname: 'Alice',
      weapons: 'all',
      // No random drops: the only weapons on the ground are the thrown ones.
      testOverrides: { spawnProtectMs: 0, dropIntervalMs: 600_000 },
    });
    alice.onMessage(MSG.pickup, () => {});
    let bob: AnyRoom | null = null;
    try {
      await ready(alice);
      const aliceKind = me(alice).gun as number;
      expect(SPAWN_PRIMARY_KINDS).toContain(aliceKind);
      bob = await new Client(wsUrl).joinById(alice.roomId, { nickname: 'Bob' });
      bob.onMessage(MSG.pickup, () => {});
      await until(() => me(bob!) !== undefined, 3000, 'bob in state');
      await ready(bob);
      const bobView = (): any => alice.state.players.get(bob!.sessionId);
      const bobKind = me(bob).gun as number;
      // Bob walks up to Alice and throws his gun at her feet.
      const spot = { x: me(alice).x, y: me(alice).y, z: me(alice).z };
      bob.send(MSG.pose, { ...spot, yaw: 0, pitch: 0, epoch: me(bob).spawnEpoch, weapon: WEAPON_PRIMARY });
      await until(() => Math.abs(bobView().x - spot.x) < 0.01, 3000, 'bob at alice');
      bob.send(MSG.dropWeapon, { epoch: me(bob).spawnEpoch, slot: WEAPON_PRIMARY });
      await until(() => alice.state.drops.size === 1, 3000, 'thrown gun on the ground');
      const thrown = [...alice.state.drops.values()][0] as any;
      expect(thrown).toMatchObject({ slot: WEAPON_PRIMARY, kind: bobKind });
      expect(bobView().gun).toBe(GUN_NONE);
      // Alice's primary slot is full and Bob is inside his own grace: nobody picks it up.
      await sleep(400);
      expect(alice.state.drops.size).toBe(1);
      expect(me(alice).gun).toBe(aliceKind);
      // Alice throws hers too: her freed slot takes Bob's gun right away, and
      // Bob's empty slot takes hers (his grace only guards his own throw).
      alice.send(MSG.dropWeapon, { epoch: me(alice).spawnEpoch, slot: WEAPON_PRIMARY });
      await until(() => me(alice).gun === bobKind, 3000, 'alice took the thrown gun');
      await until(() => bobView().gun === aliceKind, 4000, 'bob re-armed after the grace');
      expect(alice.state.drops.size).toBe(0);
      // A thrown gun nobody wants vanishes after DROP_THROWN_LIFETIME_MS.
      alice.send(MSG.dropWeapon, { epoch: me(alice).spawnEpoch, slot: WEAPON_PRIMARY });
      await until(() => alice.state.drops.size === 1, 3000, 'second throw on the ground');
      alice.send(MSG.pose, poseOf(alice, 5, 5, 0));
      await until(() => alice.state.drops.size === 0, DROP_THROWN_LIFETIME_MS + 2000, 'thrown gun expired');
      expect(me(alice).gun).toBe(GUN_NONE);
    } finally {
      await bob?.leave();
      await alice.leave();
    }
  }, 25000);

  it('a deathmatch with guns spawns you with a random primary; bots get one too', async () => {
    const alice: AnyRoom = await new Client(wsUrl).create(ROOM_NAME, {
      name: 'roll',
      durationMin: 3,
      nickname: 'Alice',
      weapons: 'all',
      bots: 1,
      testOverrides: { spawnProtectMs: 0 },
    });
    try {
      await ready(alice);
      expect(SPAWN_PRIMARY_KINDS).toContain(me(alice).gun);
      expect(SPAWN_PRIMARY_KINDS).toContain(alice.state.players.get('bot1').gun);
    } finally {
      await alice.leave();
    }
  });

  it('sword-only rooms drop only knives', async () => {
    const alice: AnyRoom = await new Client(wsUrl).create(ROOM_NAME, {
      name: 'swords',
      durationMin: 3,
      nickname: 'Alice',
      weapons: 'sword',
      testOverrides: { dropIntervalMs: 60, dropLifetimeMs: 10_000 },
    });
    try {
      await ready(alice);
      await until(() => alice.state.drops.size >= 2, 4000, 'drops');
      for (const d of alice.state.drops.values()) expect((d as any).slot).toBe(WEAPON_MELEE);
    } finally {
      await alice.leave();
    }
  });

  it('shots carry the gun kind and one ray per pellet; outside a deathmatch the primary slot starts empty', async () => {
    const alice: AnyRoom = await new Client(wsUrl).create(ROOM_NAME, { name: 'guns', durationMin: 3, nickname: 'Alice', mode: 'training', bots: 0, testOverrides: { spawnProtectMs: 0 } });
    const shots: ShotMsg[] = [];
    alice.onMessage(MSG.shot, (m: ShotMsg) => shots.push(m));
    alice.onMessage(MSG.kill, () => {});
    try {
      await ready(alice);
      expect(me(alice).gun).toBe(GUN_NONE);
      expect(me(alice).grenades).toBe(GRENADE_START);
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
      // The taser lives in its own slot (key 5) and leaves after two charges.
      alice.send(MSG.selectWeapon, { epoch: me(alice).spawnEpoch, slot: WEAPON_TASER, kind: GUN_TASER });
      await until(() => me(alice).taser === GUN_TASER, 3000, 'taser armed');
      expect(me(alice).gun).toBe(GUN_SHOTGUN); // the primary slot is untouched
      alice.send(MSG.shoot, { ...poseOf(alice, 32, 40, 0), weapon: WEAPON_TASER });
      await until(() => shots.length === 2, 3000, 'taser shot 1');
      expect(shots[1].gun).toBe(GUN_TASER);
      await sleep(gunSpec(GUN_TASER).cooldownMs);
      alice.send(MSG.shoot, { ...poseOf(alice, 32, 40, 0), weapon: WEAPON_TASER });
      await until(() => shots.length === 3, 3000, 'taser shot 2');
      await until(() => me(alice).taser === GUN_NONE, 3000, 'taser consumed');
      expect(me(alice).weapon).toBe(WEAPON_PISTOL);
      await sleep(gunSpec(GUN_TASER).cooldownMs);
      alice.send(MSG.shoot, { ...poseOf(alice, 32, 40, 0), weapon: WEAPON_TASER });
      await sleep(150);
      expect(shots).toHaveLength(3);
    } finally {
      await alice.leave();
    }
  });

  it('grenades: thrown from slot 4, burst after the fuse and hurt by distance (thrower included); stock is limited', async () => {
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
      // Both on the ground where Alice spawned; Bob 2 blocks ahead. Alice lobs one almost straight down at her feet.
      const ax = me(alice).x;
      const ay = me(alice).y;
      const az = me(alice).z;
      bob.send(MSG.pose, { x: ax, y: ay, z: az - 2, yaw: 0, pitch: 0, epoch: me(bob).spawnEpoch, weapon: WEAPON_PISTOL });
      await until(() => Math.abs(alice.state.players.get(bob!.sessionId).z - (az - 2)) < 0.01, 3000, 'poses');
      alice.send(MSG.throw, { x: ax, y: ay, z: az, yaw: 0, pitch: -1.5, epoch: me(alice).spawnEpoch });
      await until(() => alice.state.grenades.size === 1, 3000, 'grenade in state');
      expect(me(alice).grenades).toBe(GRENADE_START - 1);
      const g: any = [...alice.state.grenades.values()][0];
      expect(g.ownerId).toBe(alice.sessionId);
      await until(() => bursts.length === 1, GRENADE_FUSE_MS + 2000, 'burst');
      expect(alice.state.grenades.size).toBe(0);
      const b = bursts[0];
      expect(b.ownerId).toBe(alice.sessionId);
      // The thrower stands at the burst: always hit. Bob (2 blocks off) is hit unless terrain occludes him.
      const bobHit = b.victims.find((v) => v.id === bob!.sessionId);
      const aliceHit = b.victims.find((v) => v.id === alice.sessionId);
      expect(aliceHit).toBeDefined();
      expect(aliceHit!.damage).toBeGreaterThan(0);
      await sleep(100);
      if (bobHit) {
        expect(bobHit.damage).toBeGreaterThan(0);
        expect(alice.state.players.get(bob.sessionId).hp).toBe(Math.max(0, 100 - bobHit.damage));
      }
      // Stock: 2 at spawn; the third throw is ignored.
      await until(() => me(alice).alive, 3000, 'alice alive');
      const ep = me(alice).spawnEpoch;
      alice.send(MSG.throw, { x: ax, y: ay, z: az, yaw: 0, pitch: 0.5, epoch: ep });
      await until(() => alice.state.grenades.size === 1, 3000, 'second grenade');
      const left = me(alice).grenades;
      await sleep(GRENADE_SERVER_MIN_INTERVAL_MS + 100);
      alice.send(MSG.throw, { x: ax, y: ay, z: az, yaw: 0, pitch: 0.5, epoch: ep });
      await sleep(GRENADE_SERVER_MIN_INTERVAL_MS + 100);
      alice.send(MSG.throw, { x: ax, y: ay, z: az, yaw: 0, pitch: 0.5, epoch: ep });
      await sleep(200);
      // Either she had 1 left (2nd throw ok, 3rd ignored) or respawned with 2 (both ok): never more than the stock.
      expect(alice.state.grenades.size).toBeLessThanOrEqual(1 + left);
      expect(me(alice).grenades).toBe(0);
    } finally {
      await bob?.leave();
      await alice.leave();
    }
  }, 15000);

  it('adds bots that occupy slots, move around and hunt players', async () => {
    const room: AnyRoom = await new Client(wsUrl).create(ROOM_NAME, {
      nickname: 'Human',
      durationMin: 5,
      bots: 2,
      botSkill: 'hard',
      testOverrides: { respawnMs: 500, spawnProtectMs: 0 },
    });
    const kills: KillMsg[] = [];
    room.onMessage(MSG.kill, (m: KillMsg) => kills.push(m));
    room.onMessage(MSG.shot, () => {});
    try {
      await until(() => room.state?.players?.size === 3, 3000, 'bots in state');
      await ready(room);
      const bot1 = room.state.players.get('bot1');
      expect(bot1.isBot).toBe(true);
      expect(bot1.name).toBe('Bot 1');
      expect(room.state.players.get('bot2').isBot).toBe(true);
      expect(me(room).isBot).toBe(false);

      const rooms = (await (await fetch(`${httpUrl}/rooms`)).json()) as RoomListEntry[];
      const listed = rooms.find((r) => r.roomId === room.roomId)!;
      expect(listed.maxClients).toBe(MAX_PLAYERS - 2); // bots take player slots
      expect(listed.metadata.bots).toBe(2);
      expect(listed.metadata.botSkill).toBe('hard');

      // Bots move under server physics.
      const start = { x: bot1.x, z: bot1.z };
      await until(() => Math.hypot(bot1.x - start.x, bot1.z - start.z) > 0.5, 4000, 'bot moved');

      // Hover in the sky above bot1 with clear line of sight: it should turn, aim and kill us.
      const hover = (): void => {
        room.send(MSG.pose, { x: bot1.x, y: 18, z: bot1.z + 3, yaw: 0, pitch: 0, epoch: me(room).spawnEpoch, weapon: 0 });
      };
      const t = setInterval(hover, 50);
      try {
        await until(() => kills.some((k) => k.victimId === room.sessionId && k.killerId.startsWith('bot')), 8000, 'bot kill');
      } finally {
        clearInterval(t);
      }
      const k = kills.find((kk) => kk.victimId === room.sessionId)!;
      expect(k.killerName).toMatch(/^Bot [12]$/);
      await until(() => me(room).deaths === 1, 3000, 'death counted');
      await until(() => room.state.players.get(k.killerId).kills >= 1, 3000, 'bot kill counted');
    } finally {
      await room.leave();
    }
  }, 20000);

  it('does not damage a player who has not clicked to play, and shields everyone for SPAWN_PROTECT_MS after spawning', async () => {
    const PROTECT = 600;
    const alice: AnyRoom = await new Client(wsUrl).create(ROOM_NAME, {
      nickname: 'Alice',
      durationMin: 3,
      testOverrides: { respawnMs: 200, spawnProtectMs: PROTECT },
    });
    const shots: ShotMsg[] = [];
    alice.onMessage(MSG.shot, (m: ShotMsg) => shots.push(m));
    alice.onMessage(MSG.hit, () => {});
    alice.onMessage(MSG.kill, () => {});
    let bob: AnyRoom | null = null;
    try {
      await ready(alice);
      // Alice's own first spawn is shielded too.
      expect(me(alice).shielded).toBe(true);
      await until(() => me(alice).shielded === false, PROTECT + 1000, 'alice protection expired');

      bob = await new Client(wsUrl).joinById(alice.roomId, { nickname: 'Bob' });
      bob.onMessage(MSG.shot, () => {});
      bob.onMessage(MSG.hit, () => {});
      bob.onMessage(MSG.kill, () => {});
      await until(() => me(bob!) !== undefined && alice.state.players.has(bob!.sessionId), 3000, 'bob in state');
      const bobView = (): any => alice.state.players.get(bob!.sessionId);
      // Bob has not clicked to play: not alive, so nobody can target him and his own actions are ignored.
      expect(bobView().alive).toBe(false);
      bob.send(MSG.pose, poseOf(bob, 32, 30, 0));
      await sleep(150);
      expect(Math.abs(bobView().x - 32) > 0.01 || Math.abs(bobView().z - 30) > 0.01).toBe(true);

      // Bob clicks to play: spawned, full HP, shielded. Alice lines up a headshot; the ray passes through him.
      await ready(bob);
      expect(bobView().shielded).toBe(true);
      expect(bobView().hp).toBe(100);
      bob.send(MSG.pose, poseOf(bob, 32, 30, 0));
      await until(() => Math.abs(bobView().x - 32) < 0.01, 3000, 'bob pose synced');
      alice.send(MSG.shoot, poseOf(alice, 32, 40, 0));
      await until(() => shots.length === 1, 3000, 'shot broadcast');
      expect(shots[0].rays[0].hitPlayerId).toBe('');
      expect(shots[0].rays[0].damage).toBe(0);
      await sleep(100);
      expect(bobView().hp).toBe(100);
      expect(bobView().alive).toBe(true);

      // Once the shield lapses, the same shot connects.
      await until(() => bobView().shielded === false, PROTECT + 1000, 'bob protection expired');
      alice.send(MSG.shoot, poseOf(alice, 32, 40, 0));
      const secondShotAt = Date.now();
      await until(() => shots.length === 2, 3000, 'second shot');
      expect(shots[1].rays[0]).toMatchObject({ hitPlayerId: bob.sessionId, part: 'head', damage: 100 });
      await until(() => bobView().alive === false, 3000, 'bob killed');

      // Respawn re-arms the shield; attacking ends it early.
      await until(() => bobView().alive === true && bobView().spawnEpoch === 2, 3000, 'bob respawned');
      expect(bobView().shielded).toBe(true);
      await until(() => me(bob!).spawnEpoch === 2, 3000, 'bob sees own epoch');
      // While the respawn shield holds, Alice's headshot passes straight through again.
      bob.send(MSG.pose, poseOf(bob, 32, 30, 0));
      await until(() => Math.abs(bobView().x - 32) < 0.01 && Math.abs(bobView().z - 30) < 0.01, 3000, 'bob back in line');
      // Respawn (200ms) can beat the gun cooldown (300ms): wait it out so the shot is not rate-limited.
      await sleep(Math.max(0, secondShotAt + GUN_SERVER_MIN_INTERVAL_MS + 20 - Date.now()));
      alice.send(MSG.shoot, poseOf(alice, 32, 40, 0));
      await until(() => shots.length === 3, 3000, 'third shot');
      expect(shots[2].rays[0]).toMatchObject({ hitPlayerId: '', damage: 0 });
      await sleep(100);
      expect(bobView().hp).toBe(100);
      expect(bobView().shielded).toBe(true);
      bob.send(MSG.shoot, poseOf(bob, 5, 5, 0));
      await until(() => bobView().shielded === false, 1000, 'shield dropped on attack');
    } finally {
      await bob?.leave();
      await alice.leave();
    }
  });

  it('limits the gun to GUN_MAG_SIZE rounds per magazine and refills after a reload', async () => {
    const alice: AnyRoom = await new Client(wsUrl).create(ROOM_NAME, {
      nickname: 'Alice',
      durationMin: 3,
      testOverrides: { spawnProtectMs: 0 },
    });
    const shots: ShotMsg[] = [];
    alice.onMessage(MSG.shot, (m: ShotMsg) => shots.push(m));
    alice.onMessage(MSG.hit, () => {});
    alice.onMessage(MSG.kill, () => {});
    try {
      await ready(alice);
      const fireOnce = async (): Promise<void> => {
        alice.send(MSG.shoot, poseOf(alice, 32, 40, 0));
        await sleep(GUN_SERVER_MIN_INTERVAL_MS + 20);
      };
      for (let i = 0; i < GUN_MAG_SIZE + 2; i++) await fireOnce();
      await sleep(100);
      expect(shots).toHaveLength(GUN_MAG_SIZE); // the two extra trigger pulls on an empty magazine were dropped

      // Reload: shots during the reload are dropped; after it, the magazine is full again.
      alice.send(MSG.reload, me(alice).spawnEpoch);
      await sleep(50);
      await fireOnce();
      expect(shots).toHaveLength(GUN_MAG_SIZE);
      await sleep(GUN_RELOAD_SERVER_MIN_MS);
      await fireOnce();
      expect(shots).toHaveLength(GUN_MAG_SIZE + 1);

      // A shot sent mid-reload with rounds left counts as cancelling the reload (weapon switch on the client).
      alice.send(MSG.reload, me(alice).spawnEpoch);
      await sleep(50);
      await fireOnce();
      expect(shots).toHaveLength(GUN_MAG_SIZE + 2);
    } finally {
      await alice.leave();
    }
  }, 15000);

  it('shotgun: a shot mid-reload fires with the shells loaded so far (per-shell reload)', async () => {
    const alice: AnyRoom = await new Client(wsUrl).create(ROOM_NAME, {
      nickname: 'Alice',
      durationMin: 3,
      mode: 'training',
      testOverrides: { spawnProtectMs: 0 },
    });
    const shots: ShotMsg[] = [];
    alice.onMessage(MSG.shot, (m: ShotMsg) => shots.push(m));
    const spec = gunSpec(GUN_SHOTGUN);
    try {
      await ready(alice);
      alice.send(MSG.selectWeapon, { epoch: me(alice).spawnEpoch, slot: WEAPON_PRIMARY, kind: GUN_SHOTGUN });
      await until(() => me(alice).gun === GUN_SHOTGUN, 2000, 'shotgun armed');
      const fireOnce = async (): Promise<void> => {
        alice.send(MSG.shoot, poseOf(alice, 32, 40, 0, WEAPON_PRIMARY));
        await sleep(spec.serverMinIntervalMs + 30);
      };
      for (let i = 0; i < spec.magSize; i++) await fireOnce();
      expect(shots.filter((s) => s.gun === GUN_SHOTGUN)).toHaveLength(spec.magSize);
      // Empty: dropped.
      await fireOnce();
      expect(shots.filter((s) => s.gun === GUN_SHOTGUN)).toHaveLength(spec.magSize);
      // Reload, wait roughly one shell interval, then shoot: the loaded shell fires.
      alice.send(MSG.reload, { epoch: me(alice).spawnEpoch, weapon: WEAPON_PRIMARY });
      await sleep(spec.reloadMs + 250);
      await fireOnce();
      expect(shots.filter((s) => s.gun === GUN_SHOTGUN)).toHaveLength(spec.magSize + 1);
    } finally {
      await alice.leave();
    }
  }, 15000);

  it('exposes charging / reloading in state and broadcasts every swing, hit or miss', async () => {
    const alice: AnyRoom = await new Client(wsUrl).create(ROOM_NAME, {
      nickname: 'Alice',
      durationMin: 3,
      testOverrides: { spawnProtectMs: 0 },
    });
    const swings: SwungMsg[] = [];
    alice.onMessage(MSG.swung, (m: SwungMsg) => swings.push(m));
    alice.onMessage(MSG.shot, () => {});
    alice.onMessage(MSG.hit, () => {});
    alice.onMessage(MSG.kill, () => {});
    try {
      await ready(alice);
      expect(me(alice).charging).toBe(false);
      expect(me(alice).reloading).toBe(false);

      // Charge start is visible to everyone; releasing the swing (into thin air) clears it and is broadcast.
      // The charge may race ahead of the pose that switches to the sword: it must survive that pose.
      alice.send(MSG.charge, me(alice).spawnEpoch);
      alice.send(MSG.pose, poseOf(alice, 32, 40, 0, WEAPON_MELEE));
      await until(() => me(alice).charging === true, 2000, 'charging flag');
      await sleep(SWORD_CHARGE_MS + 100);
      alice.send(MSG.swing, { ...poseOf(alice, 32, 40, 0, WEAPON_MELEE), attack: ATTACK_HEAVY });
      await until(() => swings.length === 1, 2000, 'swung broadcast');
      expect(swings[0]).toEqual({ attackerId: alice.sessionId, attack: ATTACK_HEAVY, melee: MELEE_SWORD });
      await until(() => me(alice).charging === false, 2000, 'charging cleared');

      // A light miss is broadcast too.
      await sleep(SWORD_SERVER_MIN_INTERVAL_MS + 20);
      alice.send(MSG.swing, { ...poseOf(alice, 32, 40, 0, WEAPON_MELEE), attack: ATTACK_LIGHT });
      await until(() => swings.length === 2, 2000, 'second swung');
      expect(swings[1]).toEqual({ attackerId: alice.sessionId, attack: ATTACK_LIGHT, melee: MELEE_SWORD });

      // Letting go of LMB early cancels the charge without a swing.
      alice.send(MSG.charge, me(alice).spawnEpoch);
      await until(() => me(alice).charging === true, 2000, 'charging (to cancel)');
      alice.send(MSG.chargeCancel, me(alice).spawnEpoch);
      await until(() => me(alice).charging === false, 2000, 'charge cancelled');
      await sleep(100);
      expect(swings).toHaveLength(2);

      // Switching to the gun cancels a pending charge.
      alice.send(MSG.charge, me(alice).spawnEpoch);
      await until(() => me(alice).charging === true, 2000, 'charging again');
      alice.send(MSG.pose, poseOf(alice, 32, 40, 0, WEAPON_PISTOL));
      await until(() => me(alice).charging === false, 2000, 'charge cancelled by weapon switch');

      // Reload: flag is up for the reload window, then drops by itself.
      alice.send(MSG.shoot, poseOf(alice, 32, 40, 0));
      await sleep(50);
      alice.send(MSG.reload, me(alice).spawnEpoch);
      await until(() => me(alice).reloading === true, 2000, 'reloading flag');
      await until(() => me(alice).reloading === false, GUN_RELOAD_SERVER_MIN_MS + 1000, 'reloading cleared');
    } finally {
      await alice.leave();
    }
  }, 15000);

  it('restricts weapons to the room rule (sword-only rejects shots)', async () => {
    const swordRoom: AnyRoom = await new Client(wsUrl).create(ROOM_NAME, {
      nickname: 'Alice',
      durationMin: 3,
      weapons: 'sword',
      testOverrides: { spawnProtectMs: 0 },
    });
    const shots: ShotMsg[] = [];
    const hits: HitMsg[] = [];
    swordRoom.onMessage(MSG.shot, (m: ShotMsg) => shots.push(m));
    swordRoom.onMessage(MSG.hit, (m: HitMsg) => hits.push(m));
    swordRoom.onMessage(MSG.kill, () => {});
    let bob: AnyRoom | null = null;
    try {
      await ready(swordRoom);
      expect(swordRoom.state.weapons).toBe('sword');
      const listed = ((await (await fetch(`${httpUrl}/rooms`)).json()) as RoomListEntry[]).find((r) => r.roomId === swordRoom.roomId)!;
      expect(listed.metadata.weapons).toBe('sword');
      expect(me(swordRoom).weapon).toBe(WEAPON_MELEE); // spawned holding the sword

      bob = await new Client(wsUrl).joinById(swordRoom.roomId, { nickname: 'Bob' });
      bob.onMessage(MSG.shot, () => {});
      bob.onMessage(MSG.hit, () => {});
      bob.onMessage(MSG.kill, () => {});
      await ready(bob);
      const bobView = (): any => swordRoom.state.players.get(bob!.sessionId);
      bob.send(MSG.pose, poseOf(bob, 32, 30, 0, WEAPON_PISTOL)); // claiming the gun is ignored
      await until(() => Math.abs(bobView().x - 32) < 0.01, 3000, 'bob pose synced');
      expect(bobView().weapon).toBe(WEAPON_MELEE);

      // A gun shot is dropped outright: no broadcast, no damage.
      swordRoom.send(MSG.shoot, poseOf(swordRoom, 32, 40, 0));
      await sleep(200);
      expect(shots).toHaveLength(0);
      expect(bobView().hp).toBe(100);

      // The sword still works.
      swordRoom.send(MSG.pose, poseOf(swordRoom, 32, 32, 0, WEAPON_MELEE));
      await until(() => Math.abs(me(swordRoom).z - 32) < 0.01, 3000, 'alice repositioned');
      swordRoom.send(MSG.swing, { ...poseOf(swordRoom, 32, 32, 0, WEAPON_MELEE), attack: ATTACK_LIGHT });
      await until(() => hits.length === 1, 3000, 'sword hit');
      expect(hits[0].victimId).toBe(bob.sessionId);

    } finally {
      await bob?.leave();
      await swordRoom.leave();
    }
  });

  it('training room: dummies stand on the plateau and never attack; melee is picked directly', async () => {
    const alice: AnyRoom = await new Client(wsUrl).create(ROOM_NAME, {
      nickname: 'Alice',
      durationMin: 3,
      mode: 'training',
      bots: 2,
      testOverrides: { spawnProtectMs: 0 },
    });
    const hits: HitMsg[] = [];
    const swings: SwungMsg[] = [];
    const kills: KillMsg[] = [];
    alice.onMessage(MSG.hit, (m: HitMsg) => hits.push(m));
    alice.onMessage(MSG.swung, (m: SwungMsg) => swings.push(m));
    alice.onMessage(MSG.kill, (m: KillMsg) => kills.push(m));
    alice.onMessage(MSG.shot, () => {});
    alice.onMessage(MSG.pickup, () => {});
    let match: AnyRoom | null = null;
    try {
      await ready(alice);
      expect(alice.state.mode).toBe('training');
      const listed = ((await (await fetch(`${httpUrl}/rooms`)).json()) as RoomListEntry[]).find((r) => r.roomId === alice.roomId)!;
      expect(listed.metadata.mode).toBe('training');
      expect(listed.metadata.bots).toBe(2);

      // Dummies: alive, parked on the central plateau, and they stay put.
      const dummies = (): [string, any][] => {
        const out: [string, any][] = [];
        alice.state.players.forEach((p: any, id: string) => {
          if (p.isBot) out.push([id, p]);
        });
        return out;
      };
      expect(dummies()).toHaveLength(2);
      const before = dummies().map(([, p]) => ({ x: p.x, z: p.z }));
      for (const { x, z } of before) {
        expect(x).toBeGreaterThanOrEqual(PLATEAU_MIN);
        expect(x).toBeLessThanOrEqual(PLATEAU_MAX + 1);
        expect(z).toBeGreaterThanOrEqual(PLATEAU_MIN);
        expect(z).toBeLessThanOrEqual(PLATEAU_MAX + 1);
      }
      await sleep(400);
      dummies().forEach(([, p], i) => {
        expect(p.alive).toBe(true);
        expect(Math.hypot(p.x - before[i].x, p.z - before[i].z)).toBeLessThan(0.05);
      });
      expect(me(alice).hp).toBe(100);
      expect(hits).toHaveLength(0);

      // Pick the katana directly, then hit a dummy with it three times: it dies and is back within a second.
      alice.send(MSG.selectWeapon, { epoch: me(alice).spawnEpoch, slot: WEAPON_MELEE, kind: MELEE_KATANA });
      await until(() => me(alice).melee === MELEE_KATANA, 3000, 'katana selected');
      const [dummyId, dummy] = dummies()[0];
      const stand = { x: dummy.x, y: dummy.y, z: dummy.z + 2 };
      const swingAt = (): void =>
        alice.send(MSG.swing, { x: stand.x, y: stand.y, z: stand.z, yaw: 0, pitch: 0, epoch: me(alice).spawnEpoch, attack: ATTACK_LIGHT });
      alice.send(MSG.pose, { ...stand, yaw: 0, pitch: 0, epoch: me(alice).spawnEpoch, weapon: WEAPON_MELEE });
      await until(() => Math.abs(me(alice).z - stand.z) < 0.01, 3000, 'alice next to dummy');
      const light = MELEE_STATS[MELEE_KATANA].attacks[ATTACK_LIGHT];
      for (let i = 0; i < 3; i++) {
        swingAt();
        await sleep(light.cooldownMs + 50);
      }
      await until(() => kills.length === 1, 3000, 'dummy killed');
      expect(swings[0].melee).toBe(MELEE_KATANA);
      expect(hits[0].victimId).toBe(dummyId);
      expect(hits[0].melee).toBe(MELEE_KATANA);
      expect(kills[0].victimId).toBe(dummyId);
      expect(kills[0].melee).toBe(MELEE_KATANA);
      const t0 = Date.now();
      await until(() => alice.state.players.get(dummyId).alive === true, 3000, 'dummy respawned');
      expect(Date.now() - t0).toBeLessThan(1500);

      // A normal match ignores selectWeapon: the sword stays, and the (spawn-rolled) primary cannot be swapped at will.
      match = await new Client(wsUrl).create(ROOM_NAME, { nickname: 'Carol', durationMin: 3 });
      match.onMessage(MSG.shot, () => {});
      match.onMessage(MSG.hit, () => {});
      match.onMessage(MSG.kill, () => {});
      match.onMessage(MSG.swung, () => {});
      match.onMessage(MSG.pickup, () => {});
      await ready(match);
      expect(match.state.mode).toBe('match');
      const rolled = me(match).gun; // deathmatch spawn roll
      expect(SPAWN_PRIMARY_KINDS).toContain(rolled);
      const wanted = rolled === GUN_SNIPER ? GUN_SHOTGUN : GUN_SNIPER;
      match.send(MSG.selectWeapon, { epoch: me(match).spawnEpoch, slot: WEAPON_MELEE, kind: MELEE_KATANA });
      match.send(MSG.selectWeapon, { epoch: me(match).spawnEpoch, slot: WEAPON_PRIMARY, kind: wanted });
      await sleep(200);
      expect(me(match).melee).toBe(MELEE_SWORD);
      expect(me(match).gun).toBe(rolled);
    } finally {
      await match?.leave();
      await alice.leave();
    }
  }, 15000);

  it('ends the match, locks the room and disconnects everyone after the linger', async () => {
    const room: AnyRoom = await new Client(wsUrl).create(ROOM_NAME, {
      nickname: 'Solo',
      durationMin: 5,
      testOverrides: { durationMs: 700, lingerMs: 300 },
    });
    let leaveCode = -1;
    room.onLeave((code: number) => (leaveCode = code));
    await until(() => me(room) !== undefined, 3000, 'joined');
    expect(room.state.timeLeftMs).toBeLessThanOrEqual(700);
    await until(() => room.state.phase === 'ended', 4000, 'phase ended');
    expect(room.state.timeLeftMs).toBe(0);
    await expect(new Client(wsUrl).joinById(room.roomId, { nickname: 'Late' })).rejects.toThrow();
    const listed = (await (await fetch(`${httpUrl}/rooms`)).json()) as RoomListEntry[];
    expect(listed.find((r) => r.roomId === room.roomId)).toBeUndefined();
    await until(() => leaveCode !== -1, 3000, 'server disconnect');
  });

  describe('capture the flag', () => {
    const flag = (room: AnyRoom, team: number): any => room.state.flags.get(String(team));
    /** Stand right on a flag / spot (feet at its height, so canPickUp's dy check passes). */
    const standAt = (room: AnyRoom, at: { x: number; y: number; z: number }): void => {
      room.send(MSG.pose, { x: at.x, y: at.y, z: at.z, yaw: 0, pitch: 0, epoch: me(room).spawnEpoch, weapon: WEAPON_MELEE });
    };

    it('teams, take → carry (no shooting) → score in the base zone, capture limit ends the match', async () => {
      const alice: AnyRoom = await new Client(wsUrl).create(ROOM_NAME, {
        name: 'CTF',
        durationMin: 5,
        nickname: 'Alice',
        mode: 'ctf',
        captureLimit: 3,
        team: TEAM_RED,
        testOverrides: { respawnMs: 200, spawnProtectMs: 0 },
      });
      const events: FlagEventMsg[] = [];
      const shots: ShotMsg[] = [];
      alice.onMessage(MSG.flag, (m: FlagEventMsg) => events.push(m));
      alice.onMessage(MSG.shot, (m: ShotMsg) => shots.push(m));
      alice.onMessage(MSG.kill, () => {});
      let bob: AnyRoom | null = null;
      try {
        await ready(alice);
        expect(alice.state.mode).toBe('ctf');
        expect(alice.state.captureLimit).toBe(3);
        expect(alice.state.flags.size).toBe(2);
        expect(flag(alice, TEAM_RED).status).toBe('home');
        expect(flag(alice, TEAM_BLUE).status).toBe('home');
        expect(flag(alice, TEAM_RED).x).toBeLessThan(CTF_WORLD_SX / 4);
        expect(flag(alice, TEAM_BLUE).x).toBeGreaterThan((CTF_WORLD_SX * 3) / 4);
        expect(me(alice).team).toBe(TEAM_RED);
        expect(me(alice).color).toBe(0);
        expect(me(alice).x).toBeLessThan(CTF_WORLD_SX / 2); // spawned on the red side

        bob = await new Client(wsUrl).joinById(alice.roomId, { nickname: 'Bob', team: TEAM_BLUE });
        bob.onMessage(MSG.flag, () => {});
        bob.onMessage(MSG.shot, () => {});
        bob.onMessage(MSG.kill, () => {});
        await ready(bob);
        expect(me(bob).team).toBe(TEAM_BLUE);
        expect(me(bob).color).toBe(1);
        expect(me(bob).x).toBeGreaterThan(CTF_WORLD_SX / 2);
        const rooms = (await (await fetch(`${httpUrl}/rooms`)).json()) as RoomListEntry[];
        expect(rooms.find((r) => r.roomId === alice.roomId)!.metadata).toMatchObject({ mode: 'ctf', captureLimit: 3, teams: [1, 1] });

        for (let capture = 1; capture <= 3; capture++) {
          // Alice runs onto the blue flag: she carries it, and it follows her.
          standAt(alice, flag(alice, TEAM_BLUE));
          await until(() => flag(alice, TEAM_BLUE).status === 'carried', 3000, 'blue flag taken');
          expect(flag(alice, TEAM_BLUE).carrierId).toBe(alice.sessionId);
          expect(events.at(-1)).toMatchObject({ kind: 'taken', team: TEAM_BLUE, playerId: alice.sessionId, playerName: 'Alice' });
          // Carriers cannot shoot.
          alice.send(MSG.shoot, poseOf(alice, 32, 40, 0));
          await sleep(150);
          expect(shots).toHaveLength(0);
          // Home into the base zone (a few blocks off the stand still counts).
          const home = flag(alice, TEAM_RED);
          standAt(alice, { x: home.x + 2, y: home.y, z: home.z + 1 });
          await until(() => alice.state.redScore === capture, 3000, `capture ${capture}`);
          expect(events.at(-1)).toMatchObject({ kind: 'captured', team: TEAM_BLUE, playerId: alice.sessionId, redScore: capture, blueScore: 0 });
          expect(me(alice).captures).toBe(capture);
          expect(flag(alice, TEAM_BLUE).status).toBe('home');
        }
        await until(() => alice.state.phase === 'ended', 3000, 'capture limit ends the match');
        expect(alice.state.blueScore).toBe(0);
      } finally {
        await bob?.leave();
        await alice.leave();
      }
    }, 20000);

    it('drops: a killed carrier drops the flag, owners carry it home, G hands it off, teammates pick it up, it returns on its own', async () => {
      const alice: AnyRoom = await new Client(wsUrl).create(ROOM_NAME, {
        nickname: 'Alice',
        durationMin: 5,
        mode: 'ctf',
        captureLimit: 10,
        team: TEAM_RED,
        testOverrides: { respawnMs: 200, spawnProtectMs: 0, flagReturnMs: 400 },
      });
      const events: FlagEventMsg[] = [];
      alice.onMessage(MSG.flag, (m: FlagEventMsg) => events.push(m));
      alice.onMessage(MSG.shot, () => {});
      alice.onMessage(MSG.kill, () => {});
      let bob: AnyRoom | null = null;
      let carol: AnyRoom | null = null;
      try {
        await ready(alice);
        bob = await new Client(wsUrl).joinById(alice.roomId, { nickname: 'Bob', team: TEAM_BLUE });
        carol = await new Client(wsUrl).joinById(alice.roomId, { nickname: 'Carol' }); // no preference → the smaller team (red 1, blue 1 → either); force below
        for (const r of [bob, carol]) {
          r.onMessage(MSG.flag, () => {});
          r.onMessage(MSG.shot, () => {});
          r.onMessage(MSG.kill, () => {});
        }
        await ready(bob);
        await ready(carol);
        if (me(carol).team !== TEAM_BLUE) {
          carol.send(MSG.selectTeam, TEAM_BLUE);
          await until(() => me(carol!).team === TEAM_BLUE, 3000, 'carol blue');
          await until(() => me(carol!).alive === true, 3000, 'carol respawned on blue');
        }

        // Bob takes the red flag and gets shot: it drops where he stood.
        const redHome = { x: flag(alice, TEAM_RED).x, y: flag(alice, TEAM_RED).y, z: flag(alice, TEAM_RED).z };
        standAt(bob, flag(bob, TEAM_RED));
        await until(() => flag(alice, TEAM_RED).carrierId === bob!.sessionId, 3000, 'bob has red flag');
        bob.send(MSG.pose, poseOf(bob, 32, 30, 0));
        alice.send(MSG.pose, poseOf(alice, 32, 40, 0));
        await until(() => Math.abs(alice.state.players.get(bob!.sessionId).z - 30) < 0.01, 3000, 'bob in the sky');
        alice.send(MSG.shoot, poseOf(alice, 32, 40, 0)); // level headshot
        await until(() => flag(alice, TEAM_RED).status === 'dropped', 3000, 'red flag dropped');
        expect(flag(alice, TEAM_RED).x).toBeCloseTo(32, 2);
        expect(flag(alice, TEAM_RED).z).toBeCloseTo(30, 2);
        expect(events.at(-1)).toMatchObject({ kind: 'dropped', team: TEAM_RED, playerId: bob.sessionId });
        // Alice (red) touches it: she carries her own flag and has to bring it into the red base zone herself.
        standAt(alice, flag(alice, TEAM_RED));
        await until(() => flag(alice, TEAM_RED).carrierId === alice.sessionId, 3000, 'alice carries the red flag');
        expect(flag(alice, TEAM_RED).status).toBe('carried');
        expect(events.at(-1)).toMatchObject({ kind: 'taken', team: TEAM_RED, playerId: alice.sessionId });
        alice.send(MSG.pose, poseOf(alice, 40, 40, 0)); // half-way: still carried, not home
        await until(() => Math.abs(flag(alice, TEAM_RED).x - 40) < 0.01, 3000, 'flag follows alice');
        expect(flag(alice, TEAM_RED).status).toBe('carried');
        standAt(alice, redHome);
        await until(() => flag(alice, TEAM_RED).status === 'home', 3000, 'red flag returned');
        expect(events.at(-1)).toMatchObject({ kind: 'returned', team: TEAM_RED, playerId: alice.sessionId });
        alice.send(MSG.pose, poseOf(alice, 32, 40, 0)); // off the stand again

        // Bob (respawned) takes it again and hands it off with G; Carol (blue) picks it up.
        await until(() => me(bob!).alive === true, 3000, 'bob respawned');
        standAt(bob, flag(bob, TEAM_RED));
        await until(() => flag(alice, TEAM_RED).carrierId === bob!.sessionId, 3000, 'bob has red flag again');
        bob.send(MSG.dropFlag, me(bob).spawnEpoch);
        await until(() => flag(alice, TEAM_RED).status === 'dropped', 3000, 'handed off');
        standAt(carol, flag(carol, TEAM_RED));
        await until(() => flag(alice, TEAM_RED).carrierId === carol!.sessionId, 3000, 'carol picked it up');
        expect(events.at(-1)).toMatchObject({ kind: 'taken', team: TEAM_RED, playerId: carol.sessionId });

        // Carol puts it down somewhere nobody stands: it walks home by itself.
        carol.send(MSG.pose, poseOf(carol, 60, 10, 0));
        await until(() => Math.abs(flag(alice, TEAM_RED).x - 60) < 0.01, 3000, 'flag follows carol');
        carol.send(MSG.dropFlag, me(carol).spawnEpoch);
        await until(() => flag(alice, TEAM_RED).status === 'dropped', 3000, 'dropped in the open');
        carol.send(MSG.pose, poseOf(carol, 70, 10, 0)); // step away
        bob.send(MSG.pose, poseOf(bob, 60, 40, 0)); // Bob off the red stand too, or he'd take it again the moment it is back
        await until(() => events.some((e) => e.kind === 'returned' && e.playerId === ''), 3000, 'auto-returned');
        await until(() => flag(alice, TEAM_RED).status === 'home', 3000, 'red flag home');

        // Team switch mid-match: Carol goes red, dies (no death counted) and respawns on the red side.
        const deathsBefore = me(carol).deaths;
        const epochBefore = me(carol).spawnEpoch;
        carol.send(MSG.selectTeam, TEAM_RED);
        await until(() => me(carol!).team === TEAM_RED, 3000, 'carol switched');
        expect(me(carol).color).toBe(0);
        await until(() => me(carol!).spawnEpoch === epochBefore + 1 && me(carol!).alive, 3000, 'carol respawned red');
        expect(me(carol).deaths).toBe(deathsBefore);
        expect(me(carol).x).toBeLessThan(CTF_WORLD_SX / 2);
        const rooms = (await (await fetch(`${httpUrl}/rooms`)).json()) as RoomListEntry[];
        expect(rooms.find((r) => r.roomId === alice.roomId)!.metadata.teams).toEqual([2, 1]);
        // Same team again / garbage: ignored.
        carol.send(MSG.selectTeam, TEAM_RED);
        carol.send(MSG.selectTeam, 7);
        await sleep(100);
        expect(me(carol).team).toBe(TEAM_RED);
        expect(me(carol).spawnEpoch).toBe(epochBefore + 1);
      } finally {
        await carol?.leave();
        await bob?.leave();
        await alice.leave();
      }
    }, 20000);

    it('bots split over both teams and move to even the sides out', async () => {
      const alice: AnyRoom = await new Client(wsUrl).create(ROOM_NAME, {
        nickname: 'Alice',
        durationMin: 5,
        mode: 'ctf',
        bots: 2,
        team: TEAM_RED,
        testOverrides: { respawnMs: 100, spawnProtectMs: 0 },
      });
      alice.onMessage(MSG.flag, () => {});
      alice.onMessage(MSG.shot, () => {});
      alice.onMessage(MSG.swung, () => {});
      alice.onMessage(MSG.hit, () => {});
      alice.onMessage(MSG.kill, () => {});
      let bob: AnyRoom | null = null;
      try {
        await ready(alice);
        expect(alice.state.players.get('bot1').team).toBe(TEAM_RED);
        expect(alice.state.players.get('bot2').team).toBe(TEAM_BLUE);
        // Bob insists on red: 3 v 1 → a bot moves over.
        bob = await new Client(wsUrl).joinById(alice.roomId, { nickname: 'Bob', team: TEAM_RED });
        bob.onMessage(MSG.flag, () => {});
        bob.onMessage(MSG.shot, () => {});
        bob.onMessage(MSG.swung, () => {});
        bob.onMessage(MSG.hit, () => {});
        bob.onMessage(MSG.kill, () => {});
        await ready(bob);
        expect(me(bob).team).toBe(TEAM_RED);
        await until(() => alice.state.players.get('bot1').team === TEAM_BLUE, 3000, 'bot1 rebalanced');
        const rooms = (await (await fetch(`${httpUrl}/rooms`)).json()) as RoomListEntry[];
        expect(rooms.find((r) => r.roomId === alice.roomId)!.metadata.teams).toEqual([2, 2]);
        // Bots play: within a few seconds the attackers have moved off their spawn toward the enemy flag.
        const start = { x: alice.state.players.get('bot2').x, z: alice.state.players.get('bot2').z };
        await until(() => Math.hypot(alice.state.players.get('bot2').x - start.x, alice.state.players.get('bot2').z - start.z) > 4, 5000, 'bot moves');
      } finally {
        await bob?.leave();
        await alice.leave();
      }
    }, 20000);
  });

  describe('team elimination', () => {
    const listen = (room: AnyRoom): void => {
      for (const m of [MSG.round, MSG.shot, MSG.swung, MSG.hit, MSG.kill, MSG.pickup]) room.onMessage(m, () => {});
    };

    it('rounds: wipe → intermission (no respawn) → reset, first to the limit ends the match', async () => {
      const alice: AnyRoom = await new Client(wsUrl).create(ROOM_NAME, {
        name: 'TD',
        nickname: 'Alice',
        mode: 'td',
        roundLimit: 3,
        team: TEAM_RED,
        testOverrides: { respawnMs: 100, spawnProtectMs: 0, roundIntermissionMs: 1500, roundFreezeMs: 0 },
      });
      const rounds: RoundEventMsg[] = [];
      const shots: ShotMsg[] = [];
      const kills: KillMsg[] = [];
      listen(alice);
      alice.onMessage(MSG.round, (m: RoundEventMsg) => rounds.push(m));
      alice.onMessage(MSG.shot, (m: ShotMsg) => shots.push(m));
      alice.onMessage(MSG.kill, (m: KillMsg) => kills.push(m));
      let bob: AnyRoom | null = null;
      let carol: AnyRoom | null = null;
      try {
        await ready(alice);
        expect(alice.state.mode).toBe('td');
        expect(alice.state.roundLimit).toBe(3);
        expect(alice.state.round).toBe(1);
        expect(alice.state.roundPhase).toBe('live');
        expect(alice.state.timeLeftMs).toBe(0); // no clock in td
        expect(me(alice).team).toBe(TEAM_RED);
        expect(me(alice).z).toBeLessThan(TD_WORLD_SZ / 2); // spawned in the red zone
        expect(me(alice).gun).toBe(GUN_NONE); // pistol-only spawn: guns come off the ground
        // The fixed weapon rows: 8 primaries per side, none of them expiring.
        expect(alice.state.drops.size).toBe(16);
        for (const d of alice.state.drops.values()) expect(d.slot).toBe(WEAPON_PRIMARY);

        bob = await new Client(wsUrl).joinById(alice.roomId, { nickname: 'Bob', team: TEAM_BLUE });
        listen(bob);
        await ready(bob);
        expect(me(bob).z).toBeGreaterThan(TD_WORLD_SZ / 2);
        const rooms = (await (await fetch(`${httpUrl}/rooms`)).json()) as RoomListEntry[];
        expect(rooms.find((r) => r.roomId === alice.roomId)!.metadata).toMatchObject({ mode: 'td', roundLimit: 3, teams: [1, 1] });

        // Alice grabs a gun off the ground: walking over a fixed spot arms her.
        const spot = [...alice.state.drops.values()].find((d: any) => d.z < TD_WORLD_SZ / 2);
        alice.send(MSG.pose, { x: spot.x, y: spot.y, z: spot.z, yaw: 0, pitch: 0, epoch: me(alice).spawnEpoch, weapon: WEAPON_PISTOL });
        await until(() => me(alice).gun !== GUN_NONE, 3000, 'alice armed off the ground');
        expect(alice.state.drops.size).toBe(15);

        // G works mid-round: the gun lands at her feet, the grace holds her off, then her empty slot takes it back.
        alice.send(MSG.dropWeapon, { epoch: me(alice).spawnEpoch, slot: WEAPON_PRIMARY });
        await until(() => me(alice).gun === GUN_NONE, 3000, 'gun thrown');
        expect(alice.state.drops.size).toBe(16);
        await until(() => me(alice).gun !== GUN_NONE, 4000, 'picked back up after the grace');
        expect(alice.state.drops.size).toBe(15);

        // Alice wipes blue (Bob) → red takes the round. Shots repeat past the server's rate limit.
        const wipe = async (round: number): Promise<void> => {
          bob!.send(MSG.pose, poseOf(bob!, 32, 30, 0));
          await until(() => Math.abs(alice.state.players.get(bob!.sessionId).z - 30) < 0.01, 3000, 'bob in the sky');
          const deadline = Date.now() + 5000;
          while (alice.state.roundsRed < round) {
            if (Date.now() > deadline) throw new Error(`timed out wiping round ${round}`);
            alice.send(MSG.shoot, poseOf(alice, 32, 40, 0)); // level pistol headshot
            await sleep(GUN_SERVER_MIN_INTERVAL_MS + 60);
          }
        };
        await wipe(1);
        expect(alice.state.roundPhase).toBe('intermission');
        expect(rounds.at(-1)).toMatchObject({ kind: 'end', winner: TEAM_RED, round: 1, roundsRed: 1, roundsBlue: 0 });
        // Longer than respawnMs: the dead wait for the next round, they never auto-respawn.
        await sleep(250);
        expect(alice.state.players.get(bob.sessionId).alive).toBe(false);
        // Carol joins mid-intermission: ready, but only spawned when the next round starts.
        carol = await new Client(wsUrl).joinById(alice.roomId, { nickname: 'Carol', team: TEAM_RED });
        listen(carol);
        await until(() => me(carol!) !== undefined, 3000, 'carol in state');
        carol.send(MSG.ready);
        await sleep(150);
        expect(me(carol).alive).toBe(false);

        // Round 2: everyone (Bob and Carol included) comes back, loadouts reset, weapons re-laid.
        const bobEpoch = alice.state.players.get(bob.sessionId).spawnEpoch;
        await until(() => alice.state.round === 2 && alice.state.roundPhase === 'live', 3000, 'round 2');
        await until(() => me(carol!).alive === true && alice.state.players.get(bob!.sessionId).alive === true, 3000, 'all spawned');
        expect(alice.state.players.get(bob.sessionId).spawnEpoch).not.toBe(bobEpoch);
        expect(me(alice).gun).toBe(GUN_NONE); // the picked-up rifle died with the round
        expect(alice.state.drops.size).toBe(16);
        expect(rounds.at(-1)).toMatchObject({ kind: 'start', round: 2 });

        // No friendly fire: Alice cannot hurt Carol.
        carol.send(MSG.pose, poseOf(carol, 32, 30, 0));
        await until(() => Math.abs(alice.state.players.get(carol!.sessionId).z - 30) < 0.01, 3000, 'carol in the sky');
        const before = shots.length;
        alice.send(MSG.shoot, poseOf(alice, 32, 40, 0));
        await until(() => shots.length > before, 3000, 'shot fired');
        expect(alice.state.players.get(carol.sessionId).hp).toBe(100);
        carol.send(MSG.pose, poseOf(carol, 10, 10, 0)); // out of the firing line

        // Rounds 2 and 3 go red too: the limit ends the match. Streaks reset per
        // round, so Alice's second kill is streak 1, not 2.
        await wipe(2);
        expect(kills.at(-1)).toMatchObject({ killerId: alice.sessionId, streak: 1 });
        await until(() => alice.state.round === 3 && alice.state.roundPhase === 'live', 3000, 'round 3');
        await wipe(3);
        await until(() => alice.state.phase === 'ended', 3000, 'round limit ends the match');
        expect(alice.state.roundsRed).toBe(3);
        expect(alice.state.roundsBlue).toBe(0);
      } finally {
        await carol?.leave();
        await bob?.leave();
        await alice.leave();
      }
    }, 30000);

    it('drops attacks during the post-spawn freeze (3-2-1 countdown)', async () => {
      const alice: AnyRoom = await new Client(wsUrl).create(ROOM_NAME, {
        nickname: 'Alice',
        mode: 'td',
        roundLimit: 3,
        team: TEAM_RED,
        testOverrides: { spawnProtectMs: 0, roundIntermissionMs: 300, roundFreezeMs: 60_000 },
      });
      const shots: ShotMsg[] = [];
      listen(alice);
      alice.onMessage(MSG.shot, (m: ShotMsg) => shots.push(m));
      let bob: AnyRoom | null = null;
      try {
        await ready(alice);
        bob = await new Client(wsUrl).joinById(alice.roomId, { nickname: 'Bob', team: TEAM_BLUE });
        listen(bob);
        await ready(bob);
        bob.send(MSG.pose, poseOf(bob, 32, 30, 0));
        await until(() => Math.abs(alice.state.players.get(bob!.sessionId).z - 30) < 0.01, 3000, 'bob in the sky');
        alice.send(MSG.shoot, poseOf(alice, 32, 40, 0));
        await sleep(300);
        // Frozen: no shot broadcast, no damage, the round runs on.
        expect(shots).toHaveLength(0);
        expect(alice.state.players.get(bob.sessionId).hp).toBe(100);
        expect(alice.state.roundsRed).toBe(0);
      } finally {
        await bob?.leave();
        await alice.leave();
      }
    }, 20000);

    it('bots split over both teams and spawn into round 1', async () => {
      const alice: AnyRoom = await new Client(wsUrl).create(ROOM_NAME, {
        nickname: 'Alice',
        mode: 'td',
        bots: 2,
        team: TEAM_RED,
        testOverrides: { spawnProtectMs: 0, roundIntermissionMs: 500, roundFreezeMs: 0 },
      });
      listen(alice);
      try {
        await ready(alice);
        expect(alice.state.players.get('bot1').team).toBe(TEAM_RED);
        expect(alice.state.players.get('bot2').team).toBe(TEAM_BLUE);
        expect(alice.state.players.get('bot2').alive).toBe(true);
        // Bots play: the blue bot leaves its spawn (for a gun, an enemy or the crossroads).
        const start = { x: alice.state.players.get('bot2').x, z: alice.state.players.get('bot2').z };
        await until(() => Math.hypot(alice.state.players.get('bot2').x - start.x, alice.state.players.get('bot2').z - start.z) > 4, 5000, 'bot moves');
      } finally {
        await alice.leave();
      }
    }, 20000);
  });
});
