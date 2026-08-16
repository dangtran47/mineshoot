import { describe, expect, it } from 'vitest';
import { createBot } from '../src/bot';
import { createRng } from '../src/rng';
import { Block } from '../src/types';
import { createWorld, setBlock } from '../src/world';
import { createPhysState, stepPlayer } from '../src/playerPhysics';
import { WEAPON_SWORD } from '../src/protocol';

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
      expect(d.input.forward).toBe(1); // heading for a waypoint
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
});
