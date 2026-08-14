import { describe, expect, it } from "vitest";
import { analyseOpportunity, type CategorySupply } from "../src/opportunity.js";
import type { BusinessCategory, CompetitorWithDistance } from "../src/index.js";

/**
 * The scoring is a recommendation an SME might act on with real money, so
 * these tests are mostly about what it must REFUSE to claim.
 */

let seq = 0;
const outlet = (reviewCount: number, rating: number | null = 4.2): CompetitorWithDistance => ({
  id: `o${seq++}`,
  name: `Outlet ${seq}`,
  lat: 3.15,
  lng: 101.71,
  rating,
  reviewCount,
  primaryType: "restaurant",
  priceLevel: null,
  businessStatus: "OPERATIONAL",
  distanceMetres: 100,
});

const supply = (
  category: BusinessCategory,
  reviewCounts: number[],
  truncated = false,
): CategorySupply => ({
  category,
  competitors: reviewCounts.map((r) => outlet(r)),
  truncated,
});

describe("the spec's worked example", () => {
  // "23 coffee shops (high demand), 3 Korean (high demand), 1 healthy food
  // (high demand)" -> the recommendation should point at the thinly-served
  // categories, not the crowded one.
  const analysis = analyseOpportunity([
    // Crowded: many outlets, trade spread thin.
    supply("cafe_coffee_shop", Array.from({ length: 20 }, () => 40), true),
    // Few outlets, each very busy — demand outrunning supply.
    supply("korean_restaurant", [900, 750, 800]),
    // Single outlet, heavily reviewed.
    supply("bubble_tea_dessert", [1200]),
    // Ordinary.
    supply("casual_dining", [120, 90, 140, 100, 80]),
  ]);

  it("does not pick the crowded category", () => {
    expect(analysis.topOpportunity?.category).not.toBe("cafe_coffee_shop");
  });

  it("marks the capped category saturated", () => {
    const cafe = analysis.ranked.find((r) => r.category === "cafe_coffee_shop");
    expect(cafe?.verdict).toBe("saturated");
  });

  it("ranks the busy, thinly-served categories above the ordinary one", () => {
    const order = analysis.ranked.map((r) => r.category);
    expect(order.indexOf("bubble_tea_dessert")).toBeLessThan(order.indexOf("casual_dining"));
    expect(order.indexOf("korean_restaurant")).toBeLessThan(order.indexOf("cafe_coffee_shop"));
  });
});

describe("zero outlets is never an opportunity", () => {
  // The most dangerous false positive in the feature: "no Korean restaurants
  // nearby" could mean untapped demand or that nobody wants one, and this data
  // cannot tell the difference.
  const analysis = analyseOpportunity([
    supply("korean_restaurant", []),
    supply("fast_casual_takeaway", []),
    supply("casual_dining", [300, 250]),
  ]);

  it("keeps empty categories out of the ranking entirely", () => {
    expect(analysis.ranked.map((r) => r.category)).toEqual(["casual_dining"]);
    expect(analysis.noPresence.map((r) => r.category).sort()).toEqual([
      "fast_casual_takeaway",
      "korean_restaurant",
    ]);
  });

  it("never makes an empty category the top opportunity", () => {
    expect(analysis.topOpportunity?.category).toBe("casual_dining");
    expect(analysis.noPresence.every((r) => r.verdict === "no-presence")).toBe(true);
  });

  it("scores empty categories zero rather than maximum", () => {
    expect(analysis.noPresence.every((r) => r.gapScore === 0)).toBe(true);
  });

  it("returns no top opportunity when every category is empty", () => {
    const empty = analyseOpportunity([
      supply("korean_restaurant", []),
      supply("cafe_coffee_shop", []),
    ]);
    expect(empty.topOpportunity).toBeNull();
    expect(empty.ranked).toEqual([]);
  });
});

describe("truncation", () => {
  it("reports a capped count as a minimum, not an exact figure", () => {
    const analysis = analyseOpportunity([
      supply("cafe_coffee_shop", Array.from({ length: 20 }, () => 100), true),
      supply("korean_restaurant", [500]),
    ]);
    const cafe = analysis.ranked.find((r) => r.category === "cafe_coffee_shop");

    expect(cafe?.outlets).toBe(20);
    expect(cafe?.outletsAreMinimum).toBe(true);
    // Treated as fully saturated: its real count is unknown and higher.
    expect(cafe?.saturationIndex).toBe(1);
    expect(cafe?.gapScore).toBe(0);
  });

  it("infers the minimum flag from the result count even without the flag", () => {
    const analysis = analyseOpportunity([
      supply("cafe_coffee_shop", Array.from({ length: 20 }, () => 10), false),
    ]);
    expect(analysis.ranked[0]?.outletsAreMinimum).toBe(true);
  });
});

describe("a crowded area has no opportunity, not a least-bad one", () => {
  /**
   * Central KL really does come back like this: every category capped at 20+
   * or nearly so. Crowning the least crowded of six crowded categories — while
   * the same row is labelled "saturated" — is a contradiction an SME could act
   * on with a lease.
   */
  it("returns no top opportunity when the best candidate is saturated", () => {
    const analysis = analyseOpportunity([
      supply("cafe_coffee_shop", Array.from({ length: 20 }, () => 700), true),
      supply("korean_restaurant", Array.from({ length: 20 }, () => 100), true),
      supply("casual_dining", Array.from({ length: 19 }, () => 500)),
    ]);

    expect(analysis.ranked.every((r) => r.verdict === "saturated")).toBe(true);
    expect(analysis.topOpportunity).toBeNull();
  });

  it("still recommends when a genuinely uncrowded category exists", () => {
    const analysis = analyseOpportunity([
      supply("cafe_coffee_shop", Array.from({ length: 20 }, () => 700), true),
      supply("korean_restaurant", [900, 850]),
    ]);

    expect(analysis.topOpportunity?.category).toBe("korean_restaurant");
    expect(analysis.topOpportunity?.verdict).not.toBe("saturated");
  });
});

describe("the busiest category is not penalised for being busiest", () => {
  /**
   * Regression. An earlier formulation normalised saturation against the
   * category with the most outlets, so that category always scored exactly
   * zero — which ranked a dead category above a thriving one purely because
   * the thriving one had one more outlet.
   */
  it("ranks five busy outlets above four dead ones", () => {
    const analysis = analyseOpportunity([
      supply("korean_restaurant", [1000, 1000, 1000, 1000, 1000]),
      supply("casual_dining", [10, 10, 10, 10]),
    ]);

    expect(analysis.topOpportunity?.category).toBe("korean_restaurant");
    expect(analysis.ranked[0]?.gapScore).toBeGreaterThan(analysis.ranked[1]!.gapScore);
  });

  it("gives a lone present category a real score rather than zero", () => {
    const analysis = analyseOpportunity([supply("casual_dining", [300, 250])]);
    expect(analysis.topOpportunity?.category).toBe("casual_dining");
    expect(analysis.ranked[0]?.gapScore).toBeGreaterThan(0);
  });
});

describe("metrics", () => {
  it("computes reviews per outlet as the demand proxy", () => {
    const analysis = analyseOpportunity([supply("korean_restaurant", [100, 200, 300])]);
    expect(analysis.ranked[0]?.reviewsPerOutlet).toBe(200);
    expect(analysis.ranked[0]?.totalReviews).toBe(600);
  });

  it("reports null reviews-per-outlet for an empty category, not zero", () => {
    const analysis = analyseOpportunity([supply("korean_restaurant", [])]);
    expect(analysis.noPresence[0]?.reviewsPerOutlet).toBeNull();
  });

  it("averages only rated outlets and reports null when none are rated", () => {
    const unrated: CategorySupply = {
      category: "korean_restaurant",
      competitors: [outlet(10, null), outlet(20, null)],
      truncated: false,
    };
    expect(analyseOpportunity([unrated]).ranked[0]?.averageRating).toBeNull();
  });

  it("scores relative to the other categories at this point", () => {
    // The busiest category anchors the demand index at 1.
    const analysis = analyseOpportunity([
      supply("korean_restaurant", [1000]),
      supply("casual_dining", [100]),
    ]);
    const korean = analysis.ranked.find((r) => r.category === "korean_restaurant");
    expect(korean?.demandIndex).toBe(1);
  });

  it("emits no NaN when every outlet has zero reviews", () => {
    const analysis = analyseOpportunity([
      supply("korean_restaurant", [0, 0]),
      supply("casual_dining", [0]),
    ]);
    for (const row of analysis.ranked) {
      expect(Number.isFinite(row.gapScore)).toBe(true);
      expect(Number.isFinite(row.demandIndex)).toBe(true);
    }
    // Nothing stands out, and saying so is better than inventing a winner.
    expect(analysis.topOpportunity).toBeNull();
  });

  it("handles a single category without dividing by zero", () => {
    const analysis = analyseOpportunity([supply("korean_restaurant", [500, 400])]);
    expect(analysis.ranked).toHaveLength(1);
    expect(Number.isFinite(analysis.ranked[0]!.gapScore)).toBe(true);
  });

  it("handles no input at all", () => {
    const analysis = analyseOpportunity([]);
    expect(analysis.ranked).toEqual([]);
    expect(analysis.noPresence).toEqual([]);
    expect(analysis.topOpportunity).toBeNull();
  });
});
