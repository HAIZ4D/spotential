import { afterAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { detectGaps } from "../src/competitors/gaps.js";
import { CATEGORY_PRESETS } from "@spotential/sim-engine";
import { InMemoryCompetitorStore } from "../src/competitors/store.js";
import { QuotaTracker } from "../src/quota.js";
import type { BusinessCategory, Competitor, LatLng } from "@spotential/sim-engine";

const CENTRE = { lat: 3.1578, lng: 101.7117 };

let seq = 0;
const place = (reviewCount: number): Competitor => ({
  id: `p${seq++}`,
  name: `Place ${seq}`,
  lat: CENTRE.lat + 0.0005,
  lng: CENTRE.lng,
  rating: 4.2,
  reviewCount,
  primaryType: "restaurant",
  priceLevel: null,
  businessStatus: "OPERATIONAL",
});

/** Returns a different sized set per category, so the ranking has something to do. */
const byCategory =
  (counts: Partial<Record<BusinessCategory, number[]>>) =>
  async (_c: LatLng, _r: number, category: BusinessCategory) =>
    (counts[category] ?? []).map(place);

describe("detectGaps", () => {
  it("searches every category once and caches all of them", async () => {
    const store = new InMemoryCompetitorStore();
    const fetchPlaces = vi.fn(byCategory({ korean_restaurant: [500, 400] }));

    const first = await detectGaps(store, fetchPlaces, CENTRE, 500);
    // Six categories, six searches, on a cold area.
    expect(fetchPlaces).toHaveBeenCalledTimes(6);
    expect(first.fromCache).toBe(false);
    expect(first.categoriesFetched).toBe(6);

    const second = await detectGaps(store, fetchPlaces, CENTRE, 500);
    // The whole point: a second look costs nothing.
    expect(fetchPlaces).toHaveBeenCalledTimes(6);
    expect(second.fromCache).toBe(true);
    expect(second.categoriesFetched).toBe(0);
  });

  it("shares the cache with a nearby click", async () => {
    const store = new InMemoryCompetitorStore();
    const fetchPlaces = vi.fn(byCategory({ casual_dining: [100] }));

    await detectGaps(store, fetchPlaces, CENTRE, 500);
    const nudged = await detectGaps(
      store,
      fetchPlaces,
      { lat: CENTRE.lat + 0.0001, lng: CENTRE.lng + 0.0001 },
      500,
    );

    expect(fetchPlaces).toHaveBeenCalledTimes(6);
    expect(nudged.fromCache).toBe(true);
  });

  it("shares the cache with the plain competitors endpoint", async () => {
    // Gap detection and a single-category search must not each keep their own
    // copy — that would double the Places bill for the same data.
    const store = new InMemoryCompetitorStore();
    const fetchPlaces = vi.fn(byCategory({ korean_restaurant: [500] }));

    await detectGaps(store, fetchPlaces, CENTRE, 500);
    const { findCompetitors } = await import("../src/competitors/service.js");
    const single = await findCompetitors(store, fetchPlaces, CENTRE, 500, "korean_restaurant");

    expect(single.fromCache).toBe(true);
    expect(fetchPlaces).toHaveBeenCalledTimes(6);
  });

  it("ranks a busy, thinly-served category above a crowded one", async () => {
    const store = new InMemoryCompetitorStore();
    const fetchPlaces = byCategory({
      cafe_coffee_shop: Array.from({ length: 20 }, () => 30),
      korean_restaurant: [900, 850],
    });

    const result = await detectGaps(store, fetchPlaces, CENTRE, 500);
    expect(result.topOpportunity?.category).toBe("korean_restaurant");

    const cafe = result.ranked.find((r) => r.category === "cafe_coffee_shop");
    expect(cafe?.verdict).toBe("saturated");
    expect(cafe?.outletsAreMinimum).toBe(true);
  });

  it("keeps empty categories out of the ranking", async () => {
    const store = new InMemoryCompetitorStore();
    const result = await detectGaps(store, byCategory({ casual_dining: [200] }), CENTRE, 500);

    expect(result.ranked.map((r) => r.category)).toEqual(["casual_dining"]);
    expect(result.noPresence).toHaveLength(5);
    expect(result.topOpportunity?.category).toBe("casual_dining");
  });

  it("spends nothing when fetching is disallowed", async () => {
    const store = new InMemoryCompetitorStore();
    const fetchPlaces = vi.fn(byCategory({ korean_restaurant: [500] }));

    const result = await detectGaps(store, fetchPlaces, CENTRE, 500, { allowFetch: false });

    expect(fetchPlaces).not.toHaveBeenCalled();
    expect(result.ranked).toEqual([]);
    expect(result.topOpportunity).toBeNull();
  });
});

describe("POST /v1/opportunity-gaps", () => {
  const app = buildApp({ competitorStore: new InMemoryCompetitorStore() });
  afterAll(async () => {
    await app.close();
  });

  const post = (payload: unknown) =>
    app.inject({ method: "POST", url: "/v1/opportunity-gaps", payload: payload as object });

  it("validates coordinates and radius like the competitors route", async () => {
    expect((await post({ lat: 999, lng: 101, radiusMetres: 500 })).statusCode).toBe(400);
    expect((await post({ lat: 3.15, lng: 101.71, radiusMetres: 99_999 })).statusCode).toBe(400);
  });

  it("returns an empty analysis rather than failing when Places is unconfigured", async () => {
    const res = await post({ lat: 3.15, lng: 101.71, radiusMetres: 500 });
    expect(res.statusCode).toBe(200);
    expect(res.json().placesConfigured).toBe(false);
    expect(res.json().topOpportunity).toBeNull();
    expect(res.json().narrative).toBe("");
  });

  it("does not disturb the other routes", async () => {
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });
});

describe("the write-up never blocks the analysis", () => {
  it("still returns the ranked table when Gemini is unreachable", async () => {
    const store = new InMemoryCompetitorStore();
    await store.save({
      key: "seed",
      centre: CENTRE,
      radiusMetres: 500,
      category: "korean_restaurant",
      competitors: [place(900)],
      fetchedAt: Date.now(),
      truncated: false,
    });

    // A transport that always fails: narrateGaps must swallow it.
    const app = buildApp({
      competitorStore: store,
      places: { apiKey: "not-a-real-key" },
      placesQuota: new QuotaTracker({ perCallerPerDay: 0, globalPerDay: 0 }),
      gemini: {
        transport: {
          name: "ai-studio",
          model: "test",
          async request() {
            throw new Error("gemini down");
          },
        },
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/opportunity-gaps",
      payload: { lat: CENTRE.lat, lng: CENTRE.lng, radiusMetres: 500 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().narrative).toBe("");
    // The table is the product; losing the prose must not lose the analysis.
    expect(res.json()).toHaveProperty("ranked");
    await app.close();
  });
});

/**
 * The spend guard.
 *
 * Every category searched is one Places call, on the Enterprise SKU: $35 per
 * 1,000 with 1,000 free a month. Searching all fifteen categories rather than
 * one sector's five or six would cut free gap analyses from roughly 166 a
 * month to 66, and take each one beyond that from about RM 0.99 to RM 2.47 —
 * against a MYR 45 budget that is already the binding constraint here.
 *
 * So this is asserted by COUNTING CALLS, not by reading the code.
 */
describe("gap detection is scoped to one sector", () => {
  it("searches only the sector asked for", async () => {
    const store = new InMemoryCompetitorStore();
    const fetchPlaces = vi.fn(byCategory({}));

    const searched: BusinessCategory[] = [];
    const spy = vi.fn(async (c: LatLng, r: number, category: BusinessCategory) => {
      searched.push(category);
      return fetchPlaces(c, r, category);
    });

    const result = await detectGaps(store, spy, CENTRE, 500, { sector: "retail" });

    expect(result.sector).toBe("retail");
    expect(searched.length).toBeGreaterThan(0);
    for (const category of searched) {
      expect(CATEGORY_PRESETS[category].sector).toBe("retail");
    }
  });

  it("never issues an F&B call for a retail question", async () => {
    const store = new InMemoryCompetitorStore();
    const searched: BusinessCategory[] = [];
    const spy = vi.fn(async (_c: LatLng, _r: number, category: BusinessCategory) => {
      searched.push(category);
      return [];
    });

    await detectGaps(store, spy, CENTRE, 500, { sector: "retail" });

    // The specific waste this exists to prevent: paying Places to tell a shop
    // owner how many Korean restaurants are nearby.
    expect(searched).not.toContain("korean_restaurant");
    expect(searched).not.toContain("cafe_coffee_shop");
  });

  it("costs no more per analysis than the six F&B categories did", async () => {
    const calls: Record<string, number> = {};

    for (const sector of ["fnb", "retail", "services"] as const) {
      const store = new InMemoryCompetitorStore();
      const spy = vi.fn(async () => []);
      await detectGaps(store, spy, CENTRE, 500, { sector });
      calls[sector] = spy.mock.calls.length;
    }

    // Six was the figure the free tier was budgeted around.
    for (const [sector, n] of Object.entries(calls)) {
      expect(n, `${sector} issued ${n} Places calls`).toBeLessThanOrEqual(6);
      expect(n).toBeGreaterThan(0);
    }
  });

  it("defaults to F&B, so existing callers are unchanged", async () => {
    const store = new InMemoryCompetitorStore();
    const spy = vi.fn(async () => []);

    const result = await detectGaps(store, spy, CENTRE, 500);

    expect(result.sector).toBe("fnb");
    expect(spy).toHaveBeenCalledTimes(6);
  });
});
