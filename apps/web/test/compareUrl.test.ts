import { describe, expect, it } from "vitest";
import {
  MAX_COMPARED,
  comparisonSearchParams,
  parseComparisonFromSearch,
} from "../src/lib/compareUrl.js";

/**
 * The URL is the only storage, so a link that loses or corrupts a location
 * loses the user's work. It is also untrusted input.
 */

describe("parsing", () => {
  it("reads a two-location comparison", () => {
    const { state, dropped } = parseComparisonFromSearch(
      "?c=cafe_coffee_shop&r=1000&p=3.1478,101.6953,Central KL&p=3.0738,101.5183,Suburban PJ",
    );

    expect(dropped).toBe(0);
    expect(state.category).toBe("cafe_coffee_shop");
    expect(state.radiusMetres).toBe(1000);
    expect(state.locations.map((l) => l.label)).toEqual(["Central KL", "Suburban PJ"]);
    expect(state.locations[0]?.lat).toBeCloseTo(3.1478, 4);
  });

  it("keeps a label that contains commas", () => {
    const { state } = parseComparisonFromSearch("?p=3.15,101.71,Lot 5, Jalan Ampang, KL");
    expect(state.locations[0]?.label).toBe("Lot 5, Jalan Ampang, KL");
  });

  it("falls back to a coordinate label when none is given", () => {
    const { state } = parseComparisonFromSearch("?p=3.15,101.71");
    expect(state.locations[0]?.label).toBe("3.1500, 101.7100");
  });

  it("drops one bad entry without losing the good ones", () => {
    const { state, dropped } = parseComparisonFromSearch(
      "?p=3.1478,101.6953,Good&p=999,101.71,Impossible&p=3.0738,101.5183,Also good",
    );

    expect(dropped).toBe(1);
    expect(state.locations.map((l) => l.label)).toEqual(["Good", "Also good"]);
  });

  it("rejects junk coordinates rather than treating them as zero", () => {
    const { state, dropped } = parseComparisonFromSearch("?p=abc,def,Nowhere&p=,,Empty");
    expect(state.locations).toHaveLength(0);
    expect(dropped).toBe(2);
  });

  it("caps the number of locations", () => {
    const many = Array.from({ length: 6 }, (_, i) => `p=3.1${i},101.7${i},L${i}`).join("&");
    const { state, dropped } = parseComparisonFromSearch(`?${many}`);

    expect(state.locations).toHaveLength(MAX_COMPARED);
    expect(dropped).toBe(6 - MAX_COMPARED);
  });

  it("falls back to defaults for an unknown category or radius", () => {
    const { state } = parseComparisonFromSearch("?c=nuclear_reactor&r=99999&p=3.15,101.71,X");
    expect(state.category).toBe("korean_restaurant");
    expect(state.radiusMetres).toBe(500);
  });

  it("handles an empty search", () => {
    const { state, dropped } = parseComparisonFromSearch("");
    expect(state.locations).toEqual([]);
    expect(dropped).toBe(0);
  });
});

describe("round-trip", () => {
  it("survives encode then decode with the category and radius intact", () => {
    const original = {
      category: "bubble_tea_dessert" as const,
      radiusMetres: 250,
      locations: [
        { lat: 3.147812, lng: 101.695312, label: "Central KL" },
        { lat: 3.073845, lng: 101.518311, label: "Shah Alam, Selangor" },
      ],
    };

    const { state } = parseComparisonFromSearch(`?${comparisonSearchParams(original).toString()}`);

    expect(state.category).toBe(original.category);
    expect(state.radiusMetres).toBe(original.radiusMetres);
    expect(state.locations).toHaveLength(2);
    expect(state.locations[0]?.lat).toBeCloseTo(original.locations[0]!.lat, 6);
    expect(state.locations[1]?.label).toBe("Shah Alam, Selangor");
  });

  it("never encodes more than the cap", () => {
    const params = comparisonSearchParams({
      category: "other_fnb",
      radiusMetres: 500,
      locations: Array.from({ length: 5 }, (_, i) => ({ lat: 3.1, lng: 101.7, label: `L${i}` })),
    });
    expect(params.getAll("p")).toHaveLength(MAX_COMPARED);
  });
});

/**
 * Per-location rent — Feature 1e.
 *
 * Rent is the one thing that IS legitimately per location: it measures a
 * specific unit rather than setting the search, so unlike category and radius
 * it cannot make two sites incommensurable.
 */
describe("rent overrides", () => {
  const TWO = "?c=korean_restaurant&r=500&p=3.1478,101.6953,KL&p=3.0738,101.5183,PJ";

  it("reads a rent for each location", () => {
    const { state } = parseComparisonFromSearch(`${TWO}&pr=9000&pr=5000`);
    expect(state.rents).toEqual([9000, 5000]);
  });

  it("is all nulls when the link carries none", () => {
    expect(parseComparisonFromSearch(TWO).state.rents).toEqual([null, null]);
  });

  it("treats empty, zero and negative as not supplied", () => {
    // Number("") is 0 and a rent of 0 would score as a free shop.
    const { state } = parseComparisonFromSearch(`${TWO}&pr=&pr=0`);
    expect(state.rents).toEqual([null, null]);
  });

  it("lets one location have a rent and the other not", () => {
    const { state } = parseComparisonFromSearch(`${TWO}&pr=&pr=5000`);
    expect(state.rents).toEqual([null, 5000]);
  });

  /**
   * The alignment trap: a malformed location is dropped, but the rents are
   * positional. Aligning them to the SURVIVING index would silently move every
   * later rent onto the wrong site — a wrong number attached to a real place,
   * which is worse than no number at all.
   */
  it("keeps rents on the right site when an earlier location is dropped", () => {
    const { state, dropped } = parseComparisonFromSearch(
      "?c=korean_restaurant&r=500&p=999,101,Broken&p=3.0738,101.5183,PJ&pr=9000&pr=5000",
    );

    expect(dropped).toBe(1);
    expect(state.locations).toHaveLength(1);
    expect(state.locations[0]?.label).toBe("PJ");
    // 5000 belongs to PJ. Off-by-one would hand it 9000.
    expect(state.rents).toEqual([5000]);
  });

  it("round-trips", () => {
    const original = {
      category: "korean_restaurant" as const,
      radiusMetres: 500,
      locations: [
        { lat: 3.147812, lng: 101.695312, label: "KL" },
        { lat: 3.073845, lng: 101.518311, label: "PJ" },
      ],
      rents: [9000, null],
    };

    const { state } = parseComparisonFromSearch(`?${comparisonSearchParams(original).toString()}`);
    expect(state.rents).toEqual([9000, null]);
  });

  it("emits no pr params at all when no location has a rent", () => {
    const params = comparisonSearchParams({
      category: "korean_restaurant",
      radiusMetres: 500,
      locations: [{ lat: 3.1, lng: 101.7, label: "KL" }],
      rents: [null],
    });
    expect(params.getAll("pr")).toHaveLength(0);
  });

  it("emits a pr slot for every location once any has a rent", () => {
    // Otherwise the positions would not survive the round trip.
    const params = comparisonSearchParams({
      category: "korean_restaurant",
      radiusMetres: 500,
      locations: [
        { lat: 3.1, lng: 101.7, label: "KL" },
        { lat: 3.0, lng: 101.5, label: "PJ" },
      ],
      rents: [null, 5000],
    });
    expect(params.getAll("pr")).toEqual(["", "5000"]);
  });
});
