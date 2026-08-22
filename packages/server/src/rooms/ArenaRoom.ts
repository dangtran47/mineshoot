import { Room } from 'colyseus';
import type { Client } from 'colyseus';
import {
  ATTACK_HEAVY,
  ATTACK_LIGHT,
  CTF_DROP_INTERVAL_MAX_MS,
  CTF_DROP_INTERVAL_MIN_MS,
  CTF_DROP_MAX_ACTIVE,
  ENDED_LINGER_MS,
  FLAG_DROP_GRACE_MS,
  FLAG_RETURN_MS,
  TD_FREEZE_MS,
  TD_INTERMISSION_MS,
  TD_JOIN_GRACE_MS,
  TEAM_BLUE,
  TEAM_NONE,
  TEAM_RED,
  TEAMS,
  botCtfGoal,
  botRebalance,
  botTdGoal,
  canReturn,
  canScore,
  carriedFlag,
  columnTop,
  flagTouch,
  isCtf,
  isTd,
  isTeam,
  isTeamMode,
  pickTeam,
  roundWinner,
  tdWeaponLoadout,
  teamSpawns,
  PHYSICS_DT,
  SERVER_TICK_MS,
  DROP_INTERVAL_MAX_MS,
  DROP_INTERVAL_MIN_MS,
  DROP_LIFETIME_MS,
  DROP_THROWN_GRACE_MS,
  DROP_THROWN_LIFETIME_MS,
  DEFAULT_BOT_SKILL,
  DROP_MAX_ACTIVE,
  MELEE_SWORD,
  autoPickUpAllowed,
  canPickUp,
  createBot,
  createPhysState,
  MELEE_MIN_CHARGE_FRACTION,
  chargeFraction,
  pickDropKind,
  pickDropSpot,
  dropPool,
  stepPlayer,
  GUN_MAG_SIZE,
  GUN_NONE,
  GUN_PISTOL,
  GRENADE_MAX,
  GRENADE_SERVER_MIN_INTERVAL_MS,
  GRENADE_START,
  GRENADE_SUBSTEPS,
  KillTracker,
  MAX_HP,
  MAX_PLAYERS,
  MSG,
  PLAYER_COLOR_COUNT,
  RESPAWN_MS,
  SPAWN_PROTECT_MS,
  respawnMsFor,
  WEAPON_GRENADE,
  WEAPON_MELEE,
  WEAPON_PISTOL,
  WEAPON_PRIMARY,
  WEAPON_TASER,
  attackSpec,
  createRng,
  defaultWeapon,
  explosionVictims,
  eyePosition,
  generateWorldFor,
  grenadeFuseDone,
  gunSpec,
  hashSeed,
  interruptedReloadAmmo,
  meleeSelectable,
  pelletDirections,
  pickSpawn,
  resolveRay,
  TD_TEAM_SPAWN_COUNT,
  unoccupiedSpawns,
  serverReloadMs,
  spawnPrimary,
  spawnWeapon,
  stepGrenade,
  swordDamage,
  swordVictims,
  throwGrenade,
  weaponAllowed,
} from '@mineshoot/shared';
import type { AttackKind, Bot, BotSkill, BotView, DropSlot, ExplodeMsg, FlagEventKind, FlagEventMsg, FlagState, GrenadeState, GunKind, GunSpec, HitMsg, KillMsg, MeleeKind, PickupMsg, PlayerPhysState, PlayerPose, Rect, RoomMode, RoundEventMsg, RoundSide, ShotMsg, ShotRay, ShotTarget, SpawnPoint, SwungMsg, Team, Vec3, Weapon, WeaponMode, World } from '@mineshoot/shared';
import { DropSchema, FlagSchema, GrenadeSchema, PlayerSchema, RoomState } from './schema';
import {
  parseBotCount,
  parseBotSkill,
  parseCaptureLimit,
  parseRoundLimit,
  parseCharge,
  parseChargeCancel,
  parseDropFlag,
  parseDropWeapon,
  parseDurationMin,
  parsePose,
  parseReload,
  parseRoomMode,
  parseSelectWeapon,
  parseShoot,
  parseSwing,
  parseThrow,
  parseTeam,
  parseWeaponMode,
  sanitizeName,
  sanitizeRoomName,
} from './validate';

/** Server-only per-player bookkeeping (not synced). */
interface PlayerMeta {
  /** False until the client clicks to play (MSG.ready); the player is not spawned before that. Bots are always ready. */
  ready: boolean;
  /** TD: spawned into the running round (dead or alive); false while waiting for the next one. */
  inRound: boolean;
  /** TD: frozen (3-2-1 countdown) until this time after a spawn; attacks are dropped meanwhile (0 = not frozen). */
  frozenUntil: number;
  respawnAt: number;
  /** Spawn protection: cannot be targeted or damaged before this time (0 = none). */
  protectedUntil: number;
  /** Last shot per gun slot (rate limit per weapon, like the client's cooldowns). */
  lastShotAt: Record<number, number>;
  lastSwingAt: number;
  /** Which melee attack was swung last: its recovery gates the next swing. */
  lastAttack: AttackKind;
  /** When the player started holding the melee charge (0 = not charging). */
  chargeStartAt: number;
  /** Rounds left per gun slot (WEAPON_PISTOL / WEAPON_PRIMARY). */
  ammo: Record<number, number>;
  /** When the running reload of each gun slot completes (0 = not reloading). */
  reloadDoneAt: Record<number, number>;
  lastThrowAt: number;
}

const freshAmmo = (): Record<number, number> => ({ [WEAPON_PISTOL]: GUN_MAG_SIZE, [WEAPON_PRIMARY]: 0, [WEAPON_TASER]: 0 });
const freshReloads = (): Record<number, number> => ({ [WEAPON_PISTOL]: 0, [WEAPON_PRIMARY]: 0, [WEAPON_TASER]: 0 });

const freshMeta = (ready: boolean): PlayerMeta => ({
  ready,
  inRound: false,
  frozenUntil: 0,
  respawnAt: 0,
  protectedUntil: 0,
  lastShotAt: freshReloads(),
  lastSwingAt: 0,
  lastAttack: ATTACK_LIGHT,
  chargeStartAt: 0,
  ammo: freshAmmo(),
  reloadDoneAt: freshReloads(),
  lastThrowAt: 0,
});

/** Test-only knobs (honoured only when MINESHOOT_TEST=1). */
interface TestOverrides {
  durationMs?: number;
  respawnMs?: number;
  lingerMs?: number;
  spawnProtectMs?: number;
  /** Fixed interval between weapon drops (replaces the random DROP_INTERVAL range). */
  dropIntervalMs?: number;
  dropLifetimeMs?: number;
  /** CTF: how long a dropped flag lies around before returning home. */
  flagReturnMs?: number;
  /** TD: pause between rounds. */
  roundIntermissionMs?: number;
  /** TD: post-spawn freeze (the 3-2-1 countdown). */
  roundFreezeMs?: number;
}

/** Server-side bot runtime: brain + simulated body. */
interface BotRuntime {
  brain: Bot;
  phys: PlayerPhysState;
}

/** Humanoid palette indices used for the teams (render/humanoid.ts PLAYER_COLORS: 0 red, 1 blue). */
const teamColor = (team: Team): number => (team === TEAM_RED ? 0 : 1);
const flagKey = (team: Team): string => String(team);

interface CreateOptionsRaw {
  name?: unknown;
  durationMin?: unknown;
  bots?: unknown;
  botSkill?: unknown;
  weapons?: unknown;
  mode?: unknown;
  captureLimit?: unknown;
  roundLimit?: unknown;
  nickname?: unknown;
  testOverrides?: TestOverrides;
}

export class ArenaRoom extends Room<RoomState> {
  maxClients = MAX_PLAYERS;

  private world!: World;
  private spawnPoints: SpawnPoint[] = [];
  private dropZone!: Rect;
  /** Team modes: flag stand (ctf) / spawn-zone centre (td) per team. */
  private bases!: Record<Team, SpawnPoint>;
  /** TD: the fixed weapon spots (8 per side, mirrored). */
  private weaponSpots: SpawnPoint[] = [];
  /** TD: the fixed pistol drops at the east-west arm mouths. */
  private pistolSpots: SpawnPoint[] = [];
  /** TD: where the roads cross (the bots' fallback goal). */
  private tdCenter: Vec3 = { x: 0, y: 0, z: 0 };
  /** TD: when the running round started / when the intermission ends. */
  private roundStartedAt = 0;
  private nextRoundAt = 0;
  private intermissionMs = TD_INTERMISSION_MS;
  private freezeMs = TD_FREEZE_MS;
  /** CTF: when each dropped flag hit the ground (server-only; returns home after FLAG_RETURN_MS). */
  private readonly flagDroppedAt = new Map<Team, number>();
  /** CTF: who put a flag down on purpose and until when they may not take it back (server-only). */
  private readonly flagDropGrace = new Map<Team, { id: string; until: number }>();
  private rng: () => number = Math.random;
  private endsAt = 0;
  private respawnMs = RESPAWN_MS;
  private spawnProtectMs = SPAWN_PROTECT_MS;
  private lingerMs = ENDED_LINGER_MS;
  private flagReturnMs = FLAG_RETURN_MS;
  private weaponMode: WeaponMode = 'all';
  private mode: RoomMode = 'match';
  private dropIntervalMin = DROP_INTERVAL_MIN_MS;
  private dropIntervalMax = DROP_INTERVAL_MAX_MS;
  private dropLifetimeMs = DROP_LIFETIME_MS;
  private dropMaxActive = DROP_MAX_ACTIVE;
  private nextDropAt = 0;
  private dropSeq = 0;
  /** When each drop on the ground expires (server-only). */
  private readonly dropExpiry = new Map<string, number>();
  /** Who threw a drop away (MSG.dropWeapon) and until when they may not auto-pick it back up. */
  private readonly dropThrower = new Map<string, { playerId: string; until: number }>();
  /** Live grenade physics (server-only; positions mirrored into state.grenades). */
  private readonly grenadeSim = new Map<string, GrenadeState>();
  private grenadeSeq = 0;
  private readonly meta = new Map<string, PlayerMeta>();
  private readonly bots = new Map<string, BotRuntime>();
  private readonly killTracker = new KillTracker();
  private botAcc = 0;
  private botCount = 0;
  private botSkill: BotSkill = DEFAULT_BOT_SKILL;

  onCreate(options: CreateOptionsRaw = {}): void {
    this.state = new RoomState();
    this.state.name = sanitizeRoomName(options.name, `Arena ${this.roomId.slice(0, 4)}`);
    this.state.durationMin = parseDurationMin(options.durationMin);
    this.weaponMode = parseWeaponMode(options.weapons);
    this.state.weapons = this.weaponMode;
    this.mode = parseRoomMode(options.mode);
    this.state.mode = this.mode;
    this.respawnMs = respawnMsFor(this.mode);
    if (this.ctf) {
      // Weapons matter more (carriers are melee-only) and the map is bigger: drops come more often.
      this.dropIntervalMin = CTF_DROP_INTERVAL_MIN_MS;
      this.dropIntervalMax = CTF_DROP_INTERVAL_MAX_MS;
      this.dropMaxActive = CTF_DROP_MAX_ACTIVE;
    }
    const botCount = parseBotCount(options.bots);
    this.botSkill = parseBotSkill(options.botSkill);
    // Bots occupy player slots: humans + bots never exceed MAX_PLAYERS.
    this.maxClients = MAX_PLAYERS - botCount;
    let durationMs = this.state.durationMin * 60_000;
    if (process.env.MINESHOOT_TEST === '1' && options.testOverrides) {
      const t = options.testOverrides;
      if (typeof t.durationMs === 'number') durationMs = t.durationMs;
      if (typeof t.respawnMs === 'number') this.respawnMs = t.respawnMs;
      if (typeof t.lingerMs === 'number') this.lingerMs = t.lingerMs;
      if (typeof t.spawnProtectMs === 'number') this.spawnProtectMs = t.spawnProtectMs;
      if (typeof t.dropIntervalMs === 'number') this.dropIntervalMin = this.dropIntervalMax = t.dropIntervalMs;
      if (typeof t.dropLifetimeMs === 'number') this.dropLifetimeMs = t.dropLifetimeMs;
      if (typeof t.flagReturnMs === 'number') this.flagReturnMs = t.flagReturnMs;
      if (typeof t.roundIntermissionMs === 'number') this.intermissionMs = t.roundIntermissionMs;
      if (typeof t.roundFreezeMs === 'number') this.freezeMs = t.roundFreezeMs;
    }

    const seed = hashSeed(`${this.roomId}:${Date.now()}`);
    this.state.seed = seed;
    const gen = generateWorldFor(this.mode, seed);
    this.world = gen.world;
    this.spawnPoints = gen.spawnPoints;
    this.dropZone = gen.dropZone;
    this.bases = gen.bases;
    this.weaponSpots = gen.weaponSpots ?? [];
    this.pistolSpots = gen.pistolSpots ?? [];
    this.rng = createRng(seed ^ 0xabcdef);
    if (this.ctf) {
      this.state.captureLimit = parseCaptureLimit(options.captureLimit);
      for (const team of TEAMS) {
        const f = new FlagSchema();
        f.team = team;
        f.x = this.bases[team].x;
        f.y = this.bases[team].y;
        f.z = this.bases[team].z;
        this.state.flags.set(flagKey(team), f);
      }
    }
    if (this.td) {
      this.state.roundLimit = parseRoundLimit(options.roundLimit);
      const cx = Math.floor((this.dropZone.minX + this.dropZone.maxX) / 2);
      const cz = Math.floor((this.dropZone.minZ + this.dropZone.maxZ) / 2);
      this.tdCenter = { x: cx + 0.5, y: columnTop(this.world, cx, cz) + 1, z: cz + 0.5 };
      this.roundStartedAt = Date.now();
      this.layTdWeapons();
    }

    // TD has no clock: rounds end by elimination, the match by round wins (endsAt stays 0).
    if (!this.td) {
      this.endsAt = Date.now() + durationMs;
      this.state.timeLeftMs = durationMs;
    }
    this.scheduleDrop(Date.now());
    this.botCount = botCount;
    this.syncMetadata();

    this.onMessage(MSG.pose, (client, raw: unknown) => this.handlePose(client, raw));
    this.onMessage(MSG.shoot, (client, raw: unknown) => this.handleShoot(client, raw));
    this.onMessage(MSG.swing, (client, raw: unknown) => this.handleSwing(client, raw));
    this.onMessage(MSG.charge, (client, raw: unknown) => this.handleCharge(client, raw));
    this.onMessage(MSG.chargeCancel, (client, raw: unknown) => this.handleChargeCancel(client, raw));
    this.onMessage(MSG.reload, (client, raw: unknown) => this.handleReload(client, raw));
    this.onMessage(MSG.ready, (client) => this.handleReady(client));
    this.onMessage(MSG.selectWeapon, (client, raw: unknown) => this.handleSelectWeapon(client, raw));
    this.onMessage(MSG.throw, (client, raw: unknown) => this.handleThrow(client, raw));
    this.onMessage(MSG.selectTeam, (client, raw: unknown) => this.handleSelectTeam(client, raw));
    this.onMessage(MSG.dropFlag, (client, raw: unknown) => this.handleDropFlag(client, raw));
    this.onMessage(MSG.dropWeapon, (client, raw: unknown) => this.handleDropWeapon(client, raw));
    this.onMessage(MSG.ping, (client, t: unknown) => {
      if (typeof t === 'number') client.send(MSG.pong, t);
    });

    this.clock.setInterval(() => this.tickLifecycle(), 50);
    this.clock.setInterval(() => this.tickTimer(), 1000);

    for (let i = 0; i < botCount; i++) this.addBot(i + 1);
    if (botCount > 0) this.setSimulationInterval((deltaMs) => this.pumpBots(deltaMs), SERVER_TICK_MS);
    this.syncMetadata();
  }

  private get ctf(): boolean {
    return isCtf(this.mode);
  }
  private get td(): boolean {
    return isTd(this.mode);
  }
  /** Red vs. blue (ctf and td): team pick/switch, team spawns, no friendly fire. */
  private get teams(): boolean {
    return isTeamMode(this.mode);
  }

  /** Lobby metadata; team rooms also carry their win limit and the team head counts. */
  private syncMetadata(): void {
    this.setMetadata({
      name: this.state.name,
      durationMin: this.state.durationMin,
      endsAt: this.endsAt,
      bots: this.botCount,
      botSkill: this.botSkill,
      weapons: this.weaponMode,
      mode: this.mode,
      ...(this.teams ? { teams: [this.teamCount(TEAM_RED), this.teamCount(TEAM_BLUE)] } : {}),
      ...(this.ctf ? { captureLimit: this.state.captureLimit } : {}),
      ...(this.td ? { roundLimit: this.state.roundLimit } : {}),
    });
  }

  private teamCount(team: Team): number {
    let n = 0;
    for (const p of this.state.players.values()) if (p.team === team) n++;
    return n;
  }
  private teamCounts(): Record<Team, number> {
    return { [TEAM_RED]: this.teamCount(TEAM_RED), [TEAM_BLUE]: this.teamCount(TEAM_BLUE) };
  }

  /** Bots alternate teams (bot1 red, bot2 blue, …). */
  private addBot(n: number): void {
    const id = `bot${n}`;
    const p = new PlayerSchema();
    p.name = `Bot ${n}`;
    p.isBot = true;
    if (this.teams) {
      p.team = n % 2 === 1 ? TEAM_RED : TEAM_BLUE;
      p.color = teamColor(p.team as Team);
    } else {
      p.color = this.freeColor();
    }
    this.state.players.set(id, p);
    this.meta.set(id, freshMeta(true));
    this.bots.set(id, {
      brain: createBot(createRng(this.state.seed + n * 7919), this.spawnPoints, { weapons: this.weaponMode, passive: this.mode === 'training', skill: this.botSkill }),
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
      // TD: bots hold still through the 3-2-1 countdown like everyone else.
      const meta = this.meta.get(id);
      if (meta && this.frozen(meta, now)) continue;
      const enemies: BotView['enemies'] = [];
      for (const [sid, other] of this.state.players) {
        if (sid !== id && this.targetable(sid, other, now) && !this.sameTeam(p, other)) enemies.push({ id: sid, x: other.x, y: other.y, z: other.z });
      }
      const view: BotView = { self: rt.phys, enemies, now, gun: p.gun as GunKind, pistol: p.pistol !== GUN_NONE };
      if (this.ctf) {
        const flags = this.flagStates();
        view.goal = botCtfGoal(p.team as Team, id, rt.phys, flags, this.bases);
        view.carrying = carriedFlag(flags, id) !== null;
      } else if (this.td) {
        // Weapons on the own half of the map (worth a detour while unarmed).
        const ownHalf = (z: number): boolean => (z < this.world.sz / 2) === (p.team === TEAM_RED);
        const drops: Vec3[] = [];
        for (const d of this.state.drops.values()) if (ownHalf(d.z)) drops.push({ x: d.x, y: d.y, z: d.z });
        const armed = this.weaponMode === 'sword' || p.gun !== GUN_NONE;
        view.goal = botTdGoal(rt.phys, { enemies, drops, armed, center: this.tdCenter });
      }
      const d = rt.brain.compute(this.world, view, dt);
      let phys = { ...rt.phys, yaw: d.yaw, pitch: d.pitch };
      const substeps = Math.round(dt / PHYSICS_DT);
      for (let i = 0; i < substeps; i++) phys = stepPlayer(this.world, phys, d.input, PHYSICS_DT);
      rt.phys = phys;
      this.applyPose(p, phys);
      if (p.weapon !== d.weapon) p.weapon = d.weapon;
      if (d.shoot) this.attackShoot(id, p, phys, now, d.weapon === WEAPON_PRIMARY ? WEAPON_PRIMARY : WEAPON_PISTOL);
      if (d.swing) this.attackSwing(id, p, phys, now, ATTACK_LIGHT);
    }
  }

  onJoin(client: Client, options?: { nickname?: unknown; team?: unknown }): void {
    const p = new PlayerSchema();
    p.name = sanitizeName(options?.nickname, `Player${this.state.players.size + 1}`);
    if (this.teams) {
      // Requested team, or the smaller one.
      p.team = parseTeam(options?.team) || pickTeam(this.teamCounts(), this.rng);
      p.color = teamColor(p.team as Team);
    } else {
      p.color = this.freeColor();
    }
    this.state.players.set(client.sessionId, p);
    this.meta.set(client.sessionId, freshMeta(false));
    // Not spawned until the client clicks to play (MSG.ready): parked at a spawn point, not alive,
    // so nobody can target them and their own inputs are ignored. Their camera previews the arena.
    p.alive = false;
    const s = pickSpawn(this.spawnsFor(p), [], this.rng);
    p.x = s.x;
    p.y = s.y;
    p.z = s.z;
    this.rebalanceBots();
    this.syncMetadata();
  }

  /** "Click to play": spawn the player for real. Later readies (pointer re-lock) are ignored. */
  private handleReady(client: Client): void {
    if (this.state.phase !== 'playing') return;
    const p = this.state.players.get(client.sessionId);
    const meta = this.meta.get(client.sessionId);
    if (!p || !meta || meta.ready) return;
    meta.ready = true;
    // TD: joining mid-round (past the grace) or during the intermission means waiting for startRound.
    if (this.td && (this.state.roundPhase !== 'live' || Date.now() - this.roundStartedAt > TD_JOIN_GRACE_MS)) return;
    this.spawn(client.sessionId, p);
  }

  onLeave(client: Client): void {
    const p = this.state.players.get(client.sessionId);
    if (p) this.dropCarriedFlag(client.sessionId, p, Date.now());
    this.state.players.delete(client.sessionId);
    this.meta.delete(client.sessionId);
    this.killTracker.remove(client.sessionId);
    this.rebalanceBots();
    this.syncMetadata();
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
    const m = parsePose(raw, this.world);
    if (!m) return;
    const p = this.actor(client, m.epoch);
    if (!p) return;
    this.applyPose(p, m);
    if (weaponAllowed(this.weaponMode, m.weapon) && p.weapon !== m.weapon && this.slotFilled(p, m.weapon)) {
      p.weapon = m.weapon;
      // Putting the sword away drops a pending charge. (A charge may legitimately arrive
      // before the pose that switches to the sword, so only the gun cancels it.)
      if (m.weapon !== WEAPON_MELEE) {
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
    const reloading = p.alive && Object.values(meta.reloadDoneAt).some((t) => t > 0 && now < t);
    if (p.charging !== charging) p.charging = charging;
    if (p.reloading !== reloading) p.reloading = reloading;
  }

  /** TD: still inside the post-spawn countdown — attacks are dropped, bots stand still. */
  private frozen(meta: PlayerMeta, now: number): boolean {
    return this.td && now < meta.frozenUntil;
  }

  /** Alive and not under spawn protection. */
  private targetable(id: string, p: PlayerSchema, now: number): boolean {
    if (!p.alive) return false;
    const meta = this.meta.get(id);
    return !meta || now >= meta.protectedUntil;
  }

  /** Team modes: no friendly fire (teammates are never targets). */
  private sameTeam(a: PlayerSchema, b: PlayerSchema): boolean {
    return this.teams && a.team === b.team;
  }

  private targetsExcluding(id: string, now: number): ShotTarget[] {
    const self = this.state.players.get(id);
    const out: ShotTarget[] = [];
    for (const [sid, other] of this.state.players) {
      if (sid === id || !this.targetable(sid, other, now)) continue;
      if (self && this.sameTeam(self, other)) continue;
      out.push({ id: sid, pose: { x: other.x, y: other.y, z: other.z } });
    }
    return out;
  }

  /** Attacking forfeits spawn protection. */
  private dropProtection(p: PlayerSchema, meta: PlayerMeta): void {
    meta.protectedUntil = 0;
    if (p.shielded) p.shielded = false;
  }

  /** The gun kind in a gun slot: the pistol, the picked-up primary, or the taser (GUN_NONE = empty). */
  /** The slot actually holds something usable (a pose may not bring out an empty slot). */
  private slotFilled(p: PlayerSchema, slot: Weapon): boolean {
    if (slot === WEAPON_PISTOL) return p.pistol !== GUN_NONE;
    if (slot === WEAPON_PRIMARY) return p.gun !== GUN_NONE;
    if (slot === WEAPON_TASER) return p.taser !== GUN_NONE;
    if (slot === WEAPON_GRENADE) return p.grenades > 0;
    return true;
  }

  private gunKindFor(p: PlayerSchema, slot: Weapon): GunKind {
    if (slot === WEAPON_PISTOL) return p.pistol as GunKind;
    return (slot === WEAPON_TASER ? p.taser : p.gun) as GunKind;
  }

  /**
   * Take one round from a gun slot's magazine. A shot that arrives mid-reload
   * means the client interrupted the reload (weapon switch, or a per-shell gun
   * firing straight out of its reload), so it is honoured with whatever the
   * magazine holds — per-shell guns keep the shells loaded so far
   * (`interruptedReloadAmmo`); with an empty magazine it is dropped. Bots
   * reload automatically.
   */
  private takeRound(id: string, meta: PlayerMeta, now: number, slot: Weapon, spec: GunSpec): boolean {
    const done = meta.reloadDoneAt[slot];
    if (done) {
      if (now >= done) {
        meta.ammo[slot] = spec.magSize;
        meta.reloadDoneAt[slot] = 0;
      } else {
        meta.ammo[slot] = interruptedReloadAmmo(spec, meta.ammo[slot], done - now);
        if (meta.ammo[slot] <= 0) return false;
        meta.reloadDoneAt[slot] = 0;
      }
    }
    if (meta.ammo[slot] <= 0) {
      // Bots pay the full client-side reload time (per-shell guns: the whole magazine).
      if (this.bots.has(id) && spec.reloadMs > 0) meta.reloadDoneAt[slot] = now + (spec.perShell ? spec.magSize * spec.reloadMs : spec.reloadMs);
      return false;
    }
    meta.ammo[slot]--;
    return true;
  }

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
    meta.reloadDoneAt[m.weapon] = now + serverReloadMs(spec, meta.ammo[m.weapon]);
    this.syncFlags(client.sessionId, p, now);
  }

  private handleShoot(client: Client, raw: unknown): void {
    const m = parseShoot(raw, this.world);
    if (!m || !weaponAllowed(this.weaponMode, m.weapon)) return;
    const p = this.actor(client, m.epoch);
    if (!p) return;
    this.applyPose(p, m);
    this.attackShoot(client.sessionId, p, m, Date.now(), m.weapon);
  }

  /**
   * Server-authoritative gun shot for humans and bots alike, from `slot`
   * (pistol or primary), rate-limited per shooter with the gun's own timing.
   * Every pellet is its own hitscan ray; the shot is broadcast once with all
   * its rays. A consumable gun (taser) leaves with its last charge.
   */
  private attackShoot(id: string, p: PlayerSchema, pose: PlayerPose, now: number, slot: Weapon): void {
    const meta = this.meta.get(id)!;
    if (this.frozen(meta, now)) return;
    // CTF: a flag carrier is melee-only.
    if (this.ctf && carriedFlag(this.flagStates(), id)) return;
    const kind = this.gunKindFor(p, slot);
    if (kind === GUN_NONE) return;
    const spec = gunSpec(kind);
    if (now - meta.lastShotAt[slot] < spec.serverMinIntervalMs) return;
    const fired = this.takeRound(id, meta, now, slot, spec);
    this.syncFlags(id, p, now);
    if (!fired) return;
    meta.lastShotAt[slot] = now;
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
    if (spec.consumable && meta.ammo[slot] <= 0) this.clearSlot(p, meta, slot);
  }

  /** Empty the primary or taser slot (taser spent, death) and fall back to a slot that still works. */
  private clearSlot(p: PlayerSchema, meta: PlayerMeta, slot: Weapon): void {
    if (slot === WEAPON_TASER) p.taser = GUN_NONE;
    else p.gun = GUN_NONE;
    meta.ammo[slot] = 0;
    meta.reloadDoneAt[slot] = 0;
    if (p.weapon === slot) p.weapon = p.pistol === GUN_NONE ? WEAPON_MELEE : defaultWeapon(this.weaponMode);
  }

  /** Put `kind` in the pistol, primary or taser slot with a full magazine. */
  private armGun(p: PlayerSchema, meta: PlayerMeta, slot: Weapon, kind: GunKind): void {
    if (slot === WEAPON_TASER) p.taser = kind;
    else if (slot === WEAPON_PISTOL) p.pistol = kind;
    else p.gun = kind;
    meta.ammo[slot] = gunSpec(kind).magSize;
    meta.reloadDoneAt[slot] = 0;
    // A fresh gun is ready to fire (the previous one's recovery does not carry over).
    meta.lastShotAt[slot] = 0;
  }

  // --- grenades ---

  private handleThrow(client: Client, raw: unknown): void {
    if (!weaponAllowed(this.weaponMode, WEAPON_GRENADE)) return;
    const m = parseThrow(raw, this.world);
    if (!m) return;
    const p = this.actor(client, m.epoch);
    if (!p) return;
    this.applyPose(p, m);
    this.throwFrom(client.sessionId, p, m, Date.now(), m.charge);
  }

  /** Server-authoritative grenade throw: stock, carrier lock and rate limit checked here; `charge` (0..1) sets the throw speed. */
  private throwFrom(id: string, p: PlayerSchema, pose: PlayerPose, now: number, charge: number): void {
    const meta = this.meta.get(id)!;
    if (this.frozen(meta, now)) return;
    if (this.ctf && carriedFlag(this.flagStates(), id)) return;
    if (p.grenades <= 0 || now - meta.lastThrowAt < GRENADE_SERVER_MIN_INTERVAL_MS) return;
    meta.lastThrowAt = now;
    p.grenades--;
    if (p.weapon !== WEAPON_GRENADE) p.weapon = WEAPON_GRENADE;
    this.dropProtection(p, meta);
    const g = throwGrenade(pose, now, charge);
    const gid = `g${++this.grenadeSeq}`;
    const sch = new GrenadeSchema();
    sch.ownerId = id;
    sch.x = g.x;
    sch.y = g.y;
    sch.z = g.z;
    this.state.grenades.set(gid, sch);
    this.grenadeSim.set(gid, g);
  }

  /** Advance every grenade; burst the ones whose fuse ran out. */
  private tickGrenades(now: number): void {
    if (this.grenadeSim.size === 0) return;
    const dt = SERVER_TICK_MS / 1000 / GRENADE_SUBSTEPS;
    for (const [gid, g0] of [...this.grenadeSim]) {
      let g = g0;
      for (let i = 0; i < GRENADE_SUBSTEPS; i++) g = stepGrenade(this.world, g, dt);
      this.grenadeSim.set(gid, g);
      const sch = this.state.grenades.get(gid);
      if (sch) {
        sch.x = g.x;
        sch.y = g.y;
        sch.z = g.z;
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

  /** Player started holding the melee charge: remember when, so a later heavy swing can be verified. */
  private handleCharge(client: Client, raw: unknown): void {
    if (!weaponAllowed(this.weaponMode, WEAPON_MELEE)) return;
    const epoch = parseCharge(raw);
    if (epoch === null) return;
    const p = this.actor(client, epoch);
    if (!p) return;
    const now = Date.now();
    this.meta.get(client.sessionId)!.chargeStartAt = now;
    if (p.weapon !== WEAPON_MELEE) p.weapon = WEAPON_MELEE;
    this.syncFlags(client.sessionId, p, now);
  }

  /** Player let go before the heavy was ready: no swing, just stop showing the wind-up. */
  private handleChargeCancel(client: Client, raw: unknown): void {
    if (!weaponAllowed(this.weaponMode, WEAPON_MELEE)) return;
    const epoch = parseChargeCancel(raw);
    if (epoch === null) return;
    const p = this.actor(client, epoch);
    if (!p) return;
    this.meta.get(client.sessionId)!.chargeStartAt = 0;
    this.syncFlags(client.sessionId, p, Date.now());
  }

  /** Training range: arm any melee / primary kind on request (a match makes you find a drop instead). */
  private handleSelectWeapon(client: Client, raw: unknown): void {
    const m = parseSelectWeapon(raw);
    if (!m) return;
    if (m.slot === WEAPON_MELEE && !meleeSelectable(this.mode, this.weaponMode)) return;
    if (m.slot !== WEAPON_MELEE && !(this.mode === 'training' && weaponAllowed(this.weaponMode, m.slot))) return;
    const p = this.actor(client, m.epoch);
    if (!p) return;
    const meta = this.meta.get(client.sessionId)!;
    if (m.slot === WEAPON_MELEE) {
      if (p.melee === m.kind) return;
      p.melee = m.kind;
      // A new weapon has its own charge timing: forget any wind-up in progress.
      meta.chargeStartAt = 0;
    } else {
      this.armGun(p, meta, m.slot, m.kind as GunKind);
    }
    this.syncFlags(client.sessionId, p, Date.now());
  }

  private handleSwing(client: Client, raw: unknown): void {
    if (!weaponAllowed(this.weaponMode, WEAPON_MELEE)) return;
    const m = parseSwing(raw, this.world);
    if (!m) return;
    const p = this.actor(client, m.epoch);
    if (!p) return;
    this.applyPose(p, m);
    this.attackSwing(client.sessionId, p, m, Date.now(), m.attack);
  }

  /**
   * Server-authoritative melee attack with whatever the player holds in the melee
   * slot (sword or a picked-up drop). A heavy counts only if the client announced
   * the charge (MSG.charge) at least MELEE_MIN_CHARGE_FRACTION of the weapon's
   * chargeMs earlier, and does damage in proportion to how long it was held
   * (full after chargeMs); otherwise it lands as a light. The previous attack's
   * recovery gates this one.
   */
  private attackSwing(id: string, p: PlayerSchema, pose: PlayerPose, now: number, wants: AttackKind): void {
    const meta = this.meta.get(id)!;
    if (this.frozen(meta, now)) return;
    const kind = p.melee as MeleeKind;
    const charge = meta.chargeStartAt > 0 ? chargeFraction(kind, now - meta.chargeStartAt) : 0;
    const attack: AttackKind = wants === ATTACK_HEAVY && charge < MELEE_MIN_CHARGE_FRACTION ? ATTACK_LIGHT : wants;
    meta.chargeStartAt = 0;
    this.syncFlags(id, p, now);
    if (now - meta.lastSwingAt < attackSpec(kind, meta.lastAttack).serverMinIntervalMs) return;
    meta.lastSwingAt = now;
    meta.lastAttack = attack;
    if (p.weapon !== WEAPON_MELEE) p.weapon = WEAPON_MELEE;
    this.dropProtection(p, meta);
    const swung: SwungMsg = { attackerId: id, attack, melee: kind };
    this.broadcast(MSG.swung, swung);

    for (const victim of swordVictims(this.world, pose, this.targetsExcluding(id, now), attack, kind)) {
      const dmg = swordDamage(victim.part, attack, kind, charge);
      const hit: HitMsg = { attackerId: id, victimId: victim.id, part: victim.part, damage: dmg, attack, melee: kind };
      this.broadcast(MSG.hit, hit);
      this.damage(id, victim.id, dmg, WEAPON_MELEE, victim.part === 'head', kind);
    }
  }

  // --- weapon drops ---

  private scheduleDrop(now: number): void {
    this.nextDropAt = now + this.dropIntervalMin + this.rng() * (this.dropIntervalMax - this.dropIntervalMin);
  }

  /** Something drops in every mode (guns/grenades, knives, or both). */
  private get dropsEnabled(): boolean {
    return dropPool(this.weaponMode).length > 0;
  }

  private spawnDrop(now: number): void {
    const avoid: { x: number; z: number }[] = [];
    for (const d of this.state.drops.values()) avoid.push({ x: d.x, z: d.z });
    const spot = pickDropSpot(this.world, this.rng, avoid, this.spawnPoints, this.dropZone);
    if (!spot) return;
    const d = new DropSchema();
    const k = pickDropKind(this.rng, this.weaponMode);
    d.slot = k.slot;
    d.kind = k.kind;
    d.x = spot.x;
    d.y = spot.y;
    d.z = spot.z;
    const id = `d${++this.dropSeq}`;
    this.state.drops.set(id, d);
    this.dropExpiry.set(id, now + this.dropLifetimeMs);
  }

  private removeDrop(id: string): void {
    this.state.drops.delete(id);
    this.dropExpiry.delete(id);
    this.dropThrower.delete(id);
  }

  /** Spawn due drops, expire stale ones, and hand a drop to the first living player standing on it with room for it. */
  private tickDrops(now: number): void {
    if (!this.dropsEnabled) return;
    // TD: the fixed weapon rows replace the random timed drops and never expire (they have no dropExpiry entry) — thrown-away weapons still do.
    if (!this.td && now >= this.nextDropAt) {
      if (this.state.drops.size < this.dropMaxActive) this.spawnDrop(now);
      this.scheduleDrop(now);
    }
    for (const [id, expiresAt] of this.dropExpiry) if (now >= expiresAt) this.removeDrop(id);
    if (this.state.drops.size === 0) return;
    for (const [pid, p] of this.state.players) {
      if (!p.alive) continue;
      for (const [did, d] of this.state.drops) {
        if (!canPickUp(p, d) || !autoPickUpAllowed(p, { slot: d.slot as DropSlot, kind: d.kind })) continue;
        const thrower = this.dropThrower.get(did);
        if (thrower && thrower.playerId === pid && now < thrower.until) continue;
        if (!this.givePickup(pid, p, d)) continue;
        this.removeDrop(did);
        const msg: PickupMsg = { playerId: pid, slot: d.slot as Weapon, kind: d.kind };
        this.broadcast(MSG.pickup, msg);
        break;
      }
    }
  }

  /** Give a drop to `p`; false if they cannot take it (grenades already full). */
  private givePickup(pid: string, p: PlayerSchema, d: DropSchema): boolean {
    const meta = this.meta.get(pid)!;
    if (d.slot === WEAPON_GRENADE) {
      if (p.grenades >= GRENADE_MAX) return false;
      p.grenades = Math.min(GRENADE_MAX, p.grenades + d.kind);
    } else if (d.slot === WEAPON_PISTOL || d.slot === WEAPON_PRIMARY || d.slot === WEAPON_TASER) {
      this.armGun(p, meta, d.slot as Weapon, d.kind as GunKind);
    } else {
      p.melee = d.kind;
    }
    return true;
  }

  // --- combat / lifecycle ---

  /** Subtract HP from a living victim; a drop to 0 is a kill credited to the attacker. */
  private damage(attackerId: string, victimId: string, amount: number, weapon: Weapon, headshot: boolean, melee: MeleeKind = MELEE_SWORD, gun: GunKind = GUN_NONE): void {
    const victim = this.state.players.get(victimId);
    if (!victim || !this.targetable(victimId, victim, Date.now())) return;
    victim.hp = Math.max(0, victim.hp - amount);
    if (victim.hp === 0) this.kill(attackerId, victimId, weapon, headshot, melee, gun);
  }

  private kill(killerId: string, victimId: string, weapon: Weapon, headshot: boolean, melee: MeleeKind = MELEE_SWORD, gun: GunKind = GUN_NONE): void {
    const victim = this.state.players.get(victimId);
    if (!victim || !victim.alive) return;
    const killer = this.state.players.get(killerId);
    const now = Date.now();
    victim.alive = false;
    victim.deaths++;
    // Blowing yourself up is a death, not a kill.
    if (killer && killerId !== victimId) killer.kills++;
    const meta = this.meta.get(victimId);
    if (meta) meta.respawnAt = now + this.respawnMs;
    this.dropCarriedFlag(victimId, victim, now);
    const awards = this.killTracker.recordKill(killerId, victimId, now);
    const msg: KillMsg = {
      ...awards,
      killerId,
      killerName: killer?.name ?? '?',
      victimId,
      victimName: victim.name,
      weapon,
      melee,
      gun,
      headshot,
    };
    this.broadcast(MSG.kill, msg);
  }

  /** Spawn points available to a player: teams (ctf/td) respawn near their own base (td squads respawn together, so they get a bigger pool). */
  private spawnsFor(p: PlayerSchema): SpawnPoint[] {
    if (!this.teams) return this.spawnPoints;
    return teamSpawns(this.spawnPoints, this.bases[p.team as Team], this.td ? TD_TEAM_SPAWN_COUNT : undefined);
  }

  /** Training dummies stand on the central plateau, spaced out like drops; everyone else uses spawn points not already stood on. */
  private pickSpawnFor(id: string, p: PlayerSchema, enemies: { x: number; z: number }[], occupied: { x: number; z: number }[]): SpawnPoint {
    if (this.mode === 'training' && this.bots.has(id)) {
      const spot = pickDropSpot(this.world, this.rng, occupied, this.spawnPoints, this.dropZone);
      if (spot) return spot;
    }
    return pickSpawn(unoccupiedSpawns(this.spawnsFor(p), occupied), enemies, this.rng);
  }

  private spawn(id: string, p: PlayerSchema): void {
    const enemies: { x: number; z: number }[] = [];
    const occupied: { x: number; z: number }[] = [];
    for (const [sid, other] of this.state.players) {
      if (sid === id || !other.alive) continue;
      occupied.push({ x: other.x, z: other.z });
      if (!this.sameTeam(p, other)) enemies.push({ x: other.x, z: other.z });
    }
    const s = this.pickSpawnFor(id, p, enemies, occupied);
    p.x = s.x;
    p.y = s.y;
    p.z = s.z;
    p.yaw = this.rng() * Math.PI * 2;
    p.pitch = 0;
    p.alive = true;
    p.hp = MAX_HP;
    p.weapon = spawnWeapon(this.mode, this.weaponMode);
    // Picked-up drops are lost on death: everyone comes back with the plain sword, an empty primary slot and fresh grenades.
    // Team elimination spawns blade-only: no pistol (the fixed ground pistols fill the slot) and no grenades.
    p.melee = MELEE_SWORD;
    p.pistol = this.td ? GUN_NONE : GUN_PISTOL;
    p.gun = GUN_NONE;
    p.taser = GUN_NONE;
    p.grenades = this.td ? 0 : GRENADE_START;
    p.shielded = this.spawnProtectMs > 0;
    const meta = this.meta.get(id);
    if (meta) {
      meta.inRound = true;
      meta.frozenUntil = this.td ? Date.now() + this.freezeMs : 0;
      meta.chargeStartAt = 0;
      meta.protectedUntil = this.spawnProtectMs > 0 ? Date.now() + this.spawnProtectMs : 0;
      meta.ammo = freshAmmo();
      meta.reloadDoneAt = freshReloads();
      // Deathmatch with guns: every (re)spawn rolls a random primary (held right away); other modes start with the slot empty.
      const primary = spawnPrimary(this.mode, this.weaponMode, this.rng);
      if (primary !== GUN_NONE) {
        this.armGun(p, meta, WEAPON_PRIMARY, primary);
        p.weapon = WEAPON_PRIMARY;
      }
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
        // TD: the dead wait for the next round instead.
        if (!this.td && now >= meta.respawnAt) this.spawn(id, p);
      } else if (p.shielded && now >= meta.protectedUntil) {
        p.shielded = false;
      }
      this.syncFlags(id, p, now);
    }
    this.tickDrops(now);
    this.tickGrenades(now);
    this.tickFlags(now);
    this.tickRound(now);
  }

  // --- team elimination rounds ---

  /**
   * TD round state machine: while live, end the round the moment one team is
   * wiped (a simultaneous wipe is a drawn round); the first team at
   * `roundLimit` round wins takes the match, otherwise a short intermission
   * (survivors keep walking, nobody respawns) leads into the next round.
   */
  private tickRound(now: number): void {
    if (!this.td) return;
    if (this.state.roundPhase === 'live') {
      const sides: Record<Team, RoundSide> = { [TEAM_RED]: { alive: 0, inRound: 0, ready: 0 }, [TEAM_BLUE]: { alive: 0, inRound: 0, ready: 0 } };
      for (const [id, p] of this.state.players) {
        const meta = this.meta.get(id);
        if (!meta?.ready || !isTeam(p.team)) continue;
        const s = sides[p.team];
        s.ready++;
        if (meta.inRound) s.inRound++;
        if (p.alive) s.alive++;
      }
      const winner = roundWinner(sides[TEAM_RED], sides[TEAM_BLUE]);
      if (winner === null) return;
      if (winner === TEAM_RED) this.state.roundsRed++;
      else if (winner === TEAM_BLUE) this.state.roundsBlue++;
      this.roundEvent('end', winner);
      if (Math.max(this.state.roundsRed, this.state.roundsBlue) >= this.state.roundLimit) {
        this.endMatch();
        return;
      }
      this.state.roundPhase = 'intermission';
      this.nextRoundAt = now + this.intermissionMs;
    } else if (now >= this.nextRoundAt) {
      this.startRound(now);
    }
  }

  /** Fresh round: everyone ready respawns at their own end and the fixed weapons are laid out again. */
  private startRound(now: number): void {
    this.state.round++;
    this.state.roundPhase = 'live';
    this.roundStartedAt = now;
    // A grenade from the last round must not explode into this one.
    this.grenadeSim.clear();
    this.state.grenades.clear();
    // Kill streaks and multi-kill chains end with the round (kills/deaths stay cumulative).
    this.killTracker.resetStreaks();
    this.layTdWeapons();
    for (const [id, p] of this.state.players) {
      if (this.meta.get(id)?.ready) this.spawn(id, p);
    }
    this.roundEvent('start', TEAM_NONE);
  }

  private roundEvent(kind: RoundEventMsg['kind'], winner: RoundEventMsg['winner']): void {
    const msg: RoundEventMsg = { kind, winner, round: this.state.round, roundsRed: this.state.roundsRed, roundsBlue: this.state.roundsBlue };
    this.broadcast(MSG.round, msg);
  }

  /** Clear the ground and lay each side's fixed weapon row plus the arm-mouth pistols (same spots and kinds every round; they never expire). */
  private layTdWeapons(): void {
    this.state.drops.clear();
    this.dropExpiry.clear();
    this.dropThrower.clear();
    const lay = (s: SpawnPoint, slot: number, kind: number): void => {
      const d = new DropSchema();
      d.slot = slot;
      d.kind = kind;
      d.x = s.x;
      d.y = s.y;
      d.z = s.z;
      this.state.drops.set(`d${++this.dropSeq}`, d);
    };
    const loadout = tdWeaponLoadout(this.weaponMode);
    for (const [i, s] of this.weaponSpots.entries()) {
      const k = loadout[i % loadout.length];
      lay(s, k.slot, k.kind);
    }
    if (weaponAllowed(this.weaponMode, WEAPON_PISTOL)) {
      for (const s of this.pistolSpots) lay(s, WEAPON_PISTOL, GUN_PISTOL);
    }
  }

  // --- capture the flag ---

  private flagStates(): FlagState[] {
    const out: FlagState[] = [];
    for (const f of this.state.flags.values()) {
      out.push({ team: f.team as Team, status: f.status as FlagState['status'], x: f.x, y: f.y, z: f.z, carrierId: f.carrierId });
    }
    return out;
  }

  private flagEvent(kind: FlagEventKind, f: FlagSchema, playerId: string): void {
    const p = this.state.players.get(playerId);
    const msg: FlagEventMsg = {
      kind,
      team: f.team as Team,
      playerId,
      playerName: p?.name ?? '',
      redScore: this.state.redScore,
      blueScore: this.state.blueScore,
    };
    this.broadcast(MSG.flag, msg);
  }

  private returnFlag(f: FlagSchema, playerId: string): void {
    const base = this.bases[f.team as Team];
    f.status = 'home';
    f.carrierId = '';
    f.x = base.x;
    f.y = base.y;
    f.z = base.z;
    this.flagDroppedAt.delete(f.team as Team);
    this.flagEvent('returned', f, playerId);
  }

  /** The flag `id` carries (if any) falls where they stand. `voluntary` (G): the dropper can't take it straight back. */
  private dropCarriedFlag(id: string, p: PlayerSchema, now: number, voluntary = false): void {
    if (!this.ctf) return;
    for (const f of this.state.flags.values()) {
      if (f.status !== 'carried' || f.carrierId !== id) continue;
      f.status = 'dropped';
      f.carrierId = '';
      f.x = p.x;
      f.y = p.y;
      f.z = p.z;
      this.flagDroppedAt.set(f.team as Team, now);
      if (voluntary) this.flagDropGrace.set(f.team as Team, { id, until: now + FLAG_DROP_GRACE_MS });
      else this.flagDropGrace.delete(f.team as Team);
      this.flagEvent('dropped', f, id);
    }
  }

  private score(id: string, p: PlayerSchema, enemyFlag: FlagSchema): void {
    if (p.team === TEAM_RED) this.state.redScore++;
    else this.state.blueScore++;
    p.captures++;
    const base = this.bases[enemyFlag.team as Team];
    enemyFlag.status = 'home';
    enemyFlag.carrierId = '';
    enemyFlag.x = base.x;
    enemyFlag.y = base.y;
    enemyFlag.z = base.z;
    this.flagEvent('captured', enemyFlag, id);
    if (Math.max(this.state.redScore, this.state.blueScore) >= this.state.captureLimit) this.endMatch();
  }

  /**
   * Flags: carried ones follow their carrier, dropped ones go home after
   * FLAG_RETURN_MS, carriers inside their own base zone score (enemy flag,
   * own flag home) or return (own flag), and anyone alive touching a flag
   * takes / picks it up — one flag per player, one touch per tick.
   */
  private tickFlags(now: number): void {
    if (!this.ctf) return;
    for (const f of this.state.flags.values()) {
      if (f.status === 'carried') {
        const c = this.state.players.get(f.carrierId);
        if (c && c.alive) {
          if (f.x !== c.x) f.x = c.x;
          if (f.y !== c.y) f.y = c.y;
          if (f.z !== c.z) f.z = c.z;
        } else {
          this.returnFlag(f, '');
        }
      } else if (f.status === 'dropped' && now - (this.flagDroppedAt.get(f.team as Team) ?? now) >= this.flagReturnMs) {
        this.returnFlag(f, '');
      }
    }
    for (const [id, p] of this.state.players) {
      if (!p.alive) continue;
      const flags = this.flagStates();
      const player = { id, team: p.team as Team, x: p.x, z: p.z };
      if (canScore(player, flags, this.bases)) {
        this.score(id, p, this.state.flags.get(flagKey(player.team === TEAM_RED ? TEAM_BLUE : TEAM_RED))!);
        if (this.state.phase !== 'playing') return;
        continue;
      }
      if (canReturn(player, flags, this.bases)) {
        this.returnFlag(this.state.flags.get(flagKey(player.team))!, id);
        continue;
      }
      for (const f of this.state.flags.values()) {
        if (!canPickUp(p, f)) continue;
        const grace = this.flagDropGrace.get(f.team as Team);
        if (grace && grace.id === id && now < grace.until) continue;
        const touch = flagTouch({ team: f.team as Team, status: f.status as FlagState['status'], x: f.x, y: f.y, z: f.z, carrierId: f.carrierId }, player, flags);
        if (!touch) continue;
        f.status = 'carried';
        f.carrierId = id;
        this.flagDroppedAt.delete(f.team as Team);
        this.flagEvent('taken', f, id);
        break;
      }
    }
  }

  /** Team modes: pick / switch team (always allowed; bots even the teams out afterwards). */
  private handleSelectTeam(client: Client, raw: unknown): void {
    if (!this.teams || this.state.phase !== 'playing') return;
    const team = parseTeam(raw);
    const p = this.state.players.get(client.sessionId);
    if (!team || !p || p.team === team) return;
    this.setTeam(client.sessionId, p, team, Date.now());
    this.rebalanceBots();
    this.syncMetadata();
  }

  /** Team modes: bots keep the sides even (humans pick freely). */
  private rebalanceBots(): void {
    if (!this.teams) return;
    const now = Date.now();
    for (let guard = 0; guard < this.bots.size; guard++) {
      const botsByTeam: Record<Team, string[]> = { [TEAM_RED]: [], [TEAM_BLUE]: [] };
      for (const [id] of this.bots) botsByTeam[this.state.players.get(id)!.team as Team].push(id);
      const move = botRebalance(this.teamCounts(), botsByTeam);
      if (!move) break;
      this.setTeam(move.id, this.state.players.get(move.id)!, move.to, now);
    }
  }

  /** Change sides: a carried flag drops, a living player dies (no death counted) and respawns on the new side. */
  private setTeam(id: string, p: PlayerSchema, team: Team, now: number): void {
    this.dropCarriedFlag(id, p, now);
    p.team = team;
    p.color = teamColor(team);
    const meta = this.meta.get(id);
    if (p.alive) {
      p.alive = false;
      if (meta) meta.respawnAt = now + this.respawnMs;
    } else if (meta && !meta.ready) {
      // Not playing yet: park the preview camera on the new side.
      const s = pickSpawn(this.spawnsFor(p), [], this.rng);
      p.x = s.x;
      p.y = s.y;
      p.z = s.z;
    }
  }

  /**
   * Throw the held weapon on the ground (G): the slot empties (a blade reverts
   * to the sword) and the weapon lies at the thrower's feet as a short-lived
   * drop — anyone with room can take it, the thrower only after a grace, and
   * it vanishes after DROP_THROWN_LIFETIME_MS (even in td).
   */
  private handleDropWeapon(client: Client, raw: unknown): void {
    const m = parseDropWeapon(raw);
    if (!m) return;
    const p = this.actor(client, m.epoch);
    if (!p) return;
    const meta = this.meta.get(client.sessionId)!;
    const now = Date.now();
    if (this.frozen(meta, now)) return;
    let kind: number;
    if (m.slot === WEAPON_PRIMARY || m.slot === WEAPON_TASER) {
      kind = m.slot === WEAPON_TASER ? p.taser : p.gun;
      if (kind === GUN_NONE) return;
      this.clearSlot(p, meta, m.slot);
    } else {
      kind = p.melee;
      if (kind === MELEE_SWORD) return;
      p.melee = MELEE_SWORD;
      meta.chargeStartAt = 0;
    }
    const d = new DropSchema();
    d.slot = m.slot;
    d.kind = kind;
    d.x = p.x;
    d.y = p.y;
    d.z = p.z;
    const id = `d${++this.dropSeq}`;
    this.state.drops.set(id, d);
    this.dropExpiry.set(id, now + DROP_THROWN_LIFETIME_MS);
    this.dropThrower.set(id, { playerId: client.sessionId, until: now + DROP_THROWN_GRACE_MS });
  }

  /** CTF: hand-off — put the carried flag down right here. */
  private handleDropFlag(client: Client, raw: unknown): void {
    if (!this.ctf) return;
    const epoch = parseDropFlag(raw);
    if (epoch === null) return;
    const p = this.actor(client, epoch);
    if (!p) return;
    this.dropCarriedFlag(client.sessionId, p, Date.now(), true);
  }

  private tickTimer(): void {
    if (this.state.phase !== 'playing' || this.td) return;
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
