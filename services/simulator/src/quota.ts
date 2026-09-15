/**
 * Abuse and spend control — SPEC §9.
 *
 * Two independent limits. The per-caller quota stops one person burning the
 * budget; the global circuit breaker caps the damage when the per-caller
 * identity turns out to be forgeable, which it partly is until App Check is
 * switched on.
 *
 * In-memory is adequate at max-instances 10 with the global breaker as a
 * backstop: worst case is roughly ten times the per-instance limit. Move to
 * Firestore or Memorystore when real accounts arrive with Feature 2.
 */

export interface QuotaConfig {
  perCallerPerDay: number;
  globalPerDay: number;
  /** What ran out, for the refusal message. Defaults to "questions". */
  noun?: string;
}

/** "about 4 hours", so a refusal says when it lifts rather than just that it happened. */
function hoursUntil(resetsAt: number, now: number): string {
  const hours = Math.max(1, Math.round((resetsAt - now) / (60 * 60 * 1000)));
  return hours === 1 ? "about an hour" : `about ${hours} hours`;
}

/**
 * Questions a person actually typed.
 *
 * Was 30, set when the assistant was one small panel in a sidebar. It is now
 * the centrepiece of both `/simulator` and `/analysis`, and 30 turned out to
 * be about an hour of ordinary use — the ceiling was being hit during normal
 * work rather than by abuse, which is the definition of a mis-set limit. The
 * global breaker below is what actually guards the bill.
 */
export const DEFAULT_QUOTA: QuotaConfig = {
  perCallerPerDay: 150,
  globalPerDay: 3_000,
};

/**
 * The automatic briefing, on its own budget.
 *
 * THE BUG THIS FIXES: `/v1/location/brief` generates on page view rather than
 * on request, and it was charged to the same counter as typed questions. So
 * opening a handful of locations silently spent someone's ability to ask
 * anything, and the refusal told them they had used their "questions" when
 * they had asked none. Two different things cannot share one budget.
 *
 * Higher per caller because browsing is how the page is used, and cheap
 * because it is cached on a hash of the fact sheet: only a genuinely new
 * location costs a call.
 */
export const BRIEF_QUOTA: QuotaConfig = {
  perCallerPerDay: 120,
  globalPerDay: 2_000,
};

interface Counter {
  count: number;
  resetsAt: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class QuotaTracker {
  private callers = new Map<string, Counter>();
  private global: Counter = { count: 0, resetsAt: Date.now() + DAY_MS };

  constructor(private config: QuotaConfig = DEFAULT_QUOTA) {}

  private roll(counter: Counter, now: number): Counter {
    if (now >= counter.resetsAt) {
      counter.count = 0;
      counter.resetsAt = now + DAY_MS;
    }
    return counter;
  }

  check(callerId: string, now = Date.now()): { allowed: true } | { allowed: false; reason: string } {
    this.roll(this.global, now);
    if (this.global.count >= this.config.globalPerDay) {
      return {
        allowed: false,
        reason: `The assistant has hit today's limit for everyone. Every figure on the page still works, and this resets in ${hoursUntil(this.global.resetsAt, now)}.`,
      };
    }

    const caller = this.roll(this.callers.get(callerId) ?? { count: 0, resetsAt: now + DAY_MS }, now);
    this.callers.set(callerId, caller);

    if (caller.count >= this.config.perCallerPerDay) {
      return {
        allowed: false,
        reason: `You have reached today's limit of ${this.config.perCallerPerDay} ${this.config.noun ?? "questions"}. Everything else on the page still works, and this resets in ${hoursUntil(caller.resetsAt, now)}.`,
      };
    }

    return { allowed: true };
  }

  record(callerId: string, now = Date.now()): void {
    this.global.count += 1;
    const caller = this.roll(this.callers.get(callerId) ?? { count: 0, resetsAt: now + DAY_MS }, now);
    caller.count += 1;
    this.callers.set(callerId, caller);
  }

  /** Unbounded maps are a slow leak on a long-lived instance. */
  prune(now = Date.now()): void {
    for (const [id, counter] of this.callers) {
      if (now >= counter.resetsAt) this.callers.delete(id);
    }
  }

  snapshot(): { callers: number; globalCount: number } {
    return { callers: this.callers.size, globalCount: this.global.count };
  }
}
