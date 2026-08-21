import { describe, expect, it } from 'vitest';
import { TEAM_BLUE, TEAM_NONE, TEAM_RED } from '@mineshoot/shared';
import type { RankRow } from '@mineshoot/shared';
import { ctfHeadline, ctfOutcome } from '../src/screens/results';

const ctf = (redScore: number, blueScore: number) => ({ mode: 'ctf' as const, redScore, blueScore, captureLimit: 3 });

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
  it('works the same for td round wins', () => {
    const td = { mode: 'td' as const, redScore: 5, blueScore: 3, captureLimit: 5 };
    expect(ctfHeadline(td)).toBe('Red wins 5 – 3');
    expect(ctfOutcome(td, TEAM_BLUE)).toBe('defeat');
  });
});

