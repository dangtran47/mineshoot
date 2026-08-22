import { describe, expect, it } from 'vitest';
import { TEAM_BLUE, TEAM_NONE, TEAM_RED } from '@mineshoot/shared';
import { SPECTATE_DELAY_MS, cycleTarget, eligibleTargets, retainTarget, spectateReady } from '../src/game/spectateModel';
import type { SpectateCandidate } from '../src/game/spectateModel';

const p = (id: string, over: Partial<SpectateCandidate> = {}): SpectateCandidate => ({
  id,
  alive: true,
  team: TEAM_NONE,
  ...over,
});

describe('eligibleTargets', () => {
  it('lists everyone else alive in a solo mode, bots included', () => {
    const all = [p('me'), p('bot'), p('other')];
    expect(eligibleTargets(all, 'me', false, TEAM_NONE)).toEqual(['bot', 'other']);
  });

  it('drops me and the dead', () => {
    const all = [p('me'), p('a', { alive: false }), p('b')];
    expect(eligibleTargets(all, 'me', false, TEAM_NONE)).toEqual(['b']);
  });

  it('keeps only my team in a team mode', () => {
    const all = [
      p('me', { team: TEAM_RED }),
      p('mate', { team: TEAM_RED }),
      p('foe', { team: TEAM_BLUE }),
    ];
    expect(eligibleTargets(all, 'me', true, TEAM_RED)).toEqual(['mate']);
  });

  it('is empty in a team mode while I have no team', () => {
    const all = [p('me'), p('a', { team: TEAM_RED }), p('b', { team: TEAM_BLUE })];
    expect(eligibleTargets(all, 'me', true, TEAM_NONE)).toEqual([]);
  });

  it('sorts by id so next/previous stays stable', () => {
    const all = [p('c'), p('a'), p('b'), p('me')];
    expect(eligibleTargets(all, 'me', false, TEAM_NONE)).toEqual(['a', 'b', 'c']);
  });
});

describe('cycleTarget', () => {
  const list = ['a', 'b', 'c'];

  it('walks forward with wraparound', () => {
    expect(cycleTarget(list, 'a', 1)).toBe('b');
    expect(cycleTarget(list, 'c', 1)).toBe('a');
  });

  it('walks backward with wraparound', () => {
    expect(cycleTarget(list, 'b', -1)).toBe('a');
    expect(cycleTarget(list, 'a', -1)).toBe('c');
  });

  it('enters at the first (forward) or last (backward) when there is no current target', () => {
    expect(cycleTarget(list, null, 1)).toBe('a');
    expect(cycleTarget(list, null, -1)).toBe('c');
    expect(cycleTarget(list, 'gone', 1)).toBe('a');
  });

  it('has nothing to cycle to in an empty list', () => {
    expect(cycleTarget([], 'a', 1)).toBeNull();
    expect(cycleTarget([], null, -1)).toBeNull();
  });
});

describe('retainTarget', () => {
  it('keeps a target that is still eligible', () => {
    expect(retainTarget(['a', 'b'], 'b')).toBe('b');
  });

  it('falls to the first eligible when the target died or left', () => {
    expect(retainTarget(['a', 'b'], 'gone')).toBe('a');
    expect(retainTarget(['a', 'b'], null)).toBe('a');
  });

  it('gives up (death cam) when nobody is eligible', () => {
    expect(retainTarget([], 'a')).toBeNull();
  });
});

describe('spectateReady', () => {
  it('waits out the death overlay', () => {
    expect(spectateReady(1000, 1000 + SPECTATE_DELAY_MS - 1)).toBe(false);
    expect(spectateReady(1000, 1000 + SPECTATE_DELAY_MS)).toBe(true);
  });

  it('never starts before the first spawn (diedAt 0)', () => {
    expect(spectateReady(0, 999_999)).toBe(false);
  });
});
