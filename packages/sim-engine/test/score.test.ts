import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { scoreLocation, type ScoreInputs,
  catchmentPercentile,
} from "../src/score.js";
import type { CompetitorSummary } from "../src/competitors.js";
import { resolveRent } from "../src/rent.js";
import { DISTRICT_PRESETS } from "../src/presets/districts.js";

/**
 * A score out of 100 next to a break-even calculator will be read as a
 * forecast whatever the caption says, so these tests are mostly about the
 * claims it must refuse to make.
 */

const summary = (over: Partial<CompetitorSummary> = {}): CompetitorSummary => ({
  total: 4,
  averageRating: 4.0,
  ratedCount: 4,
  totalReviews: 800,
  nearestMetres: 120,
  operational: 4,
  ...over,
});

const demographics = (total = 600_000) => ({
  total,
  age: Object.fromEntries(
    ["15-19", "20-24", "25-29", "30-34", "35-39", "40-44", "45-49", "50-54", "55-59", "60-64"].map(
      (band) => [band, total * 0.07],
    ),
  ),
});

const inputs = (over: Partial<ScoreInputs> = {}): ScoreInputs => ({
  competitors: summary(),
  truncated: false,
  completeToMetres: null,
  radiusMetres: 500,
  demographics: demographics(),
  ...over,
});

const dimension = (result: ReturnType<typeof scoreLocation>, key: string) =>
  result.dimensions.find((d) => d.key === key)!;

describe("zero competitors is not a perfect location", () => {
  /**
   * The single most dangerous reading in the whole product. It must agree with
   * Opportunity Gap Detection, which already refuses to treat absence as
   * opportunity — otherwise two panels on one screen would contradict.
   */
  it("scores an empty area BELOW a location with a handful of competitors", () => {
    const empty = scoreLocation(inputs({ competitors: summary({ total: 0, totalReviews: 0, averageRating: null }) }));
    const healthy = scoreLocation(inputs());

    expect(dimension(empty, "competition").score).toBeLessThan(
      dimension(healthy, "competition").score,
    );
    expect(empty.overall).toBeLessThan(healthy.overall);
  });

  it("says plainly that empty means unproven, not open", () => {
    const empty = scoreLocation(inputs({ competitors: summary({ total: 0, totalReviews: 0, averageRating: null }) }));
    expect(dimension(empty, "competition").note).toMatch(/unproven/i);
  });
});

describe("the competition curve peaks rather than slopes", () => {
  it("rises then falls as competitors increase", () => {
    const at = (total: number) =>
      dimension(scoreLocation(inputs({ competitors: summary({ total }) })), "competition").score;

    expect(at(0)).toBeLessThan(at(2));
    expect(at(2)).toBeLessThan(at(4));
    expect(at(4)).toBeGreaterThan(at(8));
    expect(at(8)).toBeGreaterThan(at(12));
    expect(at(12)).toBeGreaterThan(at(30));
  });

  it("marks a capped count as a floor ONLY when it had to fall back to counting", () => {
    const noDensity = scoreLocation(inputs({ truncated: true, competitors: summary({ total: 20 }) }));
    expect(dimension(noDensity, "competition").isFloor).toBe(true);
  });

  it("does NOT call a density-scored result a floor — the cap is accounted for", () => {
    const withDensity = scoreLocation(
      inputs({ truncated: true, completeToMetres: 142, competitors: summary({ total: 20 }) }),
    );
    expect(dimension(withDensity, "competition").isFloor).toBeUndefined();
  });

  it("does not mark an uncapped count as a floor", () => {
    expect(dimension(scoreLocation(inputs()), "competition").isFloor).toBeUndefined();
  });
});

describe("a capped search scores on density, so cities still separate", () => {
  /**
   * Regression. Almost everywhere urban hits Places' 20-result cap at 500m, so
   * scoring on the raw count pinned the highest-weighted dimension at one
   * value everywhere: central KL and suburban PJ both came out ~42, which is
   * useless for the comparison this score exists to support. The radius at
   * which the quota ran out carries the density signal instead.
   */
  const capped = (completeToMetres: number) =>
    scoreLocation(
      inputs({ truncated: true, completeToMetres, competitors: summary({ total: 20 }) }),
    );

  it("separates a tight cluster from a spread-out one", () => {
    const tight = dimension(capped(142), "competition").score; // central KL
    const spread = dimension(capped(263), "competition").score; // suburban PJ

    expect(tight).toBeLessThan(spread);
    // Not a rounding-level difference — enough to move the overall score.
    expect(spread - tight).toBeGreaterThan(15);
  });

  it("moves the overall score, not just the component", () => {
    expect(capped(263).overall - capped(142).overall).toBeGreaterThan(4);
  });

  it("describes the density rather than just the count", () => {
    expect(dimension(capped(142), "competition").note).toMatch(/per km²/);
  });

  it("still scores on the count when the search was not capped", () => {
    const uncapped = scoreLocation(inputs({ competitors: summary({ total: 4 }) }));
    expect(dimension(uncapped, "competition").note).not.toMatch(/per km²/);
  });
});

describe("competitor quality points the documented way", () => {
  it("scores strong incumbents lower than weak ones", () => {
    const strong = scoreLocation(inputs({ competitors: summary({ averageRating: 4.7 }) }));
    const weak = scoreLocation(inputs({ competitors: summary({ averageRating: 3.2 }) }));

    expect(dimension(strong, "competitorQuality").score).toBeLessThan(
      dimension(weak, "competitorQuality").score,
    );
  });

  it("is unavailable rather than zero when nothing is rated", () => {
    const unrated = scoreLocation(inputs({ competitors: summary({ averageRating: null }) }));
    expect(dimension(unrated, "competitorQuality").kind).toBe("unavailable");
  });
});

describe("rent sensitivity — Feature 1e", () => {
  const KLCC = DISTRICT_PRESETS.klcc.centre;
  const KUANTAN = { lat: 3.8077, lng: 103.326 };

  /** Everything the rent dimension needs, resolved from a real benchmark. */
  const withRent = (point = KLCC, override?: { monthlyRent: number }) =>
    inputs({
      category: "korean_restaurant",
      point,
      rent: resolveRent(point, "korean_restaurant", override),
    });

  it("stays unavailable and unweighted where no benchmark covers the pin", () => {
    const rent = dimension(scoreLocation(withRent(KUANTAN)), "rent");
    expect(rent.kind).toBe("unavailable");
    expect(rent.weight).toBe(0);
    // Says what to do about it rather than just that data is missing.
    expect(rent.note).toMatch(/enter the rent you were quoted/i);
  });

  it("is also unavailable when the caller supplies no rent at all", () => {
    // Feature 1d callers that never pass rent must behave exactly as before.
    expect(dimension(scoreLocation(inputs()), "rent").kind).toBe("unavailable");
  });

  it("fills in as inferred from a benchmark, and counts", () => {
    const rent = dimension(scoreLocation(withRent()), "rent");
    expect(rent.kind).toBe("proxy");
    expect(rent.weight).toBeGreaterThan(0);
    expect(rent.note).toMatch(/break-even needs \d+\/day/i);
  });

  it("a quoted rent is measured, and outweighs the benchmark", () => {
    const inferred = dimension(scoreLocation(withRent()), "rent");
    const quoted = dimension(scoreLocation(withRent(KLCC, { monthlyRent: 9000 })), "rent");

    expect(quoted.kind).toBe("direct");
    expect(quoted.weight).toBeGreaterThan(inferred.weight);
    // RM9,000 beats the KLCC benchmark's RM18,000, so it must score better.
    expect(quoted.score).toBeGreaterThan(inferred.score);
  });

  it("a dearer location scores lower on rent and lower overall", () => {
    const cheap = scoreLocation(withRent(DISTRICT_PRESETS.cheras.centre));
    const dear = scoreLocation(withRent(KLCC));

    expect(dimension(dear, "rent").score).toBeLessThan(dimension(cheap, "rent").score);
    expect(dear.overall).toBeLessThan(cheap.overall);
  });

  it("does not drag the overall score down by counting as zero", () => {
    // A location perfect on every measurable axis must still be able to score
    // near 100 despite the missing axis.
    const excellent = scoreLocation(
      inputs({
        competitors: summary({ total: 4, totalReviews: 2000, averageRating: 3.0 }),
        demographics: demographics(1_200_000),
      }),
    );
    expect(excellent.overall).toBeGreaterThan(85);
  });

  /**
   * The regression that matters most about adding a fifth dimension: a
   * location with no rent data must score EXACTLY what it scored before
   * Feature 1e existed. If this drifts, every figure already published — and
   * every share link already sent — quietly changed meaning.
   */
  it("leaves a rent-less location scoring exactly as it did before 1e", () => {
    const before = scoreLocation(inputs());
    expect(dimension(before, "competition").weight).toBe(0.3);
    expect(dimension(before, "footfall").weight).toBe(0.3);
    expect(dimension(before, "catchment").weight).toBe(0.25);
    expect(dimension(before, "competitorQuality").weight).toBe(0.15);
  });

  it("keeps the other four in the same proportions once rent joins", () => {
    const after = scoreLocation(withRent());
    const competition = dimension(after, "competition").weight;
    const quality = dimension(after, "competitorQuality").weight;

    // 30:15 before, so still exactly 2:1 after.
    expect(competition / quality).toBeCloseTo(2, 6);
    expect(dimension(after, "rent").weight).toBeCloseTo(0.12 / 1.0, 4);
  });
});

describe("weights and completeness", () => {
  it("renormalises the available weights to 1", () => {
    const result = scoreLocation(inputs());
    const total = result.dimensions.reduce((sum, d) => sum + d.weight, 0);
    expect(total).toBeCloseTo(1, 2);
  });

  it("reports completeness below 1 while rent is missing", () => {
    expect(scoreLocation(inputs()).completeness).toBeLessThan(1);
  });

  it("drops completeness further when demographics are missing", () => {
    const withDemo = scoreLocation(inputs()).completeness;
    const without = scoreLocation(inputs({ demographics: null })).completeness;
    expect(without).toBeLessThan(withDemo);
  });

  it("degrades rather than throwing when everything is missing", () => {
    const nothing = scoreLocation({
      competitors: summary({ total: 0, totalReviews: 0, averageRating: null, ratedCount: 0, nearestMetres: null, operational: 0 }),
      truncated: false,
      completeToMetres: null,
      radiusMetres: 500,
      demographics: null,
    });
    expect(Number.isFinite(nothing.overall)).toBe(true);
    expect(nothing.overall).toBeGreaterThanOrEqual(0);
  });
});

describe("invariants", () => {
  it("never leaves 0–100 and never emits NaN, for any input", () => {
    fc.assert(
      fc.property(
        fc.record({
          total: fc.integer({ min: 0, max: 500 }),
          totalReviews: fc.integer({ min: 0, max: 500_000 }),
          averageRating: fc.oneof(fc.constant(null), fc.double({ min: 1, max: 5, noNaN: true })),
          truncated: fc.boolean(),
          population: fc.integer({ min: 0, max: 5_000_000 }),
          hasDemographics: fc.boolean(),
        }),
        (r) => {
          const result = scoreLocation({
            competitors: summary({
              total: r.total,
              totalReviews: r.totalReviews,
              averageRating: r.averageRating,
            }),
            truncated: r.truncated,
            completeToMetres: r.truncated ? 150 : null,
            radiusMetres: 500,
            demographics: r.hasDemographics ? demographics(r.population) : null,
          });

          expect(Number.isFinite(result.overall)).toBe(true);
          expect(result.overall).toBeGreaterThanOrEqual(0);
          expect(result.overall).toBeLessThanOrEqual(100);
          for (const d of result.dimensions) {
            expect(Number.isFinite(d.score)).toBe(true);
            expect(d.score).toBeGreaterThanOrEqual(0);
            expect(d.score).toBeLessThanOrEqual(100);
          }
        },
      ),
      { numRuns: 400 },
    );
  });
});

/**
 * The percentile scale, shared by the Success Score and the city heatmap.
 *
 * Extracted from measuredCatchmentScore so both can use it. These pin the
 * SHAPE of the scale; the golden scores elsewhere in this file pin that the
 * extraction changed no published number.
 */
describe("catchmentPercentile", () => {
  it("puts the measured median at the middle of the scale", () => {
    // 1,680 is the measured 50th percentile of a 500m catchment nationally.
    expect(catchmentPercentile(1_680, 500)).toBeCloseTo(0.5, 6);
  });

  it("runs from floor to ceiling", () => {
    expect(catchmentPercentile(0, 500)).toBeLessThanOrEqual(0.1);
    expect(catchmentPercentile(27_931, 500)).toBeCloseTo(1, 6);
    // Beyond the top decile it saturates rather than exceeding 1.
    expect(catchmentPercentile(500_000, 500)).toBe(1);
  });

  it("never goes backwards as the catchment grows", () => {
    let previous = -1;
    for (const people of [0, 100, 500, 1_000, 3_000, 6_500, 12_000, 30_000]) {
      const p = catchmentPercentile(people, 500);
      expect(p).toBeGreaterThanOrEqual(previous);
      previous = p;
    }
  });

  /**
   * A 1km catchment covers four times the area of a 500m one, so comparing it
   * raw against a 500m distribution would flatter every wide search.
   */
  it("normalises a different radius to its 500m equivalent", () => {
    expect(catchmentPercentile(4 * 1_680, 1_000)).toBeCloseTo(
      catchmentPercentile(1_680, 500),
      6,
    );
  });

  it("places central KL where the published score says it is", () => {
    // 6,457 residents within 500m — the figure quoted throughout the docs.
    expect(Math.round(catchmentPercentile(6_457, 500) * 100)).toBe(87);
  });
});
