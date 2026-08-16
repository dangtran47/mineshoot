import { describe, expect, it } from 'vitest';
import { FEED_MAX, FEED_TTL_MS, KillFeedModel } from '../src/hud/killFeed';

describe('KillFeedModel', () => {
  it('caps entries and expires them', () => {
    const f = new KillFeedModel();
    for (let i = 0; i < FEED_MAX + 3; i++) f.push(`k${i}`, 0);
    expect(f.entries).toHaveLength(FEED_MAX);
    expect(f.entries[0].text).toBe('k3');
    expect(f.prune(FEED_TTL_MS - 1)).toBe(false);
    expect(f.prune(FEED_TTL_MS)).toBe(true);
    expect(f.entries).toHaveLength(0);
  });
});
