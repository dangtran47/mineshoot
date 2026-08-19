import { describe, expect, it } from 'vitest';
import { TEAM_BLUE, TEAM_NONE, TEAM_RED } from '@mineshoot/shared';
import type { RankRow } from '@mineshoot/shared';
import { ctfHeadline, ctfOutcome, splitTeams } from '../src/screens/results';

const ctf = (redScore: number, blueScore: number) => ({ redScore, blueScore, captureLimit: 3 });

describe('ctfOutcome', () => {
  it('is victory/defeat from my team', () => {
    expect(ctfOutcome(ctf(3, 1), TEAM_RED)).toBe('victory');
    expect(ctfOutcome(ctf(3, 1), TEAM_BLUE)).toBe('defeat');
    expect(ctfOutcome(ctf(0, 2), TEAM_BLUE)).toBe('victory');
  });
  it('is a draw on equal scores', () => {
    expect(ctfOutcome(ctf(2, 2), TEAM_RED)).toBe('draw');
    expect(ctfOutcome(ctf(2, 2), TEAM_BLUE)).toBe('draw');
  });
  it('is undefined for someone on no team', () => {
    expect(ctfOutcome(ctf(3, 1), TEAM_NONE)).toBeUndefined();
    expect(ctfOutcome(ctf(3, 1), undefined)).toBeUndefined();
  });
});

describe('ctfHeadline', () => {
  it('names the winner or the draw', () => {
    expect(ctfHeadline(ctf(3, 1))).toBe('Red wins 3 – 1');
    expect(ctfHeadline(ctf(2, 2))).toBe('Draw 2 – 2');
  });
});

describe('splitTeams', () => {
  const row = (id: string, team: number, captures: number, kills: number): RankRow => ({ id, name: id, kills, deaths: 0, team, captures });
  it('groups rows per team, ranked by captures then kills', () => {
    const rows = [row('b1', TEAM_BLUE, 0, 5), row('r1', TEAM_RED, 1, 0), row('r2', TEAM_RED, 2, 0), row('b2', TEAM_BLUE, 0, 9)];
    const { red, blue } = splitTeams(rows);
    expect(red.map((r) => r.id)).toEqual(['r2', 'r1']);
    expect(blue.map((r) => r.id)).toEqual(['b2', 'b1']);
  });
  it('drops teamless rows and returns empty sides', () => {
    const { red, blue } = splitTeams([row('x', TEAM_NONE, 0, 1)]);
    expect(red).toEqual([]);
    expect(blue).toEqual([]);
  });
});
