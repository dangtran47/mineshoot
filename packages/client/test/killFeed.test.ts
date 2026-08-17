import { describe, expect, it } from 'vitest';
import { FEED_MAX, FEED_TTL_MS, KillFeedModel, killFeedLine } from '../src/hud/killFeed';
import type { KillLineInput } from '../src/hud/killFeed';
import { MELEE_AXE, MELEE_PICKAXE, WEAPON_GUN, WEAPON_SWORD } from '@mineshoot/shared';

const line = (killer: string): KillLineInput => ({ killer, victim: 'v', weapon: WEAPON_GUN, multi: 1, streak: 1, revenge: false, shutdown: false, headshot: false });

describe('KillFeedModel', () => {
  it('caps entries and expires them', () => {
    const f = new KillFeedModel();
    for (let i = 0; i < FEED_MAX + 3; i++) f.push(line(`k${i}`), 0);
    expect(f.entries).toHaveLength(FEED_MAX);
    expect(f.entries[0].line.killer).toBe('k3');
    expect(f.entries[0].kind).toBe('neutral');
    expect(f.prune(FEED_TTL_MS - 1)).toBe(false);
    expect(f.prune(FEED_TTL_MS)).toBe(true);
    expect(f.entries).toHaveLength(0);
  });
  it('remembers the entry kind', () => {
    const f = new KillFeedModel();
    f.push(line('a'), 0, 'good');
    f.push(line('b'), 0, 'bad');
    expect(f.entries.map((e) => e.kind)).toEqual(['good', 'bad']);
  });
});

describe('killFeedLine', () => {
  const base = { killer: 'Alice', victim: 'Bob', multi: 1, streak: 1, revenge: false, shutdown: false, headshot: false };
  it('renders weapon icon between names', () => {
    expect(killFeedLine({ ...base, weapon: WEAPON_GUN })).toBe('Alice 🔫 Bob');
    expect(killFeedLine({ ...base, weapon: WEAPON_SWORD })).toBe('Alice 🗡️ Bob');
  });
  it('adds the headshot icon', () => {
    expect(killFeedLine({ ...base, weapon: WEAPON_GUN, headshot: true })).toBe('Alice 🔫🎯 Bob');
  });
  it('appends award tags', () => {
    expect(killFeedLine({ ...base, weapon: WEAPON_GUN, multi: 2, revenge: true })).toBe('Alice 🔫 Bob · DOUBLE KILL · REVENGE');
  });
});

describe('killFeedLine melee kinds', () => {
  it('shows the drop weapon that made the kill', () => {
    const base = line('a');
    expect(killFeedLine({ ...base, weapon: WEAPON_SWORD })).toContain('🗡️');
    expect(killFeedLine({ ...base, weapon: WEAPON_SWORD, melee: MELEE_AXE })).toContain('🪓');
    expect(killFeedLine({ ...base, weapon: WEAPON_SWORD, melee: MELEE_PICKAXE })).toContain('⛏️');
    expect(killFeedLine({ ...base, weapon: WEAPON_GUN, melee: MELEE_AXE })).toContain('🔫');
  });
});
