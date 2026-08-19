import { MELEE_AXE, MELEE_KATANA, MELEE_PICKAXE, MELEE_SCYTHE, MELEE_SWORD, WEAPON_GUN, killTags } from '@mineshoot/shared';
import type { KillAwards, MeleeKind, Weapon } from '@mineshoot/shared';

/** How a feed line relates to the local player: their kill, their death, or neither. */
export type FeedKind = 'neutral' | 'good' | 'bad';

export interface FeedEntry {
  /** A kill line, or null for a plain-text line (flag events). */
  line: KillLineInput | null;
  /** Text of a plain line ('' for kill lines). */
  text: string;
  /** Milliseconds timestamp when it should disappear. */
  expiresAt: number;
  kind: FeedKind;
}

export interface KillLineInput extends KillAwards {
  killer: string;
  victim: string;
  weapon: Weapon;
  /** Melee kind used (meaningful when weapon is the melee slot). */
  melee?: MeleeKind;
  headshot: boolean;
}

export const FEED_MAX = 5;
export const FEED_TTL_MS = 6000;

/** Pure model behind the kill feed: newest last, capped, time-expiring. */
export class KillFeedModel {
  readonly entries: FeedEntry[] = [];

  push(line: KillLineInput, now: number, kind: FeedKind = 'neutral'): void {
    this.entries.push({ line, text: '', expiresAt: now + FEED_TTL_MS, kind });
    while (this.entries.length > FEED_MAX) this.entries.shift();
  }

  /** A plain-text line ("🚩 Bob took the Red flag"). */
  pushText(text: string, now: number, kind: FeedKind = 'neutral'): void {
    this.entries.push({ line: null, text, expiresAt: now + FEED_TTL_MS, kind });
    while (this.entries.length > FEED_MAX) this.entries.shift();
  }

  /** Remove expired entries; returns true if anything changed. */
  prune(now: number): boolean {
    const before = this.entries.length;
    for (let i = this.entries.length - 1; i >= 0; i--) if (this.entries[i].expiresAt <= now) this.entries.splice(i, 1);
    return this.entries.length !== before;
  }
}

const MELEE_EMOJI: Record<MeleeKind, string> = {
  [MELEE_SWORD]: '🗡️',
  [MELEE_AXE]: '🪓',
  [MELEE_KATANA]: '⚔️',
  [MELEE_SCYTHE]: '🌙',
  [MELEE_PICKAXE]: '⛏️',
};

/** "Alice 🔫🎯 Bob · DOUBLE KILL" — plain-text form of a feed line (accessible name / tooltip). */
export function killFeedLine(k: KillLineInput): string {
  const icon = (k.weapon === WEAPON_GUN ? '🔫' : (MELEE_EMOJI[k.melee ?? MELEE_SWORD] ?? '🗡️')) + (k.headshot ? '🎯' : '');
  return [`${k.killer} ${icon} ${k.victim}`, ...killTags(k)].join(' · ');
}
