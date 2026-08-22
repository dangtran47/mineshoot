import { describe, expect, it } from 'vitest';
import {
  ASSIST_MIN_DAMAGE,
  ASSIST_WINDOW_MS,
  KillTracker,
  MULTI_KILL_WINDOW_MS,
  SHUTDOWN_STREAK,
  killTags,
  multiKillLabel,
  streakLabel,
} from '../src/kills';

describe('labels', () => {
  it('multiKillLabel names 2..6+, nothing for 0/1', () => {
    expect(multiKillLabel(0)).toBeNull();
    expect(multiKillLabel(1)).toBeNull();
    expect(multiKillLabel(2)).toBe('DOUBLE KILL');
    expect(multiKillLabel(3)).toBe('TRIPLE KILL');
    expect(multiKillLabel(4)).toBe('QUADRA KILL');
    expect(multiKillLabel(5)).toBe('PENTA KILL');
    expect(multiKillLabel(6)).toBe('MEGA KILL');
    expect(multiKillLabel(9)).toBe('MEGA KILL');
  });
  it('streakLabel fires only on milestones', () => {
    expect(streakLabel(2)).toBeNull();
    expect(streakLabel(3)).toBe('KILLING SPREE');
    expect(streakLabel(4)).toBeNull();
    expect(streakLabel(5)).toBe('RAMPAGE');
    expect(streakLabel(7)).toBe('UNSTOPPABLE');
    expect(streakLabel(10)).toBe('GODLIKE');
    expect(streakLabel(11)).toBeNull();
  });
  it('killTags orders multi, revenge, shutdown, streak', () => {
    expect(killTags({ multi: 3, streak: 5, revenge: true, shutdown: true })).toEqual([
      'TRIPLE KILL',
      'REVENGE',
      'SHUTDOWN',
      'RAMPAGE',
    ]);
    expect(killTags({ multi: 1, streak: 1, revenge: false, shutdown: false })).toEqual([]);
  });
});

describe('KillTracker', () => {
  it('counts multi kills inside the window and resets outside it', () => {
    const t = new KillTracker();
    expect(t.recordKill('a', 'b', 1000).multi).toBe(1);
    expect(t.recordKill('a', 'c', 1000 + MULTI_KILL_WINDOW_MS).multi).toBe(2);
    expect(t.recordKill('a', 'd', 1000 + MULTI_KILL_WINDOW_MS + 1).multi).toBe(3);
    // Window is measured from the previous kill, not the first one.
    expect(t.recordKill('a', 'e', 1000 + 3 * MULTI_KILL_WINDOW_MS + 2).multi).toBe(1);
  });

  it('tracks streaks per killer and resets the victim streak', () => {
    const t = new KillTracker();
    t.recordKill('a', 'b', 0);
    t.recordKill('a', 'c', 100_000);
    expect(t.recordKill('a', 'b', 200_000).streak).toBe(3);
    // b kills a: a's streak ends; b's streak begins at 1.
    const r = t.recordKill('b', 'a', 300_000);
    expect(r.streak).toBe(1);
    expect(t.recordKill('a', 'b', 400_000).streak).toBe(1);
  });

  it('flags revenge when the killer was last killed by the victim, once', () => {
    const t = new KillTracker();
    expect(t.recordKill('a', 'b', 0).revenge).toBe(false);
    expect(t.recordKill('b', 'a', 1000).revenge).toBe(true);
    // Consumed: killing them again is not revenge again unless they kill you first.
    expect(t.recordKill('b', 'a', 2000).revenge).toBe(false);
    // Being killed by c replaces the grudge against a.
    t.recordKill('a', 'b', 3000);
    t.recordKill('c', 'b', 4000);
    expect(t.recordKill('b', 'a', 5000).revenge).toBe(false);
    expect(t.recordKill('b', 'c', 6000).revenge).toBe(true);
  });

  it('flags shutdown when ending a streak >= SHUTDOWN_STREAK', () => {
    const t = new KillTracker();
    for (let i = 0; i < SHUTDOWN_STREAK - 1; i++) t.recordKill('a', `v${i}`, i * 100_000);
    expect(t.recordKill('b', 'a', 900_000).shutdown).toBe(false);
    for (let i = 0; i < SHUTDOWN_STREAK; i++) t.recordKill('a', `v${i}`, 1_000_000 + i * 100_000);
    expect(t.recordKill('b', 'a', 2_000_000).shutdown).toBe(true);
    expect(t.recordKill('b', 'a', 3_000_000).shutdown).toBe(false);
  });

  it('remove forgets a player', () => {
    const t = new KillTracker();
    t.recordKill('a', 'b', 0);
    t.recordKill('a', 'c', 0);
    t.remove('a');
    expect(t.recordKill('a', 'b', 0).multi).toBe(1);
    expect(t.recordKill('a', 'b', 0).streak).toBe(2);
  });

  describe('assists', () => {
    it('credits everyone but the killer who dealt >= ASSIST_MIN_DAMAGE inside the window', () => {
      const t = new KillTracker();
      t.recordDamage('b', 'v', ASSIST_MIN_DAMAGE, 1000);
      t.recordDamage('c', 'v', ASSIST_MIN_DAMAGE - 1, 1000);
      t.recordDamage('a', 'v', 50, 1500);
      const r = t.recordKill('a', 'v', 2000);
      expect(r.assists).toEqual(['b']);
    });

    it('sums several small hits from the same attacker', () => {
      const t = new KillTracker();
      t.recordDamage('b', 'v', 10, 1000);
      t.recordDamage('b', 'v', 10, 1200);
      t.recordDamage('b', 'v', 5, 1400);
      expect(t.recordKill('a', 'v', 2000).assists).toEqual(['b']);
    });

    it('ignores damage older than ASSIST_WINDOW_MS and self damage', () => {
      const t = new KillTracker();
      t.recordDamage('b', 'v', 50, 1000);
      t.recordDamage('v', 'v', 50, 1000 + ASSIST_WINDOW_MS);
      t.recordDamage('c', 'v', 50, 1000 + ASSIST_WINDOW_MS);
      expect(t.recordKill('a', 'v', 1000 + ASSIST_WINDOW_MS + 1).assists).toEqual(['c']);
    });

    it('lists assists in order of first damage and clears the log on death', () => {
      const t = new KillTracker();
      t.recordDamage('c', 'v', 30, 1000);
      t.recordDamage('b', 'v', 30, 1100);
      expect(t.recordKill('a', 'v', 2000).assists).toEqual(['c', 'b']);
      // Fresh life: old damage does not carry into the next death.
      expect(t.recordKill('a', 'v', 2500).assists).toEqual([]);
    });

    it('resetStreaks and remove drop pending damage', () => {
      const t = new KillTracker();
      t.recordDamage('b', 'v', 50, 1000);
      t.resetStreaks();
      expect(t.recordKill('a', 'v', 1100).assists).toEqual([]);
      t.recordDamage('b', 'v', 50, 2000);
      t.remove('v');
      expect(t.recordKill('a', 'v', 2100).assists).toEqual([]);
    });
  });

  it('resetStreaks (td round change) clears streaks and multi chains but keeps the revenge grudge', () => {
    const t = new KillTracker();
    t.recordKill('a', 'b', 0);
    t.recordKill('a', 'c', 100);
    t.resetStreaks();
    const next = t.recordKill('a', 'b', 200);
    expect(next.streak).toBe(1);
    expect(next.multi).toBe(1);
    // b was last killed by a before the reset: killing a back is still revenge.
    expect(t.recordKill('b', 'a', 300).revenge).toBe(true);
  });
});
