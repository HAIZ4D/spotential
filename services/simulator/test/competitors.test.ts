import { afterAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { findCompetitors } from "../src/competitors/service.js";
import {
  CACHE_TTL_MS,
  InMemoryCompetitorStore,
  cacheKey,
  isFresh,
} from "../src/competitors/store.js";
import { QuotaTracker } from "../src/quota.js";
import type { Competitor } from "@spotential/sim-engine";

/**
 * The cache is a cost control, so these tests are really about money: they
 * assert that Places is called as rarely as possible and never twice for the
 * same area. No test here makes a real Places call.
 */

const CENTRE = { lat: 3.1578, lng: 101.7117 };

const place = (id: string, metresNorth: number, over: Partial<Competitor> = {}): Competitor => ({
  id,
  name: `Place ${id}`,
  lat: CENTRE.lat + metresNorth / 111_320,
  lng: CENTRE.lng,
  rating: 4.2,
  reviewCount: 50,
  primaryType: "restaurant",
  priceLevel: null,
  businessStatus: "OPERATIONAL",
  ...over,
});

describe("cache keys", () => {
  it("collapses nearby points onto one key", () => {
    // ~20m apart. Two clicks here must not bill Places twice.
    const a = cacheKey({ lat: 3.157812, lng: 101.711712 }, 500, "korean_restaurant");
    const b = cacheKey({ lat: 3.157634, lng: 101.711589 }, 500, "korean_restaurant");
    expect(a).toBe(b);
  });

  it("separates different categories and genuinely different areas", () => {
    const base = cacheKey(CENTRE, 500, "korean_restaurant");
    expect(base).not.toBe(cacheKey(CENTRE, 500, "cafe_coffee_shop"));
    expect(base).not.toBe(cacheKey({ lat: 3.1708, lng: 101.6505 }, 500, "korean_restaurant"));
  });

  it("buckets radii so 480 and 500 share an entry", () => {
    expect(cacheKey(CENTRE, 480, "other_fnb")).toBe(cacheKey(CENTRE, 500, "other_fnb"));
  });
});

describe("freshness", () => {
  const search = {
    key: "k",
    centre: CENTRE,
    radiusMetres: 500,
    category: "other_fnb" as const,
    competitors: [],
    fetchedAt: Date.now(),
    truncated: false,
  };

  it("is fresh inside the TTL and stale beyond it", () => {
    expect(isFresh(search)).toBe(true);
    expect(isFresh(search, Date.now() + CACHE_TTL_MS + 1)).toBe(false);
  });
});

describe("findCompetitors", () => {
  it("fetches on a miss and serves the cache afterwards", async () => {
    const store = new InMemoryCompetitorStore();
    const fetchPlaces = vi.fn(async () => [place("a", 100), place("b", 400)]);

    const first = await findCompetitors(store, fetchPlaces, CENTRE, 500, "other_fnb");
    expect(first.fromCache).toBe(false);
    expect(fetchPlaces).toHaveBeenCalledTimes(1);
    expect(first.competitors).toHaveLength(2);

    const second = await findCompetitors(store, fetchPlaces, CENTRE, 500, "other_fnb");
    expect(second.fromCache).toBe(true);
    // The whole point: still one call.
    expect(fetchPlaces).toHaveBeenCalledTimes(1);
  });

  it("serves a nearby click from the same cache entry", async () => {
    const store = new InMemoryCompetitorStore();
    const fetchPlaces = vi.fn(async () => [place("a", 100)]);

    await findCompetitors(store, fetchPlaces, CENTRE, 500, "other_fnb");
    const nudged = { lat: CENTRE.lat + 0.0001, lng: CENTRE.lng + 0.0001 };
    const second = await findCompetitors(store, fetchPlaces, nudged, 500, "other_fnb");

    expect(second.fromCache).toBe(true);
    expect(fetchPlaces).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(1);
  });

  it("filters the cached set to the requested radius", async () => {
    const store = new InMemoryCompetitorStore();
    // One search at the bucketed radius serves tighter requests for free.
    const fetchPlaces = vi.fn(async () => [place("near", 100), place("far", 800)]);

    await findCompetitors(store, fetchPlaces, CENTRE, 1000, "other_fnb");
    const tighter = await findCompetitors(store, fetchPlaces, CENTRE, 250, "other_fnb");

    expect(tighter.competitors.map((c) => c.id)).toEqual(["near"]);
    expect(fetchPlaces).toHaveBeenCalledTimes(1);
  });

  it("computes summary and density from the filtered set", async () => {
    const store = new InMemoryCompetitorStore();
    const fetchPlaces = async () => [
      place("a", 100, { rating: 5, reviewCount: 10 }),
      place("b", 300, { rating: 3, reviewCount: 20 }),
      place("c", 900, { rating: null, reviewCount: 0 }),
    ];

    const result = await findCompetitors(store, fetchPlaces, CENTRE, 1000, "other_fnb");
    expect(result.summary.total).toBe(3);
    expect(result.summary.averageRating).toBe(4);
    expect(result.summary.totalReviews).toBe(30);
    expect(result.density.map((b) => b.count)).toEqual([1, 1, 1]);
  });

  it("reports how far a truncated result set is actually complete", async () => {
    // Without this the UI would show "0 competitors in 250-500m" for an area
    // so dense the quota ran out at 145m — reading a limit as a finding.
    const store = new InMemoryCompetitorStore();
    const twenty = Array.from({ length: 20 }, (_, i) => place(`p${i}`, 50 + i * 5));
    const result = await findCompetitors(store, async () => twenty, CENTRE, 500, "other_fnb");

    expect(result.truncated).toBe(true);
    expect(result.completeToMetres).toBeGreaterThan(140);
    expect(result.completeToMetres).toBeLessThan(150);
  });

  it("reports no truncation when the result set is complete", async () => {
    const store = new InMemoryCompetitorStore();
    const result = await findCompetitors(
      store,
      async () => [place("a", 100), place("b", 200)],
      CENTRE,
      500,
      "other_fnb",
    );

    expect(result.truncated).toBe(false);
    expect(result.completeToMetres).toBeNull();
  });

  it("will NOT narrow a truncated wide search", async () => {
    // Places caps at 20 results ranked by distance, so a capped 1km search
    // stops at some distance short of 1km. Reusing it for a 500m request
    // would look fine and silently under-report. It must fetch again.
    const store = new InMemoryCompetitorStore();
    const twenty = Array.from({ length: 20 }, (_, i) => place(`p${i}`, 50 + i * 5));
    const fetchPlaces = vi.fn(async () => twenty);

    await findCompetitors(store, fetchPlaces, CENTRE, 1000, "other_fnb");
    const narrower = await findCompetitors(store, fetchPlaces, CENTRE, 500, "other_fnb");

    expect(fetchPlaces).toHaveBeenCalledTimes(2);
    expect(narrower.fromCache).toBe(false);
  });

  it("still reuses the exact same bucket even when truncated", async () => {
    // Truncation only makes NARROWING unsafe. The identical search is fine.
    const store = new InMemoryCompetitorStore();
    const twenty = Array.from({ length: 20 }, (_, i) => place(`p${i}`, 50 + i * 5));
    const fetchPlaces = vi.fn(async () => twenty);

    await findCompetitors(store, fetchPlaces, CENTRE, 1000, "other_fnb");
    const again = await findCompetitors(store, fetchPlaces, CENTRE, 1000, "other_fnb");

    expect(fetchPlaces).toHaveBeenCalledTimes(1);
    expect(again.fromCache).toBe(true);
  });

  it("refuses to spend when allowFetch is false", async () => {
    const store = new InMemoryCompetitorStore();
    const fetchPlaces = vi.fn(async () => [place("a", 100)]);

    const result = await findCompetitors(store, fetchPlaces, CENTRE, 500, "other_fnb", {
      allowFetch: false,
    });

    expect(fetchPlaces).not.toHaveBeenCalled();
    expect(result.competitors).toEqual([]);
    expect(result.fromCache).toBe(false);
  });
});

describe("POST /v1/competitors", () => {
  const app = buildApp({ competitorStore: new InMemoryCompetitorStore() });
  afterAll(async () => {
    await app.close();
  });

  const post = (payload: unknown) =>
    app.inject({ method: "POST", url: "/v1/competitors", payload: payload as object });

  it("rejects invalid coordinates", async () => {
    for (const bad of [
      { lat: 999, lng: 101, radiusMetres: 500, category: "other_fnb" },
      { lat: "abc", lng: 101, radiusMetres: 500, category: "other_fnb" },
      { lng: 101, radiusMetres: 500, category: "other_fnb" },
    ]) {
      const res = await post(bad);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("invalid_location");
    }
  });

  it("caps the radius", async () => {
    const res = await post({ lat: 3.15, lng: 101.71, radiusMetres: 50_000, category: "other_fnb" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_radius");
  });

  it("rejects an unknown category", async () => {
    const res = await post({ lat: 3.15, lng: 101.71, radiusMetres: 500, category: "nuclear" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_category");
  });

  it("returns an empty, clearly-labelled result when Places is not configured", async () => {
    const res = await post({ lat: 3.15, lng: 101.71, radiusMetres: 500, category: "other_fnb" });
    expect(res.statusCode).toBe(200);
    expect(res.json().placesConfigured).toBe(false);
    expect(res.json().searchSkipped).toBe(true);
    expect(res.json().competitors).toEqual([]);
  });

  it("does not disturb the deterministic simulate route", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/simulate",
      payload: { inputs: (await import("@spotential/sim-engine")).seedScenario("korean_restaurant", "mont_kiara") },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("the Places ceiling gates spending, not reading", () => {
  it("still serves cached results once the ceiling is hit", async () => {
    const store = new InMemoryCompetitorStore();
    await store.save({
      key: cacheKey(CENTRE, 500, "other_fnb"),
      centre: CENTRE,
      radiusMetres: 500,
      category: "other_fnb",
      competitors: [place("cached", 120)],
      fetchedAt: Date.now(),
      truncated: false,
    });

    const app = buildApp({
      competitorStore: store,
      places: { apiKey: "not-a-real-key" },
      placesQuota: new QuotaTracker({ perCallerPerDay: 0, globalPerDay: 0 }),
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/competitors",
      payload: { lat: CENTRE.lat, lng: CENTRE.lng, radiusMetres: 500, category: "other_fnb" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().fromCache).toBe(true);
    expect(res.json().competitors).toHaveLength(1);
    await app.close();
  });
});
