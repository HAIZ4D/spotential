import { describe, expect, it } from "vitest";
import { matchInsight } from "../src/events/insight.js";
import type { EventScore } from "../src/events/score.js";
import type { ScoreDimension } from "../src/score.js";

/**
 * The "why this event?" sentence.
 *
 * It is derived rather than generated precisely so it can never disagree with
 * the figures printed beside it, and these tests are mostly about that: the
 * sentence has to name the dimension the engine actually credits, not the one
 * with the biggest raw number.
 */

const dim = (
  key: string,
  label: string,
  score: number,
  weight: number,
  kind: ScoreDimension["kind"] = "direct",
): ScoreDimension => ({ key, label, score, kind, weight, note: "" });

const build = (dimensions: ScoreDimension[], overall: number): EventScore => ({
  overall,
  dimensions,
  completeness: 1,
  entryPriceRm: 500,
});

describe("it credits contribution, not the biggest number", () => {
  it("names the heavily-weighted axis over a perfect but trivial one", () => {
    /**
     * Expected draw scores 100 but carries 0.08; category fit scores 80 on
     * 0.28. The second is what is carrying the match — 22.4 against 8 — so
     * ranking on raw score alone would keep crediting the axis the engine
     * trusts least.
     */
    const insight = matchInsight(
      build(
        [
          dim("visitorDraw", "Expected draw", 100, 0.08, "proxy"),
          dim("categoryFit", "Category fit", 80, 0.28),
        ],
        84,
      ),
    );

    expect(insight.strength?.key).toBe("categoryFit");
    expect(insight.headline).toMatch(/recruiting exactly what you sell/);
  });

  it("names the shortfall that costs the most, not the lowest score", () => {
    // Travel at 10 on 0.12 loses 10.8; affordability at 30 on 0.24 loses 16.8.
    const insight = matchInsight(
      build(
        [
          dim("travel", "Travel", 10, 0.12),
          dim("boothAffordability", "Booth affordability", 30, 0.24),
          dim("categoryFit", "Category fit", 90, 0.28),
        ],
        58,
      ),
    );

    expect(insight.drag?.key).toBe("boothAffordability");
    expect(insight.headline).toMatch(/expensive relative to your budget/);
  });
});

describe("it says both halves when there are two", () => {
  it("praises and warns in one sentence", () => {
    const insight = matchInsight(
      build(
        [
          dim("categoryFit", "Category fit", 100, 0.28),
          dim("boothAffordability", "Booth affordability", 20, 0.24),
        ],
        63,
      ),
    );

    expect(insight.headline).toMatch(/Strong on/);
    expect(insight.headline).toMatch(/but/);
  });

  it("praises alone when nothing is notably weak", () => {
    const insight = matchInsight(
      build(
        [
          dim("categoryFit", "Category fit", 95, 0.28),
          dim("vendorCompetition", "Stall competition", 80, 0.18),
        ],
        89,
      ),
    );

    expect(insight.drag).toBeNull();
    expect(insight.headline).toMatch(/^A good fit/);
  });
});

describe("it refuses to invent a reason", () => {
  it("says so when no dimension could be scored", () => {
    const insight = matchInsight(
      build([dim("categoryFit", "Category fit", 0, 0, "unavailable")], 0),
    );

    expect(insight.strength).toBeNull();
    expect(insight.headline).toMatch(/Not enough is known/);
  });

  it("does not claim a strength when everything is mediocre", () => {
    const insight = matchInsight(
      build(
        [
          dim("categoryFit", "Category fit", 50, 0.28),
          dim("travel", "Travel", 52, 0.12),
        ],
        50,
      ),
    );

    expect(insight.headline).toMatch(/middling|closer look/i);
  });
});

describe("tone tracks the overall score", () => {
  it.each([
    [85, "strong"],
    [55, "mixed"],
    [20, "weak"],
  ])("scores %i as %s", (overall, tone) => {
    const insight = matchInsight(build([dim("categoryFit", "Category fit", overall, 0.28)], overall));
    expect(insight.tone).toBe(tone);
  });
});
