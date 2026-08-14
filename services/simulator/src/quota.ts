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
}

export const DEFAULT_QUOTA: QuotaConfig = {
  perCallerPerDay: 30,
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
        reason: "The assistant has hit today's usage limit for everyone. Your figures still work.",
      };
    }

    const caller = this.roll(this.callers.get(callerId) ?? { count: 0, resetsAt: now + DAY_MS }, now);
    this.callers.set(callerId, caller);

    if (caller.count >= this.config.perCallerPerDay) {
      return {
        allowed: false,
        reason: `You have used today's ${this.config.perCallerPerDay} questions. The sliders and figures still work.`,
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
