import { Room } from 'colyseus';
import type { Client } from 'colyseus';
import {
  ENDED_LINGER_MS,
  PHYSICS_DT,
  SERVER_TICK_MS,
  createBot,
  createPhysState,
  stepPlayer,
  GUN_MAG_SIZE,
  KillTracker,
  GUN_RANGE,
  GUN_RELOAD_MS,
  GUN_RELOAD_SERVER_MIN_MS,
  GUN_SERVER_MIN_INTERVAL_MS,
  MAX_HP,
  MAX_PLAYERS,
  MSG,
  PLAYER_COLOR_COUNT,
  RESPAWN_MS,
  SPAWN_PROTECT_MS,
  SWORD_CHARGE_MS,
  SWORD_SERVER_MIN_INTERVAL_MS,
  WEAPON_GUN,
  WEAPON_SWORD,
  createRng,
  defaultWeapon,
  generateWorld,
  hashSeed,
  pickSpawn,
  resolveShot,
  swordDamage,
  swordVictims,
  weaponAllowed,
} from '@mineshoot/shared';
import type { Bot, BotView, HitMsg, KillMsg, PlayerPhysState, PlayerPose, ShotMsg, ShotTarget, SpawnPoint, SwungMsg, Weapon, WeaponMode, World } from '@mineshoot/shared';
import { PlayerSchema, RoomState } from './schema';
import {
  parseBotCount,
  parseCharge,
  parseDurationMin,
  parsePose,
  parseReload,
  parseShoot,
  parseSwing,
  parseWeaponMode,
  sanitizeName,
  sanitizeRoomName,
} from './validate';

/** Server-only per-player bookkeeping (not synced). */
interface PlayerMeta {
  /** False until the client clicks to play (MSG.ready); the player is not spawned before that. Bots are always ready. */
  ready: boolean;
  respawnAt: number;
  /** Spawn protection: cannot be targeted or damaged before this time (0 = none). */
  protectedUntil: number;
  lastShotAt: number;
  lastSwingAt: number;
  /** When the player started holding the sword button (0 = not charging). */
  chargeStartAt: number;
  /** Rounds left in the gun magazine. */
  ammo: number;
  /** When the running reload completes (0 = not reloading). */
  reloadDoneAt: number;
}

const freshMeta = (ready: boolean): PlayerMeta => ({
  ready,
  respawnAt: 0,
  protectedUntil: 0,
  lastShotAt: 0,
  lastSwingAt: 0,
  chargeStartAt: 0,
  ammo: GUN_MAG_SIZE,
  reloadDoneAt: 0,
});

/** Test-only knobs (honoured only when MINESHOOT_TEST=1). */
interface TestOverrides {
  durationMs?: number;
  respawnMs?: number;
  lingerMs?: number;
  spawnProtectMs?: number;
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
  weapons?: unknown;
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
  private spawnProtectMs = SPAWN_PROTECT_MS;
  private lingerMs = ENDED_LINGER_MS;
  private weaponMode: WeaponMode = 'all';
  private readonly meta = new Map<string, PlayerMeta>();
  private readonly bots = new Map<string, BotRuntime>();
  private readonly killTracker = new KillTracker();
  private botAcc = 0;

  onCreate(options: CreateOptionsRaw = {}): void {
    this.state = new RoomState();
    this.state.name = sanitizeRoomName(options.name, `Arena ${this.roomId.slice(0, 4)}`);
    this.state.durationMin = parseDurationMin(options.durationMin);
    this.weaponMode = parseWeaponMode(options.weapons);
    this.state.weapons = this.weaponMode;
    const botCount = parseBotCount(options.bots);
    // Bots occupy player slots: humans + bots never exceed MAX_PLAYERS.
    this.maxClients = MAX_PLAYERS - botCount;
    let durationMs = this.state.durationMin * 60_000;
    if (process.env.MINESHOOT_TEST === '1' && options.testOverrides) {
      const t = options.testOverrides;
      if (typeof t.durationMs === 'number') durationMs = t.durationMs;
      if (typeof t.respawnMs === 'number') this.respawnMs = t.respawnMs;
      if (typeof t.lingerMs === 'number') this.lingerMs = t.lingerMs;
      if (typeof t.spawnProtectMs === 'number') this.spawnProtectMs = t.spawnProtectMs;
    }

    const seed = hashSeed(`${this.roomId}:${Date.now()}`);
    this.state.seed = seed;
    const gen = generateWorld(seed);
    this.world = gen.world;
    this.spawnPoints = gen.spawnPoints;
    this.rng = createRng(seed ^ 0xabcdef);

    this.endsAt = Date.now() + durationMs;
    this.state.timeLeftMs = durationMs;
    this.setMetadata({
      name: this.state.name,
      durationMin: this.state.durationMin,
      endsAt: this.endsAt,
      bots: botCount,
      weapons: this.weaponMode,
    });

    this.onMessage(MSG.pose, (client, raw: unknown) => this.handlePose(client, raw));
    this.onMessage(MSG.shoot, (client, raw: unknown) => this.handleShoot(client, raw));
    this.onMessage(MSG.swing, (client, raw: unknown) => this.handleSwing(client, raw));
    this.onMessage(MSG.charge, (client, raw: unknown) => this.handleCharge(client, raw));
    this.onMessage(MSG.reload, (client, raw: unknown) => this.handleReload(client, raw));
    this.onMessage(MSG.ready, (client) => this.handleReady(client));
    this.onMessage(MSG.ping, (client, t: unknown) => {
      if (typeof t === 'number') client.send(MSG.pong, t);
    });

    this.clock.setInterval(() => this.tickLifecycle(), 50);
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
    this.meta.set(id, freshMeta(true));
    this.bots.set(id, {
      brain: createBot(createRng(this.state.seed + n * 7919), this.spawnPoints, { weapons: this.weaponMode }),
      phys: createPhysState(0, 0, 0),
    });
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
        if (sid !== id && this.targetable(sid, other, now)) enemies.push({ id: sid, x: other.x, y: other.y, z: other.z });
      }
      const d = rt.brain.compute(this.world, { self: rt.phys, enemies, now }, dt);
      let phys = { ...rt.phys, yaw: d.yaw, pitch: d.pitch };
      const substeps = Math.round(dt / PHYSICS_DT);
      for (let i = 0; i < substeps; i++) phys = stepPlayer(this.world, phys, d.input, PHYSICS_DT);
      rt.phys = phys;
      this.applyPose(p, phys);
      if (p.weapon !== d.weapon) p.weapon = d.weapon;
      if (d.shoot) this.attackShoot(id, p, phys, now);
      if (d.swing) this.attackSwing(id, p, phys, now, false);
    }
  }

  onJoin(client: Client, options?: { nickname?: unknown }): void {
    const p = new PlayerSchema();
    p.name = sanitizeName(options?.nickname, `Player${this.state.players.size + 1}`);
    p.color = this.freeColor();
    this.state.players.set(client.sessionId, p);
    this.meta.set(client.sessionId, freshMeta(false));
    // Not spawned until the client clicks to play (MSG.ready): parked at a spawn point, not alive,
    // so nobody can target them and their own inputs are ignored. Their camera previews the arena.
    p.alive = false;
    const s = pickSpawn(this.spawnPoints, [], this.rng);
    p.x = s.x;
    p.y = s.y;
    p.z = s.z;
  }

  /** "Click to play": spawn the player for real. Later readies (pointer re-lock) are ignored. */
  private handleReady(client: Client): void {
    if (this.state.phase !== 'playing') return;
    const p = this.state.players.get(client.sessionId);
    const meta = this.meta.get(client.sessionId);
    if (!p || !meta || meta.ready) return;
    meta.ready = true;
    this.spawn(client.sessionId, p);
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    this.meta.delete(client.sessionId);
    this.killTracker.remove(client.sessionId);
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
    if (weaponAllowed(this.weaponMode, m.weapon) && p.weapon !== m.weapon) {
      p.weapon = m.weapon;
      // Putting the sword away drops a pending charge. (A charge may legitimately arrive
      // before the pose that switches to the sword, so only the gun cancels it.)
      if (m.weapon !== WEAPON_SWORD) {
        this.meta.get(client.sessionId)!.chargeStartAt = 0;
        this.syncFlags(client.sessionId, p, Date.now());
      }
    }
  }

  /** Mirror transient meta timers into the synced schema (charging / reloading). */
  private syncFlags(id: string, p: PlayerSchema, now: number): void {
    const meta = this.meta.get(id);
    if (!meta) return;
    const charging = p.alive && meta.chargeStartAt > 0;
    const reloading = p.alive && meta.reloadDoneAt > 0 && now < meta.reloadDoneAt;
    if (p.charging !== charging) p.charging = charging;
    if (p.reloading !== reloading) p.reloading = reloading;
  }

  /** Alive and not under spawn protection. */
  private targetable(id: string, p: PlayerSchema, now: number): boolean {
    if (!p.alive) return false;
    const meta = this.meta.get(id);
    return !meta || now >= meta.protectedUntil;
  }

  private targetsExcluding(id: string, now: number): ShotTarget[] {
    const out: ShotTarget[] = [];
    for (const [sid, other] of this.state.players) {
      if (sid === id || !this.targetable(sid, other, now)) continue;
      out.push({ id: sid, pose: { x: other.x, y: other.y, z: other.z } });
    }
    return out;
  }

  /** Attacking forfeits spawn protection. */
  private dropProtection(p: PlayerSchema, meta: PlayerMeta): void {
    meta.protectedUntil = 0;
    if (p.shielded) p.shielded = false;
  }

  /**
   * Take one round from the magazine. A shot that arrives mid-reload with rounds
   * left means the client cancelled the reload (weapon switch), so it is honoured;
   * with an empty magazine it is dropped. Bots reload automatically.
   */
  private takeRound(id: string, meta: PlayerMeta, now: number): boolean {
    if (meta.reloadDoneAt) {
      if (now >= meta.reloadDoneAt) {
        meta.ammo = GUN_MAG_SIZE;
        meta.reloadDoneAt = 0;
      } else if (meta.ammo > 0) {
        meta.reloadDoneAt = 0;
      } else {
        return false;
      }
    }
    if (meta.ammo <= 0) {
      if (this.bots.has(id)) meta.reloadDoneAt = now + GUN_RELOAD_MS;
      return false;
    }
    meta.ammo--;
    return true;
  }

  private handleReload(client: Client, raw: unknown): void {
    if (!weaponAllowed(this.weaponMode, WEAPON_GUN)) return;
    const epoch = parseReload(raw);
    if (epoch === null) return;
    const p = this.actor(client, epoch);
    if (!p) return;
    const meta = this.meta.get(client.sessionId)!;
    if (meta.reloadDoneAt || meta.ammo >= GUN_MAG_SIZE) return;
    const now = Date.now();
    meta.reloadDoneAt = now + GUN_RELOAD_SERVER_MIN_MS;
    this.syncFlags(client.sessionId, p, now);
  }

  private handleShoot(client: Client, raw: unknown): void {
    if (!weaponAllowed(this.weaponMode, WEAPON_GUN)) return;
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
    const fired = this.takeRound(id, meta, now);
    this.syncFlags(id, p, now);
    if (!fired) return;
    meta.lastShotAt = now;
    if (p.weapon !== WEAPON_GUN) p.weapon = WEAPON_GUN;
    this.dropProtection(p, meta);

    const result = resolveShot(this.world, pose, this.targetsExcluding(id, now), GUN_RANGE);
    const shot: ShotMsg = {
      shooterId: id,
      from: result.from,
      to: result.to,
      hitPlayerId: result.hitPlayerId ?? '',
      part: result.part ?? '',
      damage: result.damage,
    };
    this.broadcast(MSG.shot, shot);
    if (result.hitPlayerId) this.damage(id, result.hitPlayerId, result.damage, WEAPON_GUN, result.part === 'head');
  }

  /** Player started holding the sword button: remember when, so a later swing can be verified as charged. */
  private handleCharge(client: Client, raw: unknown): void {
    if (!weaponAllowed(this.weaponMode, WEAPON_SWORD)) return;
    const epoch = parseCharge(raw);
    if (epoch === null) return;
    const p = this.actor(client, epoch);
    if (!p) return;
    const now = Date.now();
    this.meta.get(client.sessionId)!.chargeStartAt = now;
    if (p.weapon !== WEAPON_SWORD) p.weapon = WEAPON_SWORD;
    this.syncFlags(client.sessionId, p, now);
  }

  private handleSwing(client: Client, raw: unknown): void {
    if (!weaponAllowed(this.weaponMode, WEAPON_SWORD)) return;
    const m = parseSwing(raw);
    if (!m) return;
    const p = this.actor(client, m.epoch);
    if (!p) return;
    this.applyPose(p, m);
    this.attackSwing(client.sessionId, p, m, Date.now(), m.charged);
  }

  /**
   * Server-authoritative sword swing. A swing counts as charged only if the
   * client announced the charge (MSG.charge) at least SWORD_CHARGE_MS earlier.
   */
  private attackSwing(id: string, p: PlayerSchema, pose: PlayerPose, now: number, wantsCharged: boolean): void {
    const meta = this.meta.get(id)!;
    const charged = wantsCharged && meta.chargeStartAt > 0 && now - meta.chargeStartAt >= SWORD_CHARGE_MS;
    meta.chargeStartAt = 0;
    this.syncFlags(id, p, now);
    if (now - meta.lastSwingAt < SWORD_SERVER_MIN_INTERVAL_MS) return;
    meta.lastSwingAt = now;
    if (p.weapon !== WEAPON_SWORD) p.weapon = WEAPON_SWORD;
    this.dropProtection(p, meta);
    const swung: SwungMsg = { attackerId: id, charged };
    this.broadcast(MSG.swung, swung);

    for (const victim of swordVictims(this.world, pose, this.targetsExcluding(id, now), charged)) {
      const dmg = swordDamage(victim.part, charged);
      const hit: HitMsg = { attackerId: id, victimId: victim.id, part: victim.part, damage: dmg, charged };
      this.broadcast(MSG.hit, hit);
      this.damage(id, victim.id, dmg, WEAPON_SWORD, victim.part === 'head');
    }
  }

  // --- combat / lifecycle ---

  /** Subtract HP from a living victim; a drop to 0 is a kill credited to the attacker. */
  private damage(attackerId: string, victimId: string, amount: number, weapon: Weapon, headshot: boolean): void {
    const victim = this.state.players.get(victimId);
    if (!victim || !this.targetable(victimId, victim, Date.now())) return;
    victim.hp = Math.max(0, victim.hp - amount);
    if (victim.hp === 0) this.kill(attackerId, victimId, weapon, headshot);
  }

  private kill(killerId: string, victimId: string, weapon: Weapon, headshot: boolean): void {
    const victim = this.state.players.get(victimId);
    if (!victim || !victim.alive) return;
    const killer = this.state.players.get(killerId);
    const now = Date.now();
    victim.alive = false;
    victim.deaths++;
    if (killer) killer.kills++;
    const meta = this.meta.get(victimId);
    if (meta) meta.respawnAt = now + this.respawnMs;
    const awards = this.killTracker.recordKill(killerId, victimId, now);
    const msg: KillMsg = {
      ...awards,
      killerId,
      killerName: killer?.name ?? '?',
      victimId,
      victimName: victim.name,
      weapon,
      headshot,
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
    p.hp = MAX_HP;
    p.weapon = defaultWeapon(this.weaponMode);
    p.shielded = this.spawnProtectMs > 0;
    const meta = this.meta.get(id);
    if (meta) {
      meta.chargeStartAt = 0;
      meta.protectedUntil = this.spawnProtectMs > 0 ? Date.now() + this.spawnProtectMs : 0;
      meta.ammo = GUN_MAG_SIZE;
      meta.reloadDoneAt = 0;
    }
    p.spawnEpoch = (p.spawnEpoch + 1) & 0xffff;
    const bot = this.bots.get(id);
    if (bot) {
      bot.phys = createPhysState(p.x, p.y, p.z, p.yaw);
      bot.brain.reset();
    }
  }

  /** Respawn timers and spawn-protection expiry. Unready players (never clicked to play) stay unspawned. */
  private tickLifecycle(): void {
    if (this.state.phase !== 'playing') return;
    const now = Date.now();
    for (const [id, p] of this.state.players) {
      const meta = this.meta.get(id);
      if (!meta || !meta.ready) continue;
      if (!p.alive) {
        if (now >= meta.respawnAt) this.spawn(id, p);
      } else if (p.shielded && now >= meta.protectedUntil) {
        p.shielded = false;
      }
      this.syncFlags(id, p, now);
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
