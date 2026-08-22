import { GUN_MACHINEGUN, GUN_NONE, GUN_PISTOL, GUN_RIFLE, GUN_SHOTGUN, GUN_SMG, GUN_SNIPER, GUN_TASER, MELEE_AXE, MELEE_KATANA, MELEE_PICKAXE, MELEE_SCYTHE, MELEE_SWORD, WEAPON_GRENADE, WEAPON_MELEE, WEAPON_TASER, killTags } from '@mineshoot/shared';
import type { GunKind, KillAwards, MeleeKind, Weapon } from '@mineshoot/shared';

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
  /** Gun kind used (meaningful when weapon is a gun slot). */
  gun?: GunKind;
  headshot: boolean;
  /** Display names of players credited with an assist (shown after the killer). */
  assists?: string[];
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

const GUN_EMOJI: Record<GunKind, string> = {
  [GUN_NONE]: '🔫',
  [GUN_PISTOL]: '🔫',
  [GUN_RIFLE]: '🔫',
  [GUN_SMG]: '🔫',
  [GUN_SHOTGUN]: '💥',
  [GUN_SNIPER]: '🎯',
  [GUN_TASER]: '⚡',
  [GUN_MACHINEGUN]: '🔫',
};

const MELEE_EMOJI: Record<MeleeKind, string> = {
  [MELEE_SWORD]: '🗡️',
  [MELEE_AXE]: '🪓',
  [MELEE_KATANA]: '⚔️',
  [MELEE_SCYTHE]: '🌙',
  [MELEE_PICKAXE]: '⛏️',
};

/** "Alice + Carol" — the killer followed by everyone who assisted. */
export function killerWithAssists(k: KillLineInput): string {
  return [k.killer, ...(k.assists ?? [])].join(' + ');
}

/** "Alice + Carol 🔫🎯 Bob · DOUBLE KILL" — plain-text form of a feed line (accessible name / tooltip). */
export function killFeedLine(k: KillLineInput): string {
  const base =
    k.weapon === WEAPON_MELEE
      ? (MELEE_EMOJI[k.melee ?? MELEE_SWORD] ?? '🗡️')
      : k.weapon === WEAPON_GRENADE
        ? '💣'
        : k.weapon === WEAPON_TASER
          ? '⚡'
          : (GUN_EMOJI[k.gun ?? GUN_PISTOL] ?? '🔫');
  const icon = base + (k.headshot ? '🎯' : '');
  return [`${killerWithAssists(k)} ${icon} ${k.victim}`, ...killTags(k)].join(' · ');
}
