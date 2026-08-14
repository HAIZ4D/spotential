import { describe, expect, it } from "vitest";
import {
  CATEGORY_PLACE_TYPES,
  densityByBand,
  summarise,
  withDistance,
  withinRadius,
  type Competitor,
} from "../src/competitors.js";
import { bucketRadius, roundForCache, distanceMetres } from "../src/geo.js";
import { CATEGORY_PRESETS } from "../src/presets/categories.js";

const CENTRE = { lat: 3.1578, lng: 101.7117 };

/** Offset roughly n metres north of the centre. 1 degree lat ~ 111,320m. */
const north = (metres: number, over: Partial<Competitor> = {}): Competitor => ({
  id: `c-${metres}`,
  name: `Competitor ${metres}m`,
  lat: CENTRE.lat + metres / 111_320,
  lng: CENTRE.lng,
  rating: 4,
  reviewCount: 100,
  primaryType: "restaurant",
  priceLevel: null,
  businessStatus: "OPERATIONAL",
  ...over,
});

describe("withDistance", () => {
  it("annotates and sorts nearest first", () => {
    const result = withDistance([north(900), north(100), north(400)], CENTRE);
    expect(result.map((c) => c.distanceMetres)).toEqual([...result.map((c) => c.distanceMetres)].sort((a, b) => a - b));
    expect(result[0]?.distanceMetres).toBeLessThan(150);
  });

  it("agrees with the raw distance helper", () => {
    const [only] = withDistance([north(500)], CENTRE);
    expect(only?.distanceMetres).toBe(distanceMetres(CENTRE, { lat: only!.lat, lng: only!.lng }));
  });
});

describe("withinRadius", () => {
  it("excludes anything beyond the radius", () => {
    const result = withinRadius([north(100), north(600), north(1500)], CENTRE, 500);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("c-100");
  });

  it("is inclusive of the boundary", () => {
    // 500m north, filtered at 500m: rounding must not drop it.
    const result = withinRadius([north(499)], CENTRE, 500);
    expect(result).toHaveLength(1);
  });

  it("handles an empty list", () => {
    expect(withinRadius([], CENTRE, 1000)).toEqual([]);
  });
});

describe("densityByBand", () => {
  it("buckets without double counting", () => {
    const competitors = withDistance(
      [north(100), north(200), north(400), north(700), north(900), north(1400)],
      CENTRE,
    );
    const bands = densityByBand(competitors);

    expect(bands.map((b) => b.upToMetres)).toEqual([250, 500, 1000]);
    expect(bands.map((b) => b.count)).toEqual([2, 1, 2]);
    // The 1400m one falls outside every band, deliberately.
    expect(bands.reduce((acc, b) => acc + b.count, 0)).toBe(5);
  });

  it("returns zeroes rather than an empty array when nobody is nearby", () => {
    expect(densityByBand([]).map((b) => b.count)).toEqual([0, 0, 0]);
  });
});

describe("summarise", () => {
  it("averages only the rated competitors", () => {
    const competitors = withDistance(
      [
        north(100, { rating: 4.5, reviewCount: 200 }),
        north(200, { rating: 3.5, reviewCount: 100 }),
        north(300, { rating: null, reviewCount: 0 }),
      ],
      CENTRE,
    );
    const summary = summarise(competitors);

    expect(summary.total).toBe(3);
    expect(summary.ratedCount).toBe(2);
    expect(summary.averageRating).toBe(4);
    expect(summary.totalReviews).toBe(300);
  });

  it("reports null rather than zero when nothing is rated", () => {
    // Zero would read as "everyone here is terrible" rather than "no data".
    const competitors = withDistance([north(100, { rating: null, reviewCount: 0 })], CENTRE);
    expect(summarise(competitors).averageRating).toBeNull();
  });

  it("counts permanently closed places separately", () => {
    const competitors = withDistance(
      [north(100), north(200, { businessStatus: "CLOSED_PERMANENTLY" })],
      CENTRE,
    );
    const summary = summarise(competitors);
    expect(summary.total).toBe(2);
    expect(summary.operational).toBe(1);
  });

  it("is safe on an empty list", () => {
    expect(summarise([])).toEqual({
      total: 0,
      averageRating: null,
      ratedCount: 0,
      totalReviews: 0,
      nearestMetres: null,
      operational: 0,
    });
  });
});

describe("cache key normalisation", () => {
  it("rounds coordinates to about 110m so nearby clicks share a cache entry", () => {
    // These two points are ~20m apart and must collapse to one key.
    expect(roundForCache(3.157812)).toBe(roundForCache(3.157634));
    expect(roundForCache(3.1578)).toBe(3.158);
  });

  it("separates genuinely different areas", () => {
    expect(roundForCache(3.1578)).not.toBe(roundForCache(3.1708));
  });

  it("buckets radii so 500 and 520 are one entry", () => {
    expect(bucketRadius(500)).toBe(bucketRadius(480));
    expect(bucketRadius(501)).toBe(1000);
    expect(bucketRadius(1)).toBe(250);
    expect(bucketRadius(99_999)).toBe(2000);
  });
});

describe("category to Places type mapping", () => {
  it("covers every business category", () => {
    for (const id of Object.keys(CATEGORY_PRESETS)) {
      expect(CATEGORY_PLACE_TYPES[id as keyof typeof CATEGORY_PLACE_TYPES]?.length).toBeGreaterThan(0);
    }
  });
});
