export interface FeedEntry {
  text: string;
  /** Milliseconds timestamp when it should disappear. */
  expiresAt: number;
  highlight: boolean;
}

export const FEED_MAX = 5;
export const FEED_TTL_MS = 6000;

/** Pure model behind the kill feed: newest last, capped, time-expiring. */
export class KillFeedModel {
  readonly entries: FeedEntry[] = [];

  push(text: string, now: number, highlight = false): void {
    this.entries.push({ text, expiresAt: now + FEED_TTL_MS, highlight });
    while (this.entries.length > FEED_MAX) this.entries.shift();
  }

  /** Remove expired entries; returns true if anything changed. */
  prune(now: number): boolean {
    const before = this.entries.length;
    for (let i = this.entries.length - 1; i >= 0; i--) if (this.entries[i].expiresAt <= now) this.entries.splice(i, 1);
    return this.entries.length !== before;
  }
}
