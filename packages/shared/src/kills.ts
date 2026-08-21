/**
 * Kill-streak bookkeeping shared by the server (authoritative) and the client (labels).
 * Pure and time-injected so it is testable without a room.
 */

/** Two kills at most this far apart count as a multi kill (double, triple, ...). */
export const MULTI_KILL_WINDOW_MS = 4000;
/** Ending a streak of at least this many kills is a "shutdown". */
export const SHUTDOWN_STREAK = 3;

const MULTI_LABELS = ['DOUBLE KILL', 'TRIPLE KILL', 'QUADRA KILL', 'PENTA KILL', 'MEGA KILL'];
const STREAK_LABELS: Record<number, string> = { 3: 'KILLING SPREE', 5: 'RAMPAGE', 7: 'UNSTOPPABLE', 10: 'GODLIKE' };

/** "DOUBLE KILL" for 2, up to "MEGA KILL" for 6+; null below 2. */
export function multiKillLabel(multi: number): string | null {
  if (multi < 2) return null;
  return MULTI_LABELS[Math.min(multi, MULTI_LABELS.length + 1) - 2];
}

/** Streak milestone label, or null when this streak length is not a milestone. */
export function streakLabel(streak: number): string | null {
  return STREAK_LABELS[streak] ?? null;
}

/** What a kill earned its killer beyond the kill itself. */
export interface KillAwards {
  /** Kills in the current multi-kill chain (1 = a plain kill). */
  multi: number;
  /** Consecutive kills without dying, including this one. */
  streak: number;
  /** The victim was the last player to kill the killer. */
  revenge: boolean;
  /** The victim was on a streak of at least SHUTDOWN_STREAK. */
  shutdown: boolean;
}

/** Announcement tags for a kill, most important first (empty for a plain kill). */
export function killTags(a: KillAwards): string[] {
  const tags: string[] = [];
  const multi = multiKillLabel(a.multi);
  if (multi) tags.push(multi);
  if (a.revenge) tags.push('REVENGE');
  if (a.shutdown) tags.push('SHUTDOWN');
  const streak = streakLabel(a.streak);
  if (streak) tags.push(streak);
  return tags;
}

interface KillRecord {
  streak: number;
  multi: number;
  lastKillAt: number;
  /** Who killed this player last; cleared once avenged. */
  lastKilledBy: string | null;
}

const fresh = (): KillRecord => ({ streak: 0, multi: 0, lastKillAt: -Infinity, lastKilledBy: null });

export class KillTracker {
  private readonly records = new Map<string, KillRecord>();

  private rec(id: string): KillRecord {
    let r = this.records.get(id);
    if (!r) {
      r = fresh();
      this.records.set(id, r);
    }
    return r;
  }

  /** Register a kill at `now` (ms) and return what it earned. */
  recordKill(killerId: string, victimId: string, now: number): KillAwards {
    const k = this.rec(killerId);
    const v = this.rec(victimId);
    k.multi = now - k.lastKillAt <= MULTI_KILL_WINDOW_MS ? k.multi + 1 : 1;
    k.lastKillAt = now;
    k.streak++;
    const revenge = k.lastKilledBy === victimId;
    if (revenge) k.lastKilledBy = null;
    const shutdown = v.streak >= SHUTDOWN_STREAK;
    v.streak = 0;
    v.multi = 0;
    v.lastKilledBy = killerId;
    return { multi: k.multi, streak: k.streak, revenge, shutdown };
  }

  /** Forget a player who left the room. */
  remove(id: string): void {
    this.records.delete(id);
  }

  /** TD round change: streaks and multi-kill chains end with the round; the revenge grudge survives. */
  resetStreaks(): void {
    for (const r of this.records.values()) {
      r.streak = 0;
      r.multi = 0;
      r.lastKillAt = -Infinity;
    }
  }
}
