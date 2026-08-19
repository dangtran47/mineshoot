import { describe, expect, it } from 'vitest';
import { createBot, botSkillProfile } from '../src/bot';
import { DEFAULT_BOT_SKILL, isBotSkill } from '../src/protocol';
import type { BotSkill } from '../src/protocol';
import { createRng } from '../src/rng';
import { Block } from '../src/types';
import { createWorld, setBlock } from '../src/world';
import { createPhysState, stepPlayer } from '../src/playerPhysics';
import { WEAPON_GUN, WEAPON_SWORD } from '../src/protocol';
import { PHYSICS_DT, SERVER_TICK_MS } from '../src/constants';
import { generateWorld, PLATEAU_MAX, PLATEAU_MIN } from '../src/worldgen';

function flat(): ReturnType<typeof createWorld> {
  const w = createWorld(64, 24, 64);
  for (let x = 0; x < 64; x++) for (let z = 0; z < 64; z++) setBlock(w, x, 0, z, Block.Stone);
  return w;
}
const waypoints = [
  { x: 10.5, y: 1, z: 10.5 },
  { x: 50.5, y: 1, z: 50.5 },
  { x: 10.5, y: 1, z: 50.5 },
];

describe('bot', () => {
  it('turns toward a visible enemy and shoots once aligned and reacted', () => {
    const w = flat();
    const bot = createBot(createRng(1), waypoints);
    let self = createPhysState(32, 1, 40, Math.PI); // facing +Z, enemy is at -Z
    const enemies = [{ id: 'e', x: 32, y: 1, z: 25 }];
    let shotAt = -1;
    let firstYawDelta = -1;
    for (let i = 0; i < 80; i++) {
      const now = i * 50;
      const d = bot.compute(w, { self, enemies, now }, 0.05);
      if (i === 0) firstYawDelta = Math.abs(d.yaw - Math.PI);
      self = { ...self, yaw: d.yaw, pitch: d.pitch };
      self = stepPlayer(w, self, d.input, 0.05);
      if (d.shoot && shotAt < 0) shotAt = now;
    }
    expect(firstYawDelta).toBeLessThan(0.3); // turns gradually, not instantly
    expect(shotAt).toBeGreaterThanOrEqual(450); // reaction delay
    expect(shotAt).toBeLessThan(3000);
    // Facing the enemy from wherever the strafing left it.
    const wantYaw = Math.atan2(-(enemies[0].x - self.x), -(enemies[0].z - self.z));
    expect(Math.abs(Math.atan2(Math.sin(self.yaw - wantYaw), Math.cos(self.yaw - wantYaw)))).toBeLessThan(0.15);
  });

  it('does not see enemies through walls and wanders instead', () => {
    const w = flat();
    for (let y = 1; y < 6; y++) for (let x = 20; x < 45; x++) setBlock(w, x, y, 32, Block.Brick);
    const bot = createBot(createRng(2), waypoints);
    let self = createPhysState(32, 1, 40, 0);
    let anyShoot = false;
    for (let i = 0; i < 40; i++) {
      const d = bot.compute(w, { self, enemies: [{ id: 'e', x: 32, y: 1, z: 25 }], now: i * 50 }, 0.05);
      anyShoot ||= d.shoot;
      self = stepPlayer(w, { ...self, yaw: d.yaw, pitch: d.pitch }, d.input, 0.05);
      expect(Math.hypot(d.input.forward, d.input.strafe)).toBeGreaterThan(0.9); // heading for a waypoint
    }
    expect(anyShoot).toBe(false);
    expect(Math.hypot(self.x - 32, self.z - 40)).toBeGreaterThan(1);
  });

  it('switches to the sword up close', () => {
    const w = flat();
    const bot = createBot(createRng(3), waypoints);
    const self = createPhysState(32, 1, 40, 0);
    let d = bot.compute(w, { self, enemies: [{ id: 'e', x: 32, y: 1, z: 38.5 }], now: 0 }, 0.05);
    d = bot.compute(w, { self, enemies: [{ id: 'e', x: 32, y: 1, z: 38.5 }], now: 1000 }, 0.05);
    expect(d.weapon).toBe(WEAPON_SWORD);
    expect(d.swing).toBe(true);
  });

  it('is deterministic for a given rng seed', () => {
    const w = flat();
    const run = (): number[] => {
      const bot = createBot(createRng(9), waypoints);
      let self = createPhysState(30, 1, 30, 0);
      const out: number[] = [];
      for (let i = 0; i < 30; i++) {
        const d = bot.compute(w, { self, enemies: [], now: i * 50 }, 0.05);
        self = stepPlayer(w, { ...self, yaw: d.yaw, pitch: d.pitch }, d.input, 0.05);
        out.push(self.x, self.z);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('gun-only room: keeps the gun and shoots even up close', () => {
    const w = flat();
    const bot = createBot(createRng(3), waypoints, { weapons: 'gun' });
    const self = createPhysState(32, 1, 40, 0);
    const enemies = [{ id: 'e', x: 32, y: 1, z: 38.5 }];
    bot.compute(w, { self, enemies, now: 0 }, 0.05);
    const d = bot.compute(w, { self, enemies, now: 1000 }, 0.05);
    expect(d.weapon).toBe(WEAPON_GUN);
    expect(d.swing).toBe(false);
    expect(d.shoot).toBe(true);
  });

  it('sword-only room: never draws the gun, closes in and swings once in range', () => {
    const w = flat();
    const bot = createBot(createRng(4), waypoints, { weapons: 'sword' });
    let self = createPhysState(32, 1, 40, Math.PI);
    const enemies = [{ id: 'e', x: 32, y: 1, z: 30 }];
    let swungAt = -1;
    for (let i = 0; i < 100; i++) {
      const now = i * 50;
      const d = bot.compute(w, { self, enemies, now }, 0.05);
      expect(d.weapon).toBe(WEAPON_SWORD);
      expect(d.shoot).toBe(false);
      self = stepPlayer(w, { ...self, yaw: d.yaw, pitch: d.pitch }, d.input, 0.05);
      if (d.swing && swungAt < 0) swungAt = now;
    }
    expect(swungAt).toBeGreaterThan(0);
    expect(Math.hypot(self.x - enemies[0].x, self.z - enemies[0].z)).toBeLessThan(3);
  });
});

describe('training dummy (passive bot)', () => {
  it('never attacks or moves, but turns to face a visible enemy', () => {
    const w = flat();
    const bot = createBot(createRng(5), waypoints, { passive: true });
    let self = createPhysState(32, 1, 40, Math.PI); // facing +Z, enemy at -Z
    const enemies = [{ id: 'e', x: 32, y: 1, z: 30 }];
    for (let i = 0; i < 80; i++) {
      const d = bot.compute(w, { self, enemies, now: i * 50 }, 0.05);
      expect(d.shoot).toBe(false);
      expect(d.swing).toBe(false);
      expect(d.input.forward).toBe(0);
      expect(d.input.strafe).toBe(0);
      expect(d.input.jump).toBe(false);
      self = stepPlayer(w, { ...self, yaw: d.yaw, pitch: d.pitch }, d.input, 0.05);
    }
    expect(self.x).toBe(32);
    expect(self.z).toBe(40);
    const wantYaw = Math.atan2(-(enemies[0].x - self.x), -(enemies[0].z - self.z));
    expect(Math.abs(Math.atan2(Math.sin(self.yaw - wantYaw), Math.cos(self.yaw - wantYaw)))).toBeLessThan(0.15);
  });

  it('stands still with nobody around (no wandering)', () => {
    const w = flat();
    const bot = createBot(createRng(6), waypoints, { passive: true });
    let self = createPhysState(30, 1, 30, 0);
    for (let i = 0; i < 40; i++) {
      const d = bot.compute(w, { self, enemies: [], now: i * 50 }, 0.05);
      self = stepPlayer(w, { ...self, yaw: d.yaw, pitch: d.pitch }, d.input, 0.05);
    }
    expect(self.x).toBe(30);
    expect(self.z).toBe(30);
  });
});

describe('bot (capture the flag)', () => {
  it('walks to its goal when nobody is in sight, then wanders once there', () => {
    const w = flat();
    const bot = createBot(createRng(4), waypoints);
    let self = createPhysState(32, 1, 40, 0);
    const goal = { x: 32, y: 1, z: 20 };
    let reachedAt = -1;
    for (let i = 0; i < 200; i++) {
      const d = bot.compute(w, { self, enemies: [], now: i * 50, goal }, 0.05);
      self = stepPlayer(w, { ...self, yaw: d.yaw, pitch: d.pitch }, d.input, 0.05);
      if (reachedAt < 0 && Math.hypot(self.x - goal.x, self.z - goal.z) < 2) reachedAt = i;
    }
    expect(reachedAt).toBeGreaterThan(0);
    expect(reachedAt).toBeLessThan(120); // ~20 blocks at walking speed
  });

  it('a carrier keeps running for the goal, holds the melee weapon and never shoots', () => {
    const w = flat();
    const bot = createBot(createRng(5), waypoints);
    let self = createPhysState(32, 1, 40, 0);
    const goal = { x: 32, y: 1, z: 5 };
    const enemies = [{ id: 'e', x: 37, y: 1, z: 30 }]; // beside the path, in plain sight, out of sword reach
    for (let i = 0; i < 100; i++) {
      const d = bot.compute(w, { self, enemies, now: i * 50, goal, carrying: true }, 0.05);
      expect(d.shoot).toBe(false);
      expect(d.weapon).toBe(WEAPON_SWORD);
      self = stepPlayer(w, { ...self, yaw: d.yaw, pitch: d.pitch }, d.input, 0.05);
    }
    expect(self.z).toBeLessThan(15); // pushed on past the enemy toward the goal
  });

  it('a carrier in a gun-only room cannot attack at all', () => {
    const w = flat();
    const bot = createBot(createRng(6), waypoints, { weapons: 'gun' });
    const self = createPhysState(32, 1, 40, 0);
    const d = bot.compute(w, { self, enemies: [{ id: 'e', x: 32, y: 1, z: 38.5 }], now: 1000, goal: { x: 32, y: 1, z: 5 }, carrying: true }, 0.05);
    expect(d.shoot).toBe(false);
    expect(d.swing).toBe(false);
    expect(d.weapon).toBe(WEAPON_GUN);
  });

  it('a carrier still swings at an enemy within sword reach', () => {
    const w = flat();
    const bot = createBot(createRng(7), waypoints);
    const self = createPhysState(32, 1, 40, 0);
    const view = { self, enemies: [{ id: 'e', x: 32, y: 1, z: 38.5 }], goal: { x: 32, y: 1, z: 5 }, carrying: true };
    bot.compute(w, { ...view, now: 0 }, 0.05);
    const d = bot.compute(w, { ...view, now: 1000 }, 0.05);
    expect(d.weapon).toBe(WEAPON_SWORD);
    expect(d.swing).toBe(true);
  });
});

describe('bot navigation', () => {
  /** Server-style simulation: 20 Hz brain, physics substeps. */
  const simulate = (world: ReturnType<typeof generateWorld>['world'], bot: ReturnType<typeof createBot>, start: { x: number; y: number; z: number }, seconds: number, until: (s: ReturnType<typeof createPhysState>) => boolean): { self: ReturnType<typeof createPhysState>; t: number } => {
    let self = createPhysState(start.x, start.y, start.z);
    const dt = SERVER_TICK_MS / 1000;
    const sub = Math.round(dt / PHYSICS_DT);
    for (let t = 0; t < seconds; t += dt) {
      const d = bot.compute(world, { self, enemies: [], now: t * 1000 }, dt);
      self = { ...self, yaw: d.yaw, pitch: d.pitch };
      for (let i = 0; i < sub; i++) self = stepPlayer(world, self, d.input, PHYSICS_DT);
      if (until(self)) return { self, t };
    }
    return { self, t: seconds };
  };

  it('finds its way up the arena plateau via a ramp instead of hopping at the wall', () => {
    const { world, spawnPoints } = generateWorld(7);
    const cx = Math.floor((PLATEAU_MIN + PLATEAU_MAX) / 2) + 0.5;
    const top = { x: cx, y: 10, z: cx };
    const ground = spawnPoints.filter((s) => !(s.x >= PLATEAU_MIN - 1 && s.x <= PLATEAU_MAX + 2 && s.z >= PLATEAU_MIN - 1 && s.z <= PLATEAU_MAX + 2));
    expect(ground.length).toBeGreaterThan(3);
    for (const s of ground.slice(0, 4)) {
      const bot = createBot(createRng(3), [top]);
      const { self, t } = simulate(world, bot, s, 60, (p) => p.y >= 10 && Math.hypot(p.x - top.x, p.z - top.z) < 2);
      expect(t, `from ${s.x},${s.z} ended at ${self.x.toFixed(1)},${self.y.toFixed(1)},${self.z.toFixed(1)}`).toBeLessThan(60);
    }
  });

  it('gets down and across to a far ground waypoint from the plateau top', () => {
    const { world, spawnPoints } = generateWorld(7);
    const cx = Math.floor((PLATEAU_MIN + PLATEAU_MAX) / 2) + 0.5;
    const far = spawnPoints.filter((s) => Math.hypot(s.x - cx, s.z - cx) > 20)[0];
    const bot = createBot(createRng(5), [far]);
    const { self, t } = simulate(world, bot, { x: cx, y: 10, z: cx }, 60, (p) => Math.hypot(p.x - far.x, p.z - far.z) < 2);
    expect(t, `ended at ${self.x.toFixed(1)},${self.y.toFixed(1)},${self.z.toFixed(1)}`).toBeLessThan(60);
  });
});

describe('bot navigation (unroutable)', () => {
  it('gives up on a waypoint it cannot route to and picks another', () => {
    const w = createWorld(64, 24, 64);
    for (let x = 0; x < 64; x++) for (let z = 0; z < 64; z++) setBlock(w, x, 0, z, Block.Stone);
    // A 3-high pillar with a spawn point on top: unreachable from the ground.
    for (let y = 1; y <= 3; y++) setBlock(w, 40, y, 40, Block.Brick);
    const perch = { x: 40.5, y: 4, z: 40.5 };
    const ground = { x: 10.5, y: 1, z: 10.5 };
    const bot = createBot(createRng(9), [perch, ground]);
    let self = createPhysState(32, 1, 32, 0);
    let nearGround = false;
    for (let i = 0; i < 400; i++) {
      const d = bot.compute(w, { self, enemies: [], now: i * 50 }, 0.05);
      self = stepPlayer(w, { ...self, yaw: d.yaw, pitch: d.pitch }, d.input, 0.05);
      if (Math.hypot(self.x - ground.x, self.z - ground.z) < 2) nearGround = true;
    }
    expect(nearGround).toBe(true);
  });
});

describe('bot skill', () => {
  it('profiles get strictly sharper from easy to hard', () => {
    const e = botSkillProfile('easy');
    const n = botSkillProfile('normal');
    const h = botSkillProfile('hard');
    expect(e.reactionMs).toBeGreaterThan(n.reactionMs);
    expect(n.reactionMs).toBeGreaterThan(h.reactionMs);
    expect(e.aimErrorPerBlock).toBeGreaterThan(n.aimErrorPerBlock);
    expect(n.aimErrorPerBlock).toBeGreaterThan(h.aimErrorPerBlock);
    expect(e.attackIntervalMs).toBeGreaterThan(n.attackIntervalMs);
    expect(n.attackIntervalMs).toBeGreaterThan(h.attackIntervalMs);
    expect(e.sightRange).toBeLessThan(h.sightRange);
    expect(isBotSkill('easy') && isBotSkill('normal') && isBotSkill('hard')).toBe(true);
    expect(isBotSkill('godlike')).toBe(false);
    expect(DEFAULT_BOT_SKILL).toBe('normal');
  });

  /** Ticks (50 ms) at which the bot pulled the trigger, standing still with an enemy in plain view. */
  const shotTicks = (skill: BotSkill, ticks: number): number[] => {
    const w = flat();
    const bot = createBot(createRng(1), waypoints, { skill });
    let self = createPhysState(32, 1, 40, 0); // already facing the enemy
    const out: number[] = [];
    for (let i = 0; i < ticks; i++) {
      const d = bot.compute(w, { self, enemies: [{ id: 'e', x: 32, y: 1, z: 25 }], now: i * 50 }, 0.05);
      self = { ...self, yaw: d.yaw, pitch: d.pitch }; // no physics: hold position, take aim
      if (d.shoot) out.push(i);
    }
    return out;
  };

  it('an easy bot reacts later and fires less often than a hard one', () => {
    const easy = shotTicks('easy', 100);
    const hard = shotTicks('hard', 100);
    expect(easy.length).toBeGreaterThan(0);
    expect(hard.length).toBeGreaterThan(easy.length);
    expect(easy[0] * 50).toBeGreaterThanOrEqual(botSkillProfile('easy').reactionMs);
    expect(hard[0]).toBeLessThan(easy[0]);
    // Shots are spaced by at least the profile's attack interval.
    const gap = botSkillProfile('easy').attackIntervalMs / 50;
    for (let i = 1; i < easy.length; i++) expect(easy[i] - easy[i - 1]).toBeGreaterThanOrEqual(gap);
  });

  it('defaults to normal and hard matches the sharpest profile', () => {
    expect(shotTicks('normal', 100)).toEqual(shotTicks(DEFAULT_BOT_SKILL, 100));
    expect(shotTicks('hard', 100).length).toBeGreaterThanOrEqual(shotTicks('normal', 100).length);
  });
});
