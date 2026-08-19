import { describe, expect, it } from 'vitest';
import { CTF_BASE_ZONE_RADIUS } from '../src/constants';
import { botCtfGoal, botRebalance, canScore, carriedFlag, flagTouch, matchWinner, pickTeam, teamSpawns } from '../src/ctf';
import type { FlagState } from '../src/ctf';
import { TEAM_BLUE, TEAM_NONE, TEAM_RED } from '../src/protocol';
import type { Team } from '../src/protocol';

const bases = { [TEAM_RED]: { x: 7.5, y: 7, z: 24.5 }, [TEAM_BLUE]: { x: 88.5, y: 7, z: 24.5 } };
const home = (team: typeof TEAM_RED | typeof TEAM_BLUE): FlagState => ({ team, status: 'home', ...bases[team], carrierId: '' });
const carried = (team: typeof TEAM_RED | typeof TEAM_BLUE, by: string, x = 50, z = 24): FlagState => ({ team, status: 'carried', x, y: 5, z, carrierId: by });
const dropped = (team: typeof TEAM_RED | typeof TEAM_BLUE, x = 50, z = 24): FlagState => ({ team, status: 'dropped', x, y: 5, z, carrierId: '' });

describe('teamSpawns', () => {
  it('keeps the n spawn points nearest the base', () => {
    const spawns = [10, 80, 20, 60, 5, 90].map((x) => ({ x, y: 4, z: 24 }));
    expect(teamSpawns(spawns, bases[TEAM_RED], 3).map((s) => s.x)).toEqual([10, 5, 20]);
    expect(teamSpawns(spawns, bases[TEAM_BLUE], 2).map((s) => s.x)).toEqual([90, 80]);
    expect(teamSpawns(spawns, bases[TEAM_RED], 10)).toHaveLength(6);
  });
});

describe('flagTouch', () => {
  it('enemies take a home flag and pick up a dropped one', () => {
    expect(flagTouch(home(TEAM_RED), { team: TEAM_BLUE })).toBe('take');
    expect(flagTouch(dropped(TEAM_RED), { team: TEAM_BLUE })).toBe('pickup');
  });
  it('the owning team returns a dropped flag and ignores its own home flag', () => {
    expect(flagTouch(dropped(TEAM_RED), { team: TEAM_RED })).toBe('return');
    expect(flagTouch(home(TEAM_RED), { team: TEAM_RED })).toBeNull();
  });
  it('a carried flag cannot be touched', () => {
    expect(flagTouch(carried(TEAM_RED, 'b1'), { team: TEAM_BLUE })).toBeNull();
    expect(flagTouch(carried(TEAM_RED, 'b1'), { team: TEAM_RED })).toBeNull();
  });
});

describe('canScore', () => {
  const inZone = { id: 'r1', team: TEAM_RED as Team, x: bases[TEAM_RED].x + CTF_BASE_ZONE_RADIUS - 0.5, z: bases[TEAM_RED].z };
  it('needs the enemy flag in hand, the own flag home, and the carrier inside the base zone', () => {
    expect(canScore(inZone, [home(TEAM_RED), carried(TEAM_BLUE, 'r1')], bases)).toBe(true);
    expect(canScore({ ...inZone, x: bases[TEAM_RED].x + CTF_BASE_ZONE_RADIUS + 0.5 }, [home(TEAM_RED), carried(TEAM_BLUE, 'r1')], bases)).toBe(false);
    expect(canScore(inZone, [dropped(TEAM_RED), carried(TEAM_BLUE, 'r1')], bases)).toBe(false);
    expect(canScore(inZone, [carried(TEAM_RED, 'b1'), carried(TEAM_BLUE, 'r1')], bases)).toBe(false);
    expect(canScore(inZone, [home(TEAM_RED), home(TEAM_BLUE)], bases)).toBe(false);
    expect(canScore(inZone, [home(TEAM_RED), carried(TEAM_BLUE, 'r2')], bases)).toBe(false);
  });
  it('carriedFlag finds the flag a player holds', () => {
    const flags = [home(TEAM_RED), carried(TEAM_BLUE, 'r1')];
    expect(carriedFlag(flags, 'r1')?.team).toBe(TEAM_BLUE);
    expect(carriedFlag(flags, 'r2')).toBeNull();
  });
});

describe('teams', () => {
  it('pickTeam joins the smaller team, rng breaks ties', () => {
    expect(pickTeam({ [TEAM_RED]: 2, [TEAM_BLUE]: 1 }, () => 0)).toBe(TEAM_BLUE);
    expect(pickTeam({ [TEAM_RED]: 0, [TEAM_BLUE]: 1 }, () => 0.9)).toBe(TEAM_RED);
    expect(pickTeam({ [TEAM_RED]: 1, [TEAM_BLUE]: 1 }, () => 0.1)).toBe(TEAM_RED);
    expect(pickTeam({ [TEAM_RED]: 1, [TEAM_BLUE]: 1 }, () => 0.9)).toBe(TEAM_BLUE);
  });
  it('botRebalance moves a bot off the bigger team only when the gap is two or more', () => {
    expect(botRebalance({ [TEAM_RED]: 3, [TEAM_BLUE]: 2 }, { [TEAM_RED]: ['bot1'], [TEAM_BLUE]: [] })).toBeNull();
    expect(botRebalance({ [TEAM_RED]: 4, [TEAM_BLUE]: 2 }, { [TEAM_RED]: ['bot1', 'bot3'], [TEAM_BLUE]: [] })).toEqual({ id: 'bot1', to: TEAM_BLUE });
    expect(botRebalance({ [TEAM_RED]: 1, [TEAM_BLUE]: 3 }, { [TEAM_RED]: [], [TEAM_BLUE]: ['bot2'] })).toEqual({ id: 'bot2', to: TEAM_RED });
    expect(botRebalance({ [TEAM_RED]: 1, [TEAM_BLUE]: 3 }, { [TEAM_RED]: [], [TEAM_BLUE]: [] })).toBeNull();
  });
  it('matchWinner', () => {
    expect(matchWinner(3, 1)).toBe(TEAM_RED);
    expect(matchWinner(0, 2)).toBe(TEAM_BLUE);
    expect(matchWinner(2, 2)).toBe(TEAM_NONE);
  });
});

describe('botCtfGoal', () => {
  const west = { x: 20, z: 24 };
  it('a carrier heads home', () => {
    expect(botCtfGoal(TEAM_RED, 'bot1', west, [home(TEAM_RED), carried(TEAM_BLUE, 'bot1')], bases)).toEqual(bases[TEAM_RED]);
  });
  it('otherwise goes for the enemy flag wherever it lies', () => {
    expect(botCtfGoal(TEAM_RED, 'bot1', west, [home(TEAM_RED), home(TEAM_BLUE)], bases)).toEqual(bases[TEAM_BLUE]);
    expect(botCtfGoal(TEAM_RED, 'bot1', west, [home(TEAM_RED), dropped(TEAM_BLUE, 40, 10)], bases)).toEqual({ x: 40, y: 5, z: 10 });
  });
  it('escorts a teammate carrying the enemy flag (the flag position follows them)', () => {
    expect(botCtfGoal(TEAM_RED, 'bot1', west, [home(TEAM_RED), carried(TEAM_BLUE, 'r2', 60, 30)], bases)).toEqual({ x: 60, y: 5, z: 30 });
  });
  it('returns the own flag when it lies closer than the enemy flag, else keeps attacking', () => {
    expect(botCtfGoal(TEAM_RED, 'bot1', west, [dropped(TEAM_RED, 30, 20), home(TEAM_BLUE)], bases)).toEqual({ x: 30, y: 5, z: 20 });
    expect(botCtfGoal(TEAM_RED, 'bot1', { x: 80, z: 24 }, [dropped(TEAM_RED, 30, 20), home(TEAM_BLUE)], bases)).toEqual(bases[TEAM_BLUE]);
  });
  it('chases the enemy carrying the own flag only when they are near', () => {
    expect(botCtfGoal(TEAM_RED, 'bot1', west, [carried(TEAM_RED, 'b1', 30, 12), home(TEAM_BLUE)], bases)).toEqual({ x: 30, y: 5, z: 12 });
    expect(botCtfGoal(TEAM_RED, 'bot1', west, [carried(TEAM_RED, 'b1', 70, 12), home(TEAM_BLUE)], bases)).toEqual(bases[TEAM_BLUE]);
  });
});
