import { describe, expect, it } from "vitest";
import { describeOp } from "../src/components/AskPanel.js";

/**
 * The patch chips on the what-if console.
 *
 * They exist so a reader can check what the model actually did: it returns
 * operations on parameters and never a figure, and the chips are what makes
 * that claim falsifiable instead of a promise.
 *
 * Which is why the first version was worse than no chip at all. It guessed the
 * vocabulary as "multiply" and "increment"; the engine's is
 * `set | mul | add | pct_delta`, so every operation fell through to the default
 * branch and a real 15% rent rise rendered as "Monthly rent set to 1" — the
 * 1.15 rounded to a whole number on the way out. It described the one thing it
 * was there to describe, wrongly.
 */

describe("describeOp", () => {
  it("names a multiplier as the percentage a reader asked for", () => {
    // "what if rent goes up 15%?" arrives as mul 1.15.
    expect(describeOp("mul", 1.15)).toBe("+15%");
    expect(describeOp("mul", 0.8)).toBe("−20%");
  });

  it("says unchanged rather than +0% for a no-op multiplier", () => {
    expect(describeOp("mul", 1)).toBe("unchanged");
  });

  it("keeps a decimal that a whole-number formatter would destroy", () => {
    // `formatNumber` rounds, which is right for money on a dashboard and wrong
    // for a price of RM18.50 or a 1.15 multiplier.
    expect(describeOp("set", 18.5)).toBe("set to 18.5");
    expect(describeOp("add", 0.5)).toBe("+0.5");
  });

  it("formats whole numbers with separators", () => {
    expect(describeOp("set", 13800)).toBe("set to 13,800");
  });

  it("signs additions and percentage deltas in both directions", () => {
    expect(describeOp("add", 2)).toBe("+2");
    expect(describeOp("add", -3)).toBe("−3");
    expect(describeOp("pct_delta", 15)).toBe("+15%");
    expect(describeOp("pct_delta", -20)).toBe("−20%");
  });

  it("never falls through to a default branch", () => {
    // Typed to `PatchOp`, so a new operation breaks the build rather than
    // quietly printing nonsense. This asserts the four that exist all resolve.
    for (const [op, value] of [
      ["set", 1],
      ["mul", 1.5],
      ["add", 1],
      ["pct_delta", 10],
    ] as const) {
      expect(describeOp(op, value)).not.toContain("undefined");
      expect(describeOp(op, value).length).toBeGreaterThan(0);
    }
  });
});
