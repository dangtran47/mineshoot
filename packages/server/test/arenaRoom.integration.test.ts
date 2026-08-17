import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { Client } from 'colyseus.js';
import type { Room } from 'colyseus.js';
import {
  EYE_HEIGHT,
  GUN_MAG_SIZE,
  GUN_RELOAD_SERVER_MIN_MS,
  GUN_SERVER_MIN_INTERVAL_MS,
  MSG,
  PLAYER_HALF_W,
  ROOM_NAME,
  SWORD_CHARGE_MS,
  SWORD_SERVER_MIN_INTERVAL_MS,
  WEAPON_GUN,
  WEAPON_SWORD,
} from '@mineshoot/shared';
import type { HitMsg, KillMsg, ShotMsg, SwungMsg } from '@mineshoot/shared';
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
function poseOf(room: AnyRoom, x: number, z: number, yaw: number, weapon = WEAPON_GUN, pitch = 0): Record<string, number> {
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
    alice.onMessage(MSG.shot, (m: ShotMsg) => shots.push(m));
    alice.onMessage(MSG.hit, (m: HitMsg) => hits.push(m));
    alice.onMessage(MSG.kill, (m: KillMsg) => kills.push(m));

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
      const chest = poseOf(alice, 32, 40, 0, WEAPON_GUN, pitchToHeight(1.0, 10));
      alice.send(MSG.shoot, chest);
      alice.send(MSG.shoot, chest);
      await until(() => shots.length === 1, 3000, 'shot broadcast');
      await sleep(100);
      expect(shots).toHaveLength(1);
      expect(shots[0].shooterId).toBe(alice.sessionId);
      expect(shots[0].hitPlayerId).toBe(bob.sessionId);
      expect(shots[0].part).toBe('torso');
      expect(shots[0].damage).toBe(30);
      await until(() => bobView().hp === 70, 3000, 'bob hp 70');
      expect(bobView().alive).toBe(true);
      expect(kills).toHaveLength(0);

      // After the rate limit lapses, a level shot is a headshot: 100 damage → kill.
      await sleep(250);
      alice.send(MSG.shoot, poseOf(alice, 32, 40, 0));
      await until(() => kills.length === 1, 3000, 'kill broadcast');
      await sleep(100);
      expect(shots).toHaveLength(2);
      expect(shots[1]).toMatchObject({ hitPlayerId: bob.sessionId, part: 'head', damage: 100 });
      expect(kills[0]).toMatchObject({
        killerId: alice.sessionId,
        killerName: 'Alice',
        victimId: bob.sessionId,
        victimName: 'Bob',
        weapon: WEAPON_GUN,
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
      bob.send(MSG.pose, poseOf(bob, 32, 42, 0, WEAPON_SWORD)); // 2 blocks behind Alice, facing -Z toward her
      await until(() => Math.abs(bobView().z - 42) < 0.01, 3000, 'bob repositioned');
      // Claiming `charged` without having announced a charge is treated as a normal swing.
      bob.send(MSG.swing, { ...poseOf(bob, 32, 42, 0), charged: true });
      await until(() => hits.length === 1, 3000, 'sword hit');
      expect(hits[0]).toMatchObject({ attackerId: bob.sessionId, victimId: alice.sessionId, part: 'head', damage: 45, charged: false });
      await until(() => me(alice).hp === 55, 3000, 'alice hp 55');
      expect(kills).toHaveLength(1);

      // Charged swing: announce the charge, hold ≥ SWORD_CHARGE_MS, release aiming at the chest → 70 → kill.
      bob.send(MSG.charge, me(bob).spawnEpoch);
      await sleep(SWORD_CHARGE_MS + 100);
      bob.send(MSG.swing, { ...poseOf(bob, 32, 42, 0, WEAPON_SWORD, pitchToHeight(1.0, 2)), charged: true });
      await until(() => kills.length === 2, 3000, 'sword kill');
      expect(hits[1]).toMatchObject({ victimId: alice.sessionId, part: 'body', damage: 70, charged: true });
      // Body hit, and Bob was last killed by Alice → revenge.
      expect(kills[1]).toMatchObject({
        killerId: bob.sessionId,
        victimId: alice.sessionId,
        weapon: WEAPON_SWORD,
        headshot: false,
        multi: 1,
        streak: 1,
        revenge: true,
        shutdown: false,
      });
      await until(() => me(alice).deaths === 1 && me(bob!).kills === 1, 3000, 'counters');
      await until(() => me(alice).alive && me(alice).spawnEpoch === 2, 3000, 'alice respawned');

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
  });

  it('adds bots that occupy slots, move around and hunt players', async () => {
    const room: AnyRoom = await new Client(wsUrl).create(ROOM_NAME, {
      nickname: 'Human',
      durationMin: 5,
      bots: 2,
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
      expect(listed.maxClients).toBe(6); // 8 - 2 bots
      expect(listed.metadata.bots).toBe(2);

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
      expect(shots[0].hitPlayerId).toBe('');
      expect(shots[0].damage).toBe(0);
      await sleep(100);
      expect(bobView().hp).toBe(100);
      expect(bobView().alive).toBe(true);

      // Once the shield lapses, the same shot connects.
      await until(() => bobView().shielded === false, PROTECT + 1000, 'bob protection expired');
      alice.send(MSG.shoot, poseOf(alice, 32, 40, 0));
      const secondShotAt = Date.now();
      await until(() => shots.length === 2, 3000, 'second shot');
      expect(shots[1]).toMatchObject({ hitPlayerId: bob.sessionId, part: 'head', damage: 100 });
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
      expect(shots[2]).toMatchObject({ hitPlayerId: '', damage: 0 });
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
      alice.send(MSG.pose, poseOf(alice, 32, 40, 0, WEAPON_SWORD));
      await until(() => me(alice).charging === true, 2000, 'charging flag');
      await sleep(SWORD_CHARGE_MS + 100);
      alice.send(MSG.swing, { ...poseOf(alice, 32, 40, 0, WEAPON_SWORD), charged: true });
      await until(() => swings.length === 1, 2000, 'swung broadcast');
      expect(swings[0]).toEqual({ attackerId: alice.sessionId, charged: true });
      await until(() => me(alice).charging === false, 2000, 'charging cleared');

      // A light (uncharged) miss is broadcast too.
      await sleep(SWORD_SERVER_MIN_INTERVAL_MS + 20);
      alice.send(MSG.swing, { ...poseOf(alice, 32, 40, 0, WEAPON_SWORD), charged: false });
      await until(() => swings.length === 2, 2000, 'second swung');
      expect(swings[1]).toEqual({ attackerId: alice.sessionId, charged: false });

      // Switching to the gun cancels a pending charge.
      alice.send(MSG.charge, me(alice).spawnEpoch);
      await until(() => me(alice).charging === true, 2000, 'charging again');
      alice.send(MSG.pose, poseOf(alice, 32, 40, 0, WEAPON_GUN));
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

  it('restricts weapons to the room rule (sword-only rejects shots; gun-only rejects swings)', async () => {
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
    let gunRoom: AnyRoom | null = null;
    try {
      await ready(swordRoom);
      expect(swordRoom.state.weapons).toBe('sword');
      const listed = ((await (await fetch(`${httpUrl}/rooms`)).json()) as RoomListEntry[]).find((r) => r.roomId === swordRoom.roomId)!;
      expect(listed.metadata.weapons).toBe('sword');
      expect(me(swordRoom).weapon).toBe(WEAPON_SWORD); // spawned holding the sword

      bob = await new Client(wsUrl).joinById(swordRoom.roomId, { nickname: 'Bob' });
      bob.onMessage(MSG.shot, () => {});
      bob.onMessage(MSG.hit, () => {});
      bob.onMessage(MSG.kill, () => {});
      await ready(bob);
      const bobView = (): any => swordRoom.state.players.get(bob!.sessionId);
      bob.send(MSG.pose, poseOf(bob, 32, 30, 0, WEAPON_GUN)); // claiming the gun is ignored
      await until(() => Math.abs(bobView().x - 32) < 0.01, 3000, 'bob pose synced');
      expect(bobView().weapon).toBe(WEAPON_SWORD);

      // A gun shot is dropped outright: no broadcast, no damage.
      swordRoom.send(MSG.shoot, poseOf(swordRoom, 32, 40, 0));
      await sleep(200);
      expect(shots).toHaveLength(0);
      expect(bobView().hp).toBe(100);

      // The sword still works.
      swordRoom.send(MSG.pose, poseOf(swordRoom, 32, 32, 0, WEAPON_SWORD));
      await until(() => Math.abs(me(swordRoom).z - 32) < 0.01, 3000, 'alice repositioned');
      swordRoom.send(MSG.swing, { ...poseOf(swordRoom, 32, 32, 0, WEAPON_SWORD), charged: false });
      await until(() => hits.length === 1, 3000, 'sword hit');
      expect(hits[0].victimId).toBe(bob.sessionId);

      // Gun-only room: swings and charges are dropped, shots go through.
      gunRoom = await new Client(wsUrl).create(ROOM_NAME, {
        nickname: 'Carol',
        durationMin: 3,
        weapons: 'gun',
        testOverrides: { spawnProtectMs: 0 },
      });
      const gunShots: ShotMsg[] = [];
      const gunHits: HitMsg[] = [];
      gunRoom.onMessage(MSG.shot, (m: ShotMsg) => gunShots.push(m));
      gunRoom.onMessage(MSG.hit, (m: HitMsg) => gunHits.push(m));
      gunRoom.onMessage(MSG.kill, () => {});
      await ready(gunRoom);
      expect(gunRoom.state.weapons).toBe('gun');
      gunRoom.send(MSG.swing, { ...poseOf(gunRoom, 32, 40, 0, WEAPON_SWORD), charged: false });
      gunRoom.send(MSG.shoot, poseOf(gunRoom, 32, 40, 0));
      await until(() => gunShots.length === 1, 3000, 'gun shot');
      await sleep(100);
      expect(gunHits).toHaveLength(0);
      expect(me(gunRoom).weapon).toBe(WEAPON_GUN);
    } finally {
      await bob?.leave();
      await gunRoom?.leave();
      await swordRoom.leave();
    }
  });

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
});
