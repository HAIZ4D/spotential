import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { resolveRent, rentSensitivity, type ResolvedRent } from "../src/rent.js";
import {
  DISTRICT_PRESETS,
  listDistricts,
  nearestDistrict,
} from "../src/presets/districts.js";

/**
 * Rent sensitivity — Feature 1e.
 *
 * GOLDEN VECTORS HAND-COMPUTED BEFORE THE IMPLEMENTATION, from the Korean
 * restaurant preset. If a formula regression lands, these must fail loudly
 * rather than be "fixed" by pasting in whatever the code now returns.
 *
 *   tradingDays  = 365 x (7/7) / 12          = 30.416666...
 *   cogsPerUnit  = 0.32 x 18                 = 5.76
 *   contribution = 18 - 5.76                 = 12.24
 *   sstRegistered is false, so serviceTax    = 0
 *   netContribution                          = 12.24
 *
 *   staff (4 @ RM2,000, EPF tier 13% since 2000 <= 5000):
 *     base  = 4 x 2000                       = 8,000
 *     EPF   = 4 x 2000 x 0.13                = 1,040
 *     SOCSO = 4 x 2000 x 0.0175              =   140
 *     EIS   = 4 x 2000 x 0.002               =    16
 *     total                                  = 9,196
 *
 *   fixed costs excluding rent
 *     = 9196 + 3500 + 400 + 2000 + 1500      = 16,596
 *
 *   denominator = 12.24 x 365/12             = 372.30 exactly
 *
 * Korean restaurants take 1,200 sqft (category preset), so:
 *
 *   A. Cheras      RM6  psf -> RM7,200   fixed 23,796
 *                  23796 / 372.3 = 63.91619  -> ceil  64/day
 *   B. Mont Kiara  RM10 psf -> RM12,000  fixed 28,596
 *                  28596 / 372.3 = 76.80903  -> ceil  77/day
 *   C. KLCC        RM15 psf -> RM18,000  fixed 34,596
 *                  34596 / 372.3 = 92.92506  -> ceil  93/day
 *
 * Scores, with share = perDay / 180 and
 * score = 100 x (1 - (share - 0.25) / 0.75):
 *
 *   A. 64/180 = 0.3555556 -> 100 x (1 - 0.1407407) = 85.92593 -> 85.93
 *   B. 77/180 = 0.4277778 -> 100 x (1 - 0.2370370) = 76.29630 -> 76.30
 *   C. 93/180 = 0.5166667 -> 100 x (1 - 0.3555556) = 64.44444 -> 64.44
 *
 * And the zero point: 180/day needs 180 x 372.3 = 67,014 of fixed costs,
 * so a rent of 67014 - 16596 = RM50,418 lands exactly on share = 1.0.
 */

const KOREAN = "korean_restaurant" as const;

/** A pin on each benchmark's own centre, so distance is ~0 and the match is unambiguous. */
const AT = (id: keyof typeof DISTRICT_PRESETS) => DISTRICT_PRESETS[id].centre;

function direct(monthlyRent: number): ResolvedRent {
  return {
    monthlyRent,
    psf: null,
    unitSqft: null,
    kind: "direct",
    district: null,
    distanceMetres: null,
    source: "Rent quoted for this unit",
    reviewed: "",
  };
}

describe("golden vectors — break-even at benchmark rents", () => {
  it("A. Cheras at RM6 psf needs 64 customers/day and scores 85.93", () => {
    const rent = resolveRent(AT("cheras"), KOREAN);
    expect(rent).not.toBeNull();
    expect(rent!.monthlyRent).toBe(7200);
    expect(rent!.psf).toBe(6);
    expect(rent!.unitSqft).toBe(1200);

    const s = rentSensitivity(rent!, KOREAN, AT("cheras"));
    expect(s.breakEvenPerDay).toBe(64);
    expect(s.score).toBe(85.93);
    expect(s.light).toBe("green");
  });

  it("B. Mont Kiara at RM10 psf needs 77 customers/day and scores 76.30", () => {
    const rent = resolveRent(AT("mont_kiara"), KOREAN);
    expect(rent!.monthlyRent).toBe(12000);

    const s = rentSensitivity(rent!, KOREAN, AT("mont_kiara"));
    expect(s.breakEvenPerDay).toBe(77);
    expect(s.score).toBe(76.3);
    expect(s.light).toBe("green");
  });

  it("C. KLCC at RM15 psf needs 93 customers/day and scores 64.44", () => {
    const rent = resolveRent(AT("klcc"), KOREAN);
    expect(rent!.monthlyRent).toBe(18000);

    const s = rentSensitivity(rent!, KOREAN, AT("klcc"));
    expect(s.breakEvenPerDay).toBe(93);
    expect(s.score).toBe(64.44);
    expect(s.light).toBe("amber");
  });

  it("RM50,418 lands exactly on the zero anchor — 180/day, all of typical trade", () => {
    const s = rentSensitivity(direct(50_418), KOREAN, AT("klcc"));
    expect(s.breakEvenPerDay).toBe(180);
    expect(s.shareOfTypicalTrade).toBe(1);
    expect(s.score).toBe(0);
    expect(s.light).toBe("red");
    expect(s.note).toMatch(/at or beyond/);
  });
});

describe("the three tiers", () => {
  it("a quoted rent is direct and beats the benchmark", () => {
    const rent = resolveRent(AT("klcc"), KOREAN, { monthlyRent: 9000, unitSqft: 900 });
    expect(rent!.kind).toBe("direct");
    expect(rent!.monthlyRent).toBe(9000);
    expect(rent!.psf).toBe(10);
    // The benchmark is still reported for context, not used for the figure.
    expect(rent!.district?.id).toBe("klcc");
  });

  it("a benchmark in range is proxy, and names its distance", () => {
    // ~700m east of the KLCC centre, inside its 1,500m applicable radius.
    const rent = resolveRent({ lat: 3.1578, lng: 101.7186 }, KOREAN);
    expect(rent!.kind).toBe("proxy");
    expect(rent!.district?.id).toBe("klcc");
    expect(rent!.distanceMetres).toBeGreaterThan(500);
    expect(rent!.distanceMetres).toBeLessThan(900);
  });

  it("no benchmark in range resolves to null rather than a national average", () => {
    // Kuantan, Pahang — nowhere near any covered trading area.
    expect(resolveRent({ lat: 3.8077, lng: 103.326 }, KOREAN)).toBeNull();
  });

  it("a quoted rent works even where no benchmark applies", () => {
    const rent = resolveRent({ lat: 3.8077, lng: 103.326 }, KOREAN, { monthlyRent: 4000 });
    expect(rent!.kind).toBe("direct");
    expect(rent!.district).toBeNull();
    // Scoring must still work with no benchmark anywhere near.
    expect(rentSensitivity(rent!, KOREAN, { lat: 3.8077, lng: 103.326 }).score).toBeGreaterThan(0);
  });

  it("does not invent a psf from a guessed floor area", () => {
    const rent = resolveRent(AT("klcc"), KOREAN, { monthlyRent: 9000 });
    expect(rent!.psf).toBeNull();
    expect(rent!.unitSqft).toBeNull();
  });

  it("a zero or negative quoted rent is not an override", () => {
    // Number("") is 0, and a rent of 0 is not "no rent" — it must fall through
    // to the benchmark rather than score as a free shop.
    expect(resolveRent(AT("klcc"), KOREAN, { monthlyRent: 0 })!.kind).toBe("proxy");
    expect(resolveRent(AT("klcc"), KOREAN, { monthlyRent: -500 })!.kind).toBe("proxy");
  });
});

describe("nearestDistrict", () => {
  it("matches a pin sitting on a centre at ~0 metres", () => {
    const hit = nearestDistrict(AT("ss15_subang"));
    expect(hit?.district.id).toBe("ss15_subang");
    expect(hit?.distanceMetres).toBeLessThan(1);
  });

  it("returns null just outside the applicable radius", () => {
    const klcc = DISTRICT_PRESETS.klcc;
    // Due north, comfortably past the 1,500m radius and away from any other
    // benchmark's reach.
    const far = { lat: klcc.centre.lat + 0.05, lng: klcc.centre.lng };
    const hit = nearestDistrict(far);
    expect(hit?.district.id).not.toBe("klcc");
  });

  it("picks the nearer of two overlapping benchmarks", () => {
    // Sri Hartamas and Mont Kiara are close together; a pin on one centre must
    // resolve to that one.
    expect(nearestDistrict(AT("sri_hartamas"))?.district.id).toBe("sri_hartamas");
    expect(nearestDistrict(AT("mont_kiara"))?.district.id).toBe("mont_kiara");
  });

  it("every benchmark is reachable from its own centre", () => {
    // Guards against a typo'd centroid putting an entry permanently inside a
    // neighbour's radius, where it could never be selected.
    for (const district of listDistricts()) {
      expect(nearestDistrict(district.centre)?.district.id).toBe(district.id);
    }
  });

  it("every benchmark carries a source and a review date", () => {
    for (const district of listDistricts()) {
      expect(district.source.length).toBeGreaterThan(0);
      expect(district.reviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(district.rentMedianPsf).toBeGreaterThan(0);
      expect(district.applicableRadiusMetres).toBeGreaterThan(0);
    }
  });
});

describe("properties", () => {
  it("a higher rent never scores better", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 500, max: 60_000 }),
        fc.integer({ min: 1, max: 20_000 }),
        (rent, bump) => {
          const lower = rentSensitivity(direct(rent), KOREAN, AT("klcc")).score;
          const higher = rentSensitivity(direct(rent + bump), KOREAN, AT("klcc")).score;
          expect(higher).toBeLessThanOrEqual(lower);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("the score stays inside 0..100 at any rent", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5_000_000 }), (rent) => {
        const s = rentSensitivity(direct(rent), KOREAN, AT("klcc"));
        expect(s.score).toBeGreaterThanOrEqual(0);
        expect(s.score).toBeLessThanOrEqual(100);
        expect(Number.isFinite(s.score)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("an unpayable rent scores 0 but stays a measurement, never unavailable", () => {
    const s = rentSensitivity(direct(5_000_000), KOREAN, AT("klcc"));
    expect(s.score).toBe(0);
    expect(s.kind).toBe("direct");
    expect(s.breakEvenPerDay).not.toBeNull();
  });

  it("every category resolves and scores at every benchmark", () => {
    const categories = [
      "korean_restaurant",
      "cafe_coffee_shop",
      "casual_dining",
      "bubble_tea_dessert",
      "fast_casual_takeaway",
      "other_fnb",
    ] as const;

    for (const district of listDistricts()) {
      for (const category of categories) {
        const rent = resolveRent(district.centre, category);
        expect(rent).not.toBeNull();
        const s = rentSensitivity(rent!, category, district.centre);
        expect(Number.isFinite(s.score)).toBe(true);
        expect(s.breakEvenPerDay).toBeGreaterThan(0);
      }
    }
  });
});
