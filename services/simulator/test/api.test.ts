import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { aiStudioTransport } from "../src/gemini.js";
import { InMemoryCompetitorStore } from "../src/competitors/store.js";
import { QuotaTracker } from "../src/quota.js";
import { seedScenario, simulate, ENGINE_VERSION } from "@spotential/sim-engine";

const app = buildApp();
afterAll(async () => {
  await app.close();
});

const inputs = seedScenario("korean_restaurant", "mont_kiara");

describe("GET /health", () => {
  it("reports the engine and preset versions so a deploy can be identified", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", engineVersion: ENGINE_VERSION });
  });

  /**
   * The competitor cache silently ran in-memory in production for a day,
   * re-billing Places on every cold start while reporting cache hits to
   * itself. Reporting the live backend is what makes that assertable.
   */
  it("reports which backend each subsystem actually resolved to", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    const { backends } = res.json();

    expect(backends).toBeDefined();
    expect(backends.competitorCache).toBe("in-memory");
    expect(backends.gemini).toBe("none");
    expect(backends.places).toBe("none");
  });

  it("names the configured backends when they are present", async () => {
    const configured = buildApp({
      gemini: { transport: aiStudioTransport("k", "test-model") },
      places: { apiKey: "k" },
      competitorStore: new InMemoryCompetitorStore(),
      backends: {
        gemini: "vertex",
        geminiModel: "gemini-3.5-flash",
        competitorCache: "firestore",
        places: "configured",
      },
    });

    const { backends } = (await configured.inject({ method: "GET", url: "/health" })).json();
    expect(backends).toEqual({
      gemini: "vertex",
      geminiModel: "gemini-3.5-flash",
      competitorCache: "firestore",
      places: "configured",
    });
    await configured.close();
  });
});

describe("POST /v1/simulate", () => {
  it("returns exactly what the in-process engine returns", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/simulate", payload: { inputs } });
    expect(res.statusCode).toBe(200);
    // The service imports the same engine package, so this is the in-process
    // half of the client/server parity guarantee. The other half runs against
    // the deployed URL in parity.parity.test.ts.
    expect(res.json().result).toEqual(JSON.parse(JSON.stringify(simulate(inputs))));
  });

  it("rejects an invalid scenario with 400 and says what was wrong", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/simulate",
      payload: { inputs: { ...inputs, cogsPct: 12 } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_scenario");
    expect(String(res.json().details)).toContain("cogsPct");
  });

  it("rejects a body with no inputs at all", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/simulate", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("rejects smuggled unknown fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/simulate",
      payload: { inputs: { ...inputs, adminOverride: true } },
    });
    expect(res.statusCode).toBe(400);
  });
});

/**
 * GET /v1/properties — retail listings for the Rent tab.
 *
 * The route's whole job is to be unable to break the page it feeds. Every
 * failure below must come back 200 with available:false, because the Rent tab
 * worked before listings existed and has to keep working when they are gone.
 */
describe("GET /v1/properties", () => {
  const listing = {
    id: "1",
    url: "https://www.propertyguru.com.my/property-listing/1",
    title: "Shop lot",
    address: "KLCC, KL City Centre",
    monthlyRent: 7000,
    rentLabel: "RM 7,000 /mo",
    psfLabel: "RM 7.00 psf",
    floorSqft: 1000,
    sizeLabel: "1,000 sqft",
    propertyType: "Retail Space",
    thumbnailUrl: "https://my1-cdn.pgimgs.com/1.jpg",
    postedLabel: "13 Aug 2026",
    transitLabel: null,
  };

  type Outcome = { listings: typeof listing[]; available: boolean; reason: string | null };
  const withListings = (
    fetcher: () => Promise<Outcome> = async () => ({
      listings: [listing],
      available: true,
      reason: null,
    }),
  ) => buildApp({ listingsFetcher: fetcher });

  it("returns listings for an area", async () => {
    const res = await withListings().inject({ method: "GET", url: "/v1/properties?area=KLCC" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ available: true, area: "KLCC", listings: [listing] });
  });

  it("rejects a missing or oversized area", async () => {
    for (const url of ["/v1/properties", "/v1/properties?area=", "/v1/properties?area=" + "x".repeat(81)]) {
      const res = await withListings().inject({ method: "GET", url });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("invalid_area");
    }
  });

  it("reports itself unavailable rather than 404ing when unconfigured", async () => {
    const res = await buildApp().inject({ method: "GET", url: "/v1/properties?area=KLCC" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ available: false, reason: "not_configured", listings: [] });
  });

  it("stays 200 when the source refuses us", async () => {
    const app = withListings(async () => ({ listings: [], available: false, reason: "http_403" }));
    const res = await app.inject({ method: "GET", url: "/v1/properties?area=KLCC" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ available: false, reason: "http_403" });
  });

  it("caps the limit so a caller cannot ask us to fetch more pages", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...listing, id: String(i) }));
    const app = buildApp({
      listingsFetcher: async () => ({ listings: many, available: true, reason: null }),
    });

    const res = await app.inject({ method: "GET", url: "/v1/properties?area=KLCC&limit=99" });
    expect(res.json().listings.length).toBeLessThanOrEqual(6);
  });

  it("serves the second request from cache", async () => {
    let calls = 0;
    const app = buildApp({
      listingsFetcher: async () => {
        calls += 1;
        return { listings: [listing], available: true, reason: null };
      },
    });

    await app.inject({ method: "GET", url: "/v1/properties?area=KLCC" });
    const second = await app.inject({ method: "GET", url: "/v1/properties?area=klcc" });

    expect(calls).toBe(1);
    expect(second.json().fromCache).toBe(true);
  });

  it("stops fetching once the ceiling is reached", async () => {
    let calls = 0;
    const app = buildApp({
      listingsQuota: new QuotaTracker({ perCallerPerDay: 1, globalPerDay: 1 }),
      listingsFetcher: async () => {
        calls += 1;
        return { listings: [listing], available: true, reason: null };
      },
    });

    await app.inject({ method: "GET", url: "/v1/properties?area=Bangsar" });
    const blocked = await app.inject({ method: "GET", url: "/v1/properties?area=Cheras" });

    expect(calls).toBe(1);
    expect(blocked.json()).toMatchObject({ available: false, reason: "quota" });
  });
});

/**
 * GET /v1/amenities — OpenStreetMap demand generators for the heatmap.
 *
 * Same contract as the listings route: it reaches a third party, so it is
 * gated and quota'd, and it may never break the page it decorates. The
 * population map is the product; this is a layer on top of it.
 */
describe("GET /v1/amenities", () => {
  const KL = "west=101.63&south=3.09&east=101.74&north=3.19";
  const result = {
    layers: [{ id: "rail", label: "Rail & metro", count: 108, points: [], pinned: true }],
    places: [{ lat: 3.14, lng: 101.7, name: "Bukit Bintang" }],
    available: true,
    reason: null,
  };
  type Outcome = {
    layers: typeof result.layers;
    places: typeof result.places;
    available: boolean;
    reason: string | null;
  };
  const withAmenities = (fetcher: () => Promise<Outcome> = async () => result) =>
    buildApp({ amenitiesFetcher: fetcher });

  it("returns layers and named places", async () => {
    const res = await withAmenities().inject({ method: "GET", url: `/v1/amenities?${KL}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ available: true, layers: result.layers });
    expect(res.json().places[0].name).toBe("Bukit Bintang");
  });

  it("carries the ODbL attribution with the data", async () => {
    // The licence obliges attribution wherever the data is shown, so it
    // travels with the payload rather than being remembered by the client.
    const res = await withAmenities().inject({ method: "GET", url: `/v1/amenities?${KL}` });
    expect(res.json().attribution).toMatch(/OpenStreetMap/);
  });

  it("rejects missing or inverted bounds", async () => {
    for (const query of ["", "west=1&south=2", "west=5&east=1&south=1&north=2"]) {
      const res = await withAmenities().inject({ method: "GET", url: `/v1/amenities?${query}` });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("invalid_bounds");
    }
  });

  it("refuses a box that would be slow for Overpass, not just for us", async () => {
    const res = await withAmenities().inject({
      method: "GET",
      url: "/v1/amenities?west=100&east=105&south=1&north=6",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("bounds_too_large");
  });

  it("reports itself unavailable rather than 404ing when unconfigured", async () => {
    const res = await buildApp().inject({ method: "GET", url: `/v1/amenities?${KL}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ available: false, reason: "not_configured", layers: [] });
  });

  it("stays 200 when Overpass throttles", async () => {
    const app = withAmenities(async () => ({
      layers: [],
      places: [],
      available: false,
      reason: "throttled",
    }));
    const res = await app.inject({ method: "GET", url: `/v1/amenities?${KL}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ available: false, reason: "throttled" });
  });

  it("serves the second request from cache", async () => {
    let calls = 0;
    const app = buildApp({
      amenitiesFetcher: async () => {
        calls += 1;
        return result;
      },
    });

    await app.inject({ method: "GET", url: `/v1/amenities?${KL}` });
    const second = await app.inject({ method: "GET", url: `/v1/amenities?${KL}` });

    expect(calls).toBe(1);
    expect(second.json().fromCache).toBe(true);
  });

  /**
   * The snapshot wins, and that is the point: a user's page load must not
   * depend on a volunteer service being healthy.
   */
  it("answers a shipped city from the bundle without touching Overpass", async () => {
    const { AmenitiesSeed } = await import("../src/amenities/seed.js");
    const { join } = await import("node:path");
    const seed = await AmenitiesSeed.load(join(process.cwd(), "services", "simulator", "data"));

    let calls = 0;
    const app = buildApp({
      amenitiesSeed: seed,
      amenitiesFetcher: async () => {
        calls += 1;
        return result;
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/amenities?west=101.6319&south=3.084&east=101.7419&north=3.194",
    });

    expect(res.statusCode).toBe(200);
    expect(calls).toBe(0);
    expect(res.json()).toMatchObject({ available: true, source: "bundled" });
    expect(res.json().places.length).toBeGreaterThan(20);
    await app.close();
  });

  it("still fetches live for a box the bundle does not cover", async () => {
    const { AmenitiesSeed } = await import("../src/amenities/seed.js");
    const { join } = await import("node:path");
    const seed = await AmenitiesSeed.load(join(process.cwd(), "services", "simulator", "data"));

    let calls = 0;
    const app = buildApp({
      amenitiesSeed: seed,
      amenitiesFetcher: async () => {
        calls += 1;
        return result;
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/amenities?west=110&south=1&east=110.1&north=1.1",
    });

    expect(calls).toBe(1);
    expect(res.json().source).toBe("overpass");
    await app.close();
  });

  it("stops querying a volunteer service once the ceiling is reached", async () => {
    let calls = 0;
    const app = buildApp({
      amenitiesQuota: new QuotaTracker({ perCallerPerDay: 1, globalPerDay: 1 }),
      amenitiesFetcher: async () => {
        calls += 1;
        return result;
      },
    });

    await app.inject({ method: "GET", url: `/v1/amenities?${KL}` });
    const blocked = await app.inject({
      method: "GET",
      url: "/v1/amenities?west=100.28&south=5.36&east=100.38&north=5.46",
    });

    expect(calls).toBe(1);
    expect(blocked.json()).toMatchObject({ available: false, reason: "quota" });
  });
});

/**
 * GET /v1/heatmap now returns real hexagon geometry.
 *
 * The client draws exactly what it is given, so a regression here shows up as
 * a gapped or overlapping map rather than an error.
 */
describe("GET /v1/heatmap geometry", () => {
  it("returns six-vertex boundaries, not bare centroids", async () => {
    const { PopulationGrid } = await import("../src/population.js");
    const { join } = await import("node:path");
    // Source runs from src/, the bundle from dist/ — point at the real data.
    const grid = await PopulationGrid.load(join(process.cwd(), "services", "simulator", "data"));
    const withGrid = buildApp({ population: grid });

    const res = await withGrid.inject({
      method: "GET",
      url: "/v1/heatmap?west=101.63&south=3.09&east=101.74&north=3.19",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.resolution).toBe(8);
    expect(body.cells.length).toBeGreaterThan(50);

    for (const cell of body.cells.slice(0, 20)) {
      expect(cell.boundary).toHaveLength(12);
      expect(cell.population).toBeGreaterThan(0);
      expect(Number.isFinite(cell.lat)).toBe(true);
    }

    await withGrid.close();
  });
});

describe("unknown routes", () => {
  it("404s rather than leaking a stack trace", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found" });
  });
});
