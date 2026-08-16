import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { Client } from 'colyseus.js';
import type { Room } from 'colyseus.js';
import { MSG, ROOM_NAME, WEAPON_GUN, WEAPON_SWORD } from '@mineshoot/shared';
import type { KillMsg, ShotMsg } from '@mineshoot/shared';
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
function poseOf(room: AnyRoom, x: number, z: number, yaw: number, weapon = WEAPON_GUN): Record<string, number> {
  return { x, y: SKY_Y, z, yaw, pitch: 0, epoch: me(room).spawnEpoch, weapon };
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
      testOverrides: { respawnMs: 200 },
    });
    const shots: ShotMsg[] = [];
    const kills: KillMsg[] = [];
    alice.onMessage(MSG.shot, (m: ShotMsg) => shots.push(m));
    alice.onMessage(MSG.kill, (m: KillMsg) => kills.push(m));

    let bob: AnyRoom | null = null;
    try {
      await until(() => me(alice) !== undefined, 3000, 'own player in state');
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
      await until(() => alice.state.players.size === 2 && me(bob!) !== undefined, 3000, 'bob visible');
      expect(alice.state.players.get(bob.sessionId).name).toBe('Bob');
      expect(alice.state.players.get(bob.sessionId).color).not.toBe(a.color);

      // Pose sync (Bob moves; Alice sees it). Wrong epoch is ignored.
      bob.send(MSG.pose, poseOf(bob, 32, 30, 0));
      await until(() => Math.abs(alice.state.players.get(bob!.sessionId).x - 32) < 0.01, 3000, 'bob pose synced');
      expect(alice.state.players.get(bob.sessionId).z).toBeCloseTo(30, 3);
      bob.send(MSG.pose, { ...poseOf(bob, 5, 5, 0), epoch: 99 });
      await sleep(150);
      expect(alice.state.players.get(bob.sessionId).x).toBeCloseTo(32, 3);

      // Alice shoots straight at Bob (yaw 0 → -Z), two shots quickly: 2nd is rate-limited.
      alice.send(MSG.shoot, poseOf(alice, 32, 40, 0));
      alice.send(MSG.shoot, poseOf(alice, 32, 40, 0));
      await until(() => kills.length === 1, 3000, 'kill broadcast');
      await sleep(100);
      expect(shots).toHaveLength(1);
      expect(shots[0].shooterId).toBe(alice.sessionId);
      expect(shots[0].hitPlayerId).toBe(bob.sessionId);
      expect(kills[0]).toMatchObject({
        killerId: alice.sessionId,
        killerName: 'Alice',
        victimId: bob.sessionId,
        victimName: 'Bob',
        weapon: WEAPON_GUN,
      });
      await until(() => bobKills.length === 1, 3000, 'bob got kill msg');
      await until(() => me(alice).kills === 1, 3000, 'alice kills');
      const bobView = (): any => alice.state.players.get(bob!.sessionId);
      await until(() => bobView().deaths === 1, 3000, 'bob deaths');
      // Bob might have respawned already (200ms), so check the death happened via counters, then respawn.
      await until(() => bobView().alive === true && bobView().spawnEpoch === 2, 3000, 'bob respawned');
      await until(() => me(bob!).spawnEpoch === 2, 3000, 'bob sees own epoch');

      // Poses sent while dead / with the stale epoch were dropped: Bob is at a spawn point, not (32,30).
      expect(Math.abs(bobView().x - 32) > 0.01 || Math.abs(bobView().z - 30) > 0.01).toBe(true);

      // Sword: Bob walks up in front of Alice and swings.
      await sleep(350); // let gun cooldown lapse (irrelevant for sword but keeps timings sane)
      alice.send(MSG.pose, poseOf(alice, 32, 40, 0));
      bob.send(MSG.pose, poseOf(bob, 32, 42, 0, WEAPON_SWORD)); // 2 blocks behind Alice, facing -Z toward her
      await until(() => Math.abs(bobView().z - 42) < 0.01, 3000, 'bob repositioned');
      bob.send(MSG.swing, poseOf(bob, 32, 42, 0));
      await until(() => kills.length === 2, 3000, 'sword kill');
      expect(kills[1]).toMatchObject({ killerId: bob.sessionId, victimId: alice.sessionId, weapon: WEAPON_SWORD });
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
      testOverrides: { respawnMs: 500 },
    });
    const kills: KillMsg[] = [];
    room.onMessage(MSG.kill, (m: KillMsg) => kills.push(m));
    room.onMessage(MSG.shot, () => {});
    try {
      await until(() => room.state?.players?.size === 3, 3000, 'bots in state');
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
