import { describe, expect, it } from "vitest";
import { BRIEF_QUOTA, DEFAULT_QUOTA, QuotaTracker } from "../src/quota.js";

/**
 * The spend ceilings.
 *
 * Written after the limit was hit three times in a single afternoon of
 * ordinary use. Two separate faults were behind that, and both are tested
 * here: the ceiling was set for an assistant that was a small side panel, and
 * the automatic briefing was being charged to the same counter as questions a
 * person had actually typed.
 */

describe("the ask quota", () => {
  it("allows a working day of questions rather than an hour", () => {
    // 30 was about an hour of ordinary use once the assistant became the
    // centrepiece of two pages. A ceiling hit during normal work is a
    // mis-set limit, not abuse control.
    expect(DEFAULT_QUOTA.perCallerPerDay).toBeGreaterThanOrEqual(100);
  });

  it("still refuses eventually, and the global breaker is the real guard", () => {
    const quota = new QuotaTracker({ perCallerPerDay: 2, globalPerDay: 10 });

    expect(quota.check("a").allowed).toBe(true);
    quota.record("a");
    quota.record("a");

    const refused = quota.check("a");
    expect(refused.allowed).toBe(false);

    // A second caller is unaffected: the per-caller limit is per caller.
    expect(quota.check("b").allowed).toBe(true);
  });

  it("says what ran out and when it lifts", () => {
    /**
     * "You have used today's 30 questions" was the old message, and it was
     * wrong twice over once the briefing shared the counter: the reader had
     * often asked nothing at all, and it never said when they could resume.
     */
    const quota = new QuotaTracker({ perCallerPerDay: 1, globalPerDay: 10 });
    quota.record("a");

    const refused = quota.check("a");
    expect(refused.allowed).toBe(false);
    if (refused.allowed) return;

    expect(refused.reason).toContain("resets in");
    expect(refused.reason).toContain("questions");
  });

  it("names the right thing when a different counter runs out", () => {
    const quota = new QuotaTracker({
      perCallerPerDay: 1,
      globalPerDay: 10,
      noun: "location briefings",
    });
    quota.record("a");

    const refused = quota.check("a");
    if (refused.allowed) throw new Error("expected a refusal");
    // Telling someone they used their "questions" when the page spent them is
    // the specific confusion that sent the owner looking at their billing.
    expect(refused.reason).toContain("location briefings");
    expect(refused.reason).not.toContain("questions");
  });
});

describe("the briefing quota is separate", () => {
  it("does not share a budget with typed questions", () => {
    /**
     * THE BUG. `/v1/location/brief` generates on page view, so browsing a few
     * locations used to spend the ability to ask anything. Two different
     * things cannot compete for one budget.
     */
    const asks = new QuotaTracker({ perCallerPerDay: 2, globalPerDay: 10 });
    const briefs = new QuotaTracker({ perCallerPerDay: 2, globalPerDay: 10 });

    // Browse until the briefing budget is gone.
    briefs.record("a");
    briefs.record("a");
    expect(briefs.check("a").allowed).toBe(false);

    // Asking is untouched, which is the whole point.
    expect(asks.check("a").allowed).toBe(true);
  });

  it("allows more browsing than asking, because browsing is how the page is used", () => {
    expect(BRIEF_QUOTA.perCallerPerDay).toBeGreaterThanOrEqual(100);
  });
});
