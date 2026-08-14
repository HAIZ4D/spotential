import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCATION,
  distanceMetres,
  formatLatLng,
  isInMalaysia,
  isValidLatLng,
  locationSearchParams,
  parseLocationFromSearch,
  parseRentFromSearch,
} from "../src/lib/location.js";

describe("parseLocationFromSearch", () => {
  it("reads a well-formed link", () => {
    const result = parseLocationFromSearch("?lat=3.1707&lng=101.6505&q=Mont%20Kiara");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.location).toEqual({ lat: 3.1707, lng: 101.6505, label: "Mont Kiara" });
    expect(result.outsideMalaysia).toBe(false);
  });

  it("falls back to coordinates when there is no label", () => {
    const result = parseLocationFromSearch("?lat=3.1707&lng=101.6505");
    expect(result.ok && result.location.label).toBe("3.17070, 101.65050");
  });

  it("reports an empty search rather than throwing", () => {
    expect(parseLocationFromSearch("").ok).toBe(false);
    expect(parseLocationFromSearch("?s=somethingelse").ok).toBe(false);
  });

  it("rejects a half-specified location", () => {
    expect(parseLocationFromSearch("?lat=3.17").ok).toBe(false);
    expect(parseLocationFromSearch("?lng=101.65").ok).toBe(false);
  });

  it("rejects empty coordinates rather than treating them as zero", () => {
    // Number("") is 0, which would silently drop you in the Gulf of Guinea.
    const result = parseLocationFromSearch("?lat=&lng=");
    expect(result.ok).toBe(false);
  });

  it("rejects junk and out-of-range coordinates", () => {
    for (const search of [
      "?lat=abc&lng=101.65",
      "?lat=3.17&lng=NaN",
      "?lat=200&lng=101.65",
      "?lat=3.17&lng=999",
      "?lat=Infinity&lng=101.65",
    ]) {
      expect(parseLocationFromSearch(search).ok, search).toBe(false);
    }
  });

  it("accepts a valid point well outside the region but flags it", () => {
    // Jakarta. Valid coordinates, just nowhere our presets apply.
    const result = parseLocationFromSearch("?lat=-6.2088&lng=106.8456");
    expect(result.ok).toBe(true);
    expect(result.ok && result.outsideMalaysia).toBe(true);
  });

  it("round-trips through locationSearchParams", () => {
    const original = { lat: 3.170712, lng: 101.650531, label: "Some shoplot, Mont Kiara" };
    const parsed = parseLocationFromSearch(`?${locationSearchParams(original).toString()}`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.location.lat).toBeCloseTo(original.lat, 6);
    expect(parsed.location.lng).toBeCloseTo(original.lng, 6);
    expect(parsed.location.label).toBe(original.label);
  });

  it("survives a label containing characters that need escaping", () => {
    const original = { lat: 3.17, lng: 101.65, label: "Lot 5, Jalan Ampang & Co #12" };
    const parsed = parseLocationFromSearch(`?${locationSearchParams(original).toString()}`);
    expect(parsed.ok && parsed.location.label).toBe(original.label);
  });
});

describe("validation helpers", () => {
  it("isValidLatLng rejects anything that is not a finite pair", () => {
    expect(isValidLatLng({ lat: 3, lng: 101 })).toBe(true);
    for (const bad of [null, undefined, {}, { lat: 3 }, { lat: "3", lng: 101 }, { lat: Number.NaN, lng: 1 }]) {
      expect(isValidLatLng(bad)).toBe(false);
    }
  });

  it("isInMalaysia covers the peninsula and Borneo", () => {
    expect(isInMalaysia({ lat: 3.1578, lng: 101.7117 })).toBe(true); // KL
    expect(isInMalaysia({ lat: 5.9749, lng: 116.0724 })).toBe(true); // Kota Kinabalu
    expect(isInMalaysia({ lat: 1.4927, lng: 103.7414 })).toBe(true); // Johor Bahru
    expect(isInMalaysia({ lat: 51.5072, lng: -0.1276 })).toBe(false); // London
    expect(isInMalaysia({ lat: -6.2088, lng: 106.8456 })).toBe(false); // Jakarta
  });

  it("is a bounding box, so neighbours inside the box are not excluded", () => {
    // Singapore and southern Thailand fall inside any box drawn around
    // Malaysia — the country wraps around them. That is fine: this check
    // exists to catch corrupted links, not to police borders.
    expect(isInMalaysia({ lat: 1.3521, lng: 103.8198 })).toBe(true);
  });

  it("the default location is itself valid and in Malaysia", () => {
    expect(isValidLatLng(DEFAULT_LOCATION)).toBe(true);
    expect(isInMalaysia(DEFAULT_LOCATION)).toBe(true);
  });
});

describe("distanceMetres", () => {
  it("is zero for the same point", () => {
    expect(distanceMetres(DEFAULT_LOCATION, DEFAULT_LOCATION)).toBe(0);
  });

  it("matches a known distance", () => {
    // KLCC to Mont Kiara is roughly 6km.
    const metres = distanceMetres({ lat: 3.1578, lng: 101.7117 }, { lat: 3.1707, lng: 101.6505 });
    expect(metres).toBeGreaterThan(6_000);
    expect(metres).toBeLessThan(7_500);
  });

  it("is symmetric", () => {
    const a = { lat: 3.1578, lng: 101.7117 };
    const b = { lat: 5.9749, lng: 116.0724 };
    expect(distanceMetres(a, b)).toBe(distanceMetres(b, a));
  });
});

describe("formatLatLng", () => {
  it("renders five decimals", () => {
    expect(formatLatLng({ lat: 3.1, lng: 101 })).toBe("3.10000, 101.00000");
  });
});

describe("parseRentFromSearch — Feature 1e", () => {
  it("reads a quoted rent and unit size", () => {
    expect(parseRentFromSearch("?lat=3.1&lng=101.6&rent=9000&sqft=1100")).toEqual({
      monthlyRent: 9000,
      unitSqft: 1100,
    });
  });

  it("is absent when the link carries no rent", () => {
    expect(parseRentFromSearch("?lat=3.1&lng=101.6")).toEqual({
      monthlyRent: null,
      unitSqft: null,
    });
  });

  /**
   * The Null Island lesson, applied to money.
   *
   * Number("") is 0. A rent of 0 is not "no rent" — it is a shop with no rent
   * to pay, which would score as a free unit and top the rent dimension. Empty
   * and zero must both mean "not supplied" and fall back to the benchmark.
   */
  it("treats empty, zero and negative as not supplied", () => {
    for (const raw of ["", "0", "-500", "abc", "NaN"]) {
      expect(parseRentFromSearch(`?rent=${raw}&sqft=${raw}`)).toEqual({
        monthlyRent: null,
        unitSqft: null,
      });
    }
  });

  it("round-trips through locationSearchParams", () => {
    const params = locationSearchParams(DEFAULT_LOCATION, { monthlyRent: 9000, unitSqft: 1100 });
    expect(parseRentFromSearch(`?${params.toString()}`)).toEqual({
      monthlyRent: 9000,
      unitSqft: 1100,
    });
  });

  it("omits the rent params entirely when there is nothing to carry", () => {
    const params = locationSearchParams(DEFAULT_LOCATION, { monthlyRent: null, unitSqft: null });
    expect(params.has("rent")).toBe(false);
    expect(params.has("sqft")).toBe(false);
  });
});
