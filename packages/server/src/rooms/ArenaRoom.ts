import { Room } from 'colyseus';
import type { Client } from 'colyseus';
import {
  ENDED_LINGER_MS,
  PHYSICS_DT,
  SERVER_TICK_MS,
  createBot,
  createPhysState,
  stepPlayer,
  GUN_RANGE,
  GUN_SERVER_MIN_INTERVAL_MS,
  MAX_PLAYERS,
  MSG,
  PLAYER_COLOR_COUNT,
  RESPAWN_MS,
  SWORD_SERVER_MIN_INTERVAL_MS,
  WEAPON_GUN,
  WEAPON_SWORD,
  createRng,
  generateWorld,
  hashSeed,
  pickSpawn,
  resolveShot,
  swordVictims,
} from '@mineshoot/shared';
import type { Bot, BotView, KillMsg, PlayerPhysState, PlayerPose, ShotMsg, ShotTarget, SpawnPoint, Weapon, World } from '@mineshoot/shared';
import { PlayerSchema, RoomState } from './schema';
import { parseBotCount, parseDurationMin, parsePose, parseShoot, parseSwing, sanitizeName, sanitizeRoomName } from './validate';

/** Server-only per-player bookkeeping (not synced). */
interface PlayerMeta {
  respawnAt: number;
  lastShotAt: number;
  lastSwingAt: number;
}

/** Test-only knobs (honoured only when MINESHOOT_TEST=1). */
interface TestOverrides {
  durationMs?: number;
  respawnMs?: number;
  lingerMs?: number;
}

/** Server-side bot runtime: brain + simulated body. */
interface BotRuntime {
  brain: Bot;
  phys: PlayerPhysState;
}

interface CreateOptionsRaw {
  name?: unknown;
  durationMin?: unknown;
  bots?: unknown;
  nickname?: unknown;
  testOverrides?: TestOverrides;
}

export class ArenaRoom extends Room<RoomState> {
  maxClients = MAX_PLAYERS;

  private world!: World;
  private spawnPoints: SpawnPoint[] = [];
  private rng: () => number = Math.random;
  private endsAt = 0;
  private respawnMs = RESPAWN_MS;
  private lingerMs = ENDED_LINGER_MS;
  private readonly meta = new Map<string, PlayerMeta>();
  private readonly bots = new Map<string, BotRuntime>();
  private botAcc = 0;

  onCreate(options: CreateOptionsRaw = {}): void {
    this.state = new RoomState();
    this.state.name = sanitizeRoomName(options.name, `Arena ${this.roomId.slice(0, 4)}`);
    this.state.durationMin = parseDurationMin(options.durationMin);
    const botCount = parseBotCount(options.bots);
    // Bots occupy player slots: humans + bots never exceed MAX_PLAYERS.
    this.maxClients = MAX_PLAYERS - botCount;
    let durationMs = this.state.durationMin * 60_000;
    if (process.env.MINESHOOT_TEST === '1' && options.testOverrides) {
      const t = options.testOverrides;
      if (typeof t.durationMs === 'number') durationMs = t.durationMs;
      if (typeof t.respawnMs === 'number') this.respawnMs = t.respawnMs;
      if (typeof t.lingerMs === 'number') this.lingerMs = t.lingerMs;
    }

    const seed = hashSeed(`${this.roomId}:${Date.now()}`);
    this.state.seed = seed;
    const gen = generateWorld(seed);
    this.world = gen.world;
    this.spawnPoints = gen.spawnPoints;
    this.rng = createRng(seed ^ 0xabcdef);

    this.endsAt = Date.now() + durationMs;
    this.state.timeLeftMs = durationMs;
    this.setMetadata({ name: this.state.name, durationMin: this.state.durationMin, endsAt: this.endsAt, bots: botCount });

    this.onMessage(MSG.pose, (client, raw: unknown) => this.handlePose(client, raw));
    this.onMessage(MSG.shoot, (client, raw: unknown) => this.handleShoot(client, raw));
    this.onMessage(MSG.swing, (client, raw: unknown) => this.handleSwing(client, raw));
    this.onMessage(MSG.ping, (client, t: unknown) => {
      if (typeof t === 'number') client.send(MSG.pong, t);
    });

    this.clock.setInterval(() => this.tickRespawns(), 50);
    this.clock.setInterval(() => this.tickTimer(), 1000);

    for (let i = 0; i < botCount; i++) this.addBot(i + 1);
    if (botCount > 0) this.setSimulationInterval((deltaMs) => this.pumpBots(deltaMs), SERVER_TICK_MS);
  }

  private addBot(n: number): void {
    const id = `bot${n}`;
    const p = new PlayerSchema();
    p.name = `Bot ${n}`;
    p.isBot = true;
    p.color = this.freeColor();
    this.state.players.set(id, p);
    this.meta.set(id, { respawnAt: 0, lastShotAt: 0, lastSwingAt: 0 });
    this.bots.set(id, { brain: createBot(createRng(this.state.seed + n * 7919), this.spawnPoints), phys: createPhysState(0, 0, 0) });
    this.spawn(id, p);
  }

  /** Fixed-timestep bot simulation off measured elapsed time (same pattern as bomberman). */
  private pumpBots(deltaMs: number): void {
    this.botAcc = Math.min(this.botAcc + deltaMs, 250);
    while (this.botAcc >= SERVER_TICK_MS) {
      this.botAcc -= SERVER_TICK_MS;
      this.tickBots();
    }
  }

  private tickBots(): void {
    if (this.state.phase !== 'playing') return;
    const now = Date.now();
    const dt = SERVER_TICK_MS / 1000;
    for (const [id, rt] of this.bots) {
      const p = this.state.players.get(id);
      if (!p || !p.alive) continue;
      const enemies: BotView['enemies'] = [];
      for (const [sid, other] of this.state.players) {
        if (sid !== id && other.alive) enemies.push({ id: sid, x: other.x, y: other.y, z: other.z });
      }
      const d = rt.brain.compute(this.world, { self: rt.phys, enemies, now }, dt);
      let phys = { ...rt.phys, yaw: d.yaw, pitch: d.pitch };
      const substeps = Math.round(dt / PHYSICS_DT);
      for (let i = 0; i < substeps; i++) phys = stepPlayer(this.world, phys, d.input, PHYSICS_DT);
      rt.phys = phys;
      this.applyPose(p, phys);
      if (p.weapon !== d.weapon) p.weapon = d.weapon;
      if (d.shoot) this.attackShoot(id, p, phys, now);
      if (d.swing) this.attackSwing(id, p, phys, now);
    }
  }

  onJoin(client: Client, options?: { nickname?: unknown }): void {
    const p = new PlayerSchema();
    p.name = sanitizeName(options?.nickname, `Player${this.state.players.size + 1}`);
    p.color = this.freeColor();
    this.state.players.set(client.sessionId, p);
    this.meta.set(client.sessionId, { respawnAt: 0, lastShotAt: 0, lastSwingAt: 0 });
    this.spawn(client.sessionId, p);
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    this.meta.delete(client.sessionId);
  }

  // --- messages ---

  private applyPose(p: PlayerSchema, m: { x: number; y: number; z: number; yaw: number; pitch: number }): void {
    if (p.x !== m.x) p.x = m.x;
    if (p.y !== m.y) p.y = m.y;
    if (p.z !== m.z) p.z = m.z;
    if (p.yaw !== m.yaw) p.yaw = m.yaw;
    if (p.pitch !== m.pitch) p.pitch = m.pitch;
  }

  /** The player may act only while alive, in the current spawn epoch, during play. */
  private actor(client: Client, epoch: number): PlayerSchema | null {
    if (this.state.phase !== 'playing') return null;
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive || p.spawnEpoch !== epoch) return null;
    return p;
  }

  private handlePose(client: Client, raw: unknown): void {
    const m = parsePose(raw);
    if (!m) return;
    const p = this.actor(client, m.epoch);
    if (!p) return;
    this.applyPose(p, m);
    if (p.weapon !== m.weapon) p.weapon = m.weapon;
  }

  private targetsExcluding(id: string): ShotTarget[] {
    const out: ShotTarget[] = [];
    for (const [sid, other] of this.state.players) {
      if (sid === id || !other.alive) continue;
      out.push({ id: sid, pose: { x: other.x, y: other.y, z: other.z } });
    }
    return out;
  }

  private handleShoot(client: Client, raw: unknown): void {
    const m = parseShoot(raw);
    if (!m) return;
    const p = this.actor(client, m.epoch);
    if (!p) return;
    this.applyPose(p, m);
    this.attackShoot(client.sessionId, p, m, Date.now());
  }

  /** Server-authoritative gun shot for humans and bots alike (rate-limited per shooter). */
  private attackShoot(id: string, p: PlayerSchema, pose: PlayerPose, now: number): void {
    const meta = this.meta.get(id)!;
    if (now - meta.lastShotAt < GUN_SERVER_MIN_INTERVAL_MS) return;
    meta.lastShotAt = now;
    if (p.weapon !== WEAPON_GUN) p.weapon = WEAPON_GUN;

    const result = resolveShot(this.world, pose, this.targetsExcluding(id), GUN_RANGE);
    const shot: ShotMsg = {
      shooterId: id,
      from: result.from,
      to: result.to,
      hitPlayerId: result.hitPlayerId ?? '',
    };
    this.broadcast(MSG.shot, shot);
    if (result.hitPlayerId) this.kill(id, result.hitPlayerId, WEAPON_GUN);
  }

  private handleSwing(client: Client, raw: unknown): void {
    const m = parseSwing(raw);
    if (!m) return;
    const p = this.actor(client, m.epoch);
    if (!p) return;
    this.applyPose(p, m);
    this.attackSwing(client.sessionId, p, m, Date.now());
  }

  private attackSwing(id: string, p: PlayerSchema, pose: PlayerPose, now: number): void {
    const meta = this.meta.get(id)!;
    if (now - meta.lastSwingAt < SWORD_SERVER_MIN_INTERVAL_MS) return;
    meta.lastSwingAt = now;
    if (p.weapon !== WEAPON_SWORD) p.weapon = WEAPON_SWORD;

    for (const victim of swordVictims(this.world, pose, this.targetsExcluding(id))) {
      this.kill(id, victim, WEAPON_SWORD);
    }
  }

  // --- combat / lifecycle ---

  private kill(killerId: string, victimId: string, weapon: Weapon): void {
    const victim = this.state.players.get(victimId);
    if (!victim || !victim.alive) return;
    const killer = this.state.players.get(killerId);
    victim.alive = false;
    victim.deaths++;
    if (killer) killer.kills++;
    const meta = this.meta.get(victimId);
    if (meta) meta.respawnAt = Date.now() + this.respawnMs;
    const msg: KillMsg = {
      killerId,
      killerName: killer?.name ?? '?',
      victimId,
      victimName: victim.name,
      weapon,
    };
    this.broadcast(MSG.kill, msg);
  }

  private spawn(id: string, p: PlayerSchema): void {
    const enemies: { x: number; z: number }[] = [];
    for (const [sid, other] of this.state.players) {
      if (sid !== id && other.alive) enemies.push({ x: other.x, z: other.z });
    }
    const s = pickSpawn(this.spawnPoints, enemies, this.rng);
    p.x = s.x;
    p.y = s.y;
    p.z = s.z;
    p.yaw = this.rng() * Math.PI * 2;
    p.pitch = 0;
    p.alive = true;
    p.spawnEpoch = (p.spawnEpoch + 1) & 0xffff;
    const bot = this.bots.get(id);
    if (bot) {
      bot.phys = createPhysState(p.x, p.y, p.z, p.yaw);
      bot.brain.reset();
    }
  }

  private tickRespawns(): void {
    if (this.state.phase !== 'playing') return;
    const now = Date.now();
    for (const [id, p] of this.state.players) {
      if (p.alive) continue;
      const meta = this.meta.get(id);
      if (meta && now >= meta.respawnAt) this.spawn(id, p);
    }
  }

  private tickTimer(): void {
    if (this.state.phase !== 'playing') return;
    const left = Math.max(0, this.endsAt - Date.now());
    this.state.timeLeftMs = left;
    if (left <= 0) this.endMatch();
  }

  private endMatch(): void {
    this.state.phase = 'ended';
    this.state.timeLeftMs = 0;
    void this.lock();
    this.clock.setTimeout(() => void this.disconnect(), this.lingerMs);
  }

  private freeColor(): number {
    const used = new Set<number>();
    for (const p of this.state.players.values()) used.add(p.color);
    for (let c = 0; c < PLAYER_COLOR_COUNT; c++) if (!used.has(c)) return c;
    return Math.floor(this.rng() * PLAYER_COLOR_COUNT);
  }
}
