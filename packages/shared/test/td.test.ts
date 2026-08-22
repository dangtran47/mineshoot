import { describe, expect, it } from 'vitest';
import { GUN_NONE, GUN_RIFLE, GUN_SHOTGUN, GUN_SMG, GUN_SNIPER, spawnPrimary } from '../src/guns';
import { MELEE_AXE, MELEE_KATANA, MELEE_PICKAXE, MELEE_SCYTHE } from '../src/melee';
import { TEAM_BLUE, TEAM_NONE, TEAM_RED, WEAPON_MELEE, WEAPON_PRIMARY } from '../src/protocol';
import { botTdGoal, roundWinner, tdWeaponLoadout } from '../src/td';

describe('roundWinner', () => {
  const side = (alive: number, inRound = alive, ready = Math.max(inRound, 1)): { alive: number; inRound: number; ready: number } => ({ alive, inRound, ready });
  it('never ends a round while a team has nobody ready at all', () => {
    expect(roundWinner(side(1), { alive: 0, inRound: 0, ready: 0 })).toBeNull();
    expect(roundWinner({ alive: 0, inRound: 0, ready: 0 }, { alive: 0, inRound: 0, ready: 0 })).toBeNull();
  });
  it('the surviving team wins when the other is wiped', () => {
    expect(roundWinner(side(2), side(0, 2))).toBe(TEAM_RED);
    expect(roundWinner(side(0, 3), side(1, 2))).toBe(TEAM_BLUE);
  });
  it('a simultaneous wipe is a draw', () => {
    expect(roundWinner(side(0, 2), side(0, 2))).toBe(TEAM_NONE);
  });
  it('the round continues while both sides have fighters alive', () => {
    expect(roundWinner(side(1, 2), side(2, 2))).toBeNull();
  });
  it('ready players waiting outside the round draw it (no free point), so the next round brings them in', () => {
    // A blue player joined mid-round (past the grace): red must not win a round blue never fought in.
    expect(roundWinner(side(1), { alive: 0, inRound: 0, ready: 1 })).toBe(TEAM_NONE);
    expect(roundWinner({ alive: 0, inRound: 0, ready: 2 }, side(1))).toBe(TEAM_NONE);
  });
});

describe('tdWeaponLoadout', () => {
  it('lays the fixed gun row north and its exact reverse south, two of each gun per side', () => {
    const loadout = tdWeaponLoadout('all');
    expect(loadout).toHaveLength(16);
    expect(loadout.every((d) => d.slot === WEAPON_PRIMARY)).toBe(true);
    const row = [GUN_SNIPER, GUN_SHOTGUN, GUN_SMG, GUN_RIFLE, GUN_SMG, GUN_SHOTGUN, GUN_RIFLE, GUN_SNIPER];
    expect(loadout.slice(0, 8).map((d) => d.kind)).toEqual(row);
    // The south row reverses, so each team reads the same order left-to-right from its own side.
    expect(loadout.slice(8).map((d) => d.kind)).toEqual([...row].reverse());
  });
  it('lays two of each blade per side in a sword-only room', () => {
    const loadout = tdWeaponLoadout('sword');
    expect(loadout).toHaveLength(16);
    expect(loadout.every((d) => d.slot === WEAPON_MELEE)).toBe(true);
    for (const kind of [MELEE_AXE, MELEE_KATANA, MELEE_SCYTHE, MELEE_PICKAXE]) {
      expect(loadout.slice(0, 8).filter((d) => d.kind === kind)).toHaveLength(2);
      expect(loadout.slice(8).filter((d) => d.kind === kind)).toHaveLength(2);
    }
  });
});

describe('botTdGoal', () => {
  const center = { x: 32, y: 4, z: 32 };
  const self = { x: 10, z: 10 };
  it('an unarmed bot heads for the nearest weapon on the ground', () => {
    const drops = [
      { x: 40, y: 4, z: 13 },
      { x: 12, y: 4, z: 13 },
    ];
    expect(botTdGoal(self, { enemies: [{ x: 20, y: 4, z: 20 }], drops, armed: false, center })).toEqual({ x: 12, y: 4, z: 13 });
  });
  it('an armed bot hunts the nearest known enemy', () => {
    const enemies = [
      { x: 50, y: 4, z: 50 },
      { x: 20, y: 4, z: 20 },
    ];
    expect(botTdGoal(self, { enemies, drops: [{ x: 12, y: 4, z: 13 }], armed: true, center })).toEqual({ x: 20, y: 4, z: 20 });
  });
  it('with no weapon left to grab it hunts even unarmed', () => {
    expect(botTdGoal(self, { enemies: [{ x: 20, y: 4, z: 20 }], drops: [], armed: false, center })).toEqual({ x: 20, y: 4, z: 20 });
  });
  it('falls back to the crossroads when nothing is known', () => {
    expect(botTdGoal(self, { enemies: [], drops: [], armed: true, center })).toEqual(center);
  });
});

describe('spawnPrimary in td', () => {
  it('never rolls a free primary (players fetch guns from the ground)', () => {
    expect(spawnPrimary('td', 'all', () => 0)).toBe(GUN_NONE);
  });
});
