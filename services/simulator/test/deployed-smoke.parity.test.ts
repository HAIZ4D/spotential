import { describe, expect, it } from "vitest";

/**
 * Post-deploy smoke checks against the DEPLOYED service.
 *
 * These exist because of a specific failure: the competitor cache silently ran
 * in-memory in production for a day. Nothing was broken from the outside — the
 * endpoint answered correctly and even reported cache hits, because a single
 * warm instance was talking to itself. The only symptom was that every cold
 * start re-billed the Places API.
 *
 * A unit test cannot catch that; it is a property of the deployed environment.
 * So the deployed environment gets asserted directly.
 *
 *   SIMULATOR_URL=https://... npm run test:parity
 */

const baseUrl = process.env["SIMULATOR_URL"];

/**
 * /v1/competitors is gated by App Check, which a CI process cannot satisfy —
 * it is not a browser on an allowed domain. The smoke key bypasses App Check
 * ONLY: quota and the spend ceiling still apply.
 */
const smokeKey = process.env["SMOKE_KEY"] ?? "";

interface Health {
  status: string;
  backends: {
    gemini: string;
    geminiModel: string | null;
    competitorCache: string;
    places: string;
  };
}

describe.skipIf(!baseUrl)("deployed backends", () => {
  it("uses Firestore for the competitor cache, not in-memory", async () => {
    const health = (await (await fetch(`${baseUrl}/health`)).json()) as Health;

    // The exact regression. In-memory here means every cold start pays Places
    // again, while still looking healthy from the outside.
    expect(health.backends.competitorCache).toBe("firestore");
  });

  it("has a Gemini backend configured and names the model", async () => {
    const health = (await (await fetch(`${baseUrl}/health`)).json()) as Health;

    expect(health.backends.gemini).not.toBe("none");
    expect(health.backends.geminiModel).toBeTruthy();
  });

  it("has Places configured", async () => {
    const health = (await (await fetch(`${baseUrl}/health`)).json()) as Health;
    expect(health.backends.places).toBe("configured");
  });
});

describe.skipIf(!baseUrl)("deployed competitor cache", () => {
  // A quiet spot, so the assertion does not depend on a dense area's data.
  const query = {
    lat: 3.1478,
    lng: 101.6953,
    radiusMetres: 500,
    category: "korean_restaurant",
  };

  const search = async (body: Record<string, unknown>) => {
    const response = await fetch(`${baseUrl}/v1/competitors`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(smokeKey ? { "x-smoke-key": smokeKey } : {}),
      },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    return (await response.json()) as {
      fromCache: boolean;
      competitors: unknown[];
      truncated: boolean;
      completeToMetres: number | null;
    };
  };

  it("serves a repeated search from cache rather than paying again", async () => {
    // Warm it, then assert the second call costs nothing. If the store were
    // in-memory and this ran against a fresh instance, this would fail.
    await search(query);
    const second = await search(query);
    expect(second.fromCache).toBe(true);
  });

  it("shares a cache entry with a search a few metres away", async () => {
    // Coordinate rounding is the main cost control; if it regresses, every
    // pin nudge starts billing Places.
    const nudged = await search({ ...query, lat: query.lat + 0.0001, lng: query.lng + 0.0001 });
    expect(nudged.fromCache).toBe(true);
  });

  it("reports how far a capped result set is actually complete", async () => {
    const result = await search(query);
    if (result.truncated) {
      // A capped search must never be presentable as a complete one.
      expect(result.completeToMetres).toBeGreaterThan(0);
    } else {
      expect(result.completeToMetres).toBeNull();
    }
  });
});

/**
 * PDF reports — Feature 4.
 *
 * Worth asserting against the deployed service specifically, because the two
 * things most likely to break here are environmental: react-pdf is external to
 * the bundle and installed separately into the runtime image, and the filename
 * header only survives cross-origin if CORS exposes it. Both look fine locally.
 */
describe.skipIf(!baseUrl)("deployed reports", () => {
  const report = (payload: Record<string, unknown>) =>
    fetch(`${baseUrl}/v1/report`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-smoke-key": smokeKey,
        origin: "https://spotential-app.web.app",
      },
      body: JSON.stringify(payload),
    });

  const scenario = {
    businessCategory: "korean_restaurant",
    district: "mont_kiara",
    initialInvestment: 150_000,
    monthlyRent: 12_000,
    securityDepositMonths: 6,
    avgPricePerTransaction: 18,
    customersPerDay: 180,
    seats: 40,
    openHoursPerDay: 10,
    daysOpenPerWeek: 7,
    cogsPct: 0.32,
    staffCount: 4,
    avgMonthlyWage: 2_000,
    utilities: 3_500,
    licensingFees: 400,
    marketing: 2_000,
    miscMonthly: 1_500,
    monthsToMaturity: 6,
    serviceChargePct: 0,
    sstRegistered: false,
    dineInSharePct: 0.8,
  };

  it("renders a real PDF from the runtime image", async () => {
    // react-pdf is --external and installed into /runtime separately, exactly
    // like @google-cloud/firestore. If that install is missing the route 500s
    // here while every local test still passes.
    const response = await report({ kind: "scenario", inputs: scenario });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");

    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(5_000);
  }, 60_000);

  it("exposes the filename header so the browser can name the download", async () => {
    const response = await report({ kind: "scenario", inputs: scenario });
    const exposed = response.headers.get("access-control-expose-headers") ?? "";

    expect(exposed.toLowerCase()).toContain("content-disposition");
    expect(response.headers.get("content-disposition")).toMatch(/filename="spotential-.*\.pdf"/);
  }, 60_000);

  it("rejects a body it cannot validate rather than rendering something wrong", async () => {
    const response = await report({ kind: "nonsense" });
    expect(response.status).toBe(400);
  }, 30_000);

  it("reports whether a map key is configured", async () => {
    const health = (await (await fetch(`${baseUrl}/health`)).json()) as {
      backends: Record<string, string>;
    };
    // The only billable part of a report. "none" is a valid deployment, but it
    // must be visible rather than discovered by a reader wondering where the
    // map went.
    expect(["configured", "none"]).toContain(health.backends["staticMaps"]);
  });
});

/**
 * The location chatbot — Feature 3, against the REAL model.
 *
 * One Gemini Flash call per parity run, deliberately. The failure modes this
 * catches are exactly the ones that have bitten before and that no local test
 * can see: a model id that 404s in this region, a key that works for listing
 * but not for generateContent, a backend switch that never took.
 */
describe.skipIf(!baseUrl)("deployed location chat", () => {
  const ask = (question: string) =>
    fetch(`${baseUrl}/v1/location/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-smoke-key": smokeKey },
      body: JSON.stringify({
        question,
        category: "korean_restaurant",
        radiusMetres: 500,
        location: {
          point: { lat: 3.1478, lng: 101.6953 },
          label: "Central KL",
          competitors: {
            total: 20,
            averageRating: 4.23,
            ratedCount: 20,
            totalReviews: 2060,
            nearestMetres: 60,
            operational: 20,
          },
          truncated: true,
          completeToMetres: 142,
          density: [{ upToMetres: 250, count: 20 }],
          rentOverride: null,
        },
        history: [],
      }),
    });

  /**
   * Asserts the route and the model, NOT which outcome the model picks.
   *
   * An earlier version pinned kind === "answer" and went intermittently red:
   * asked "how crowded is it here?", the model sometimes read "crowded" as
   * pedestrian footfall — which the data genuinely does not have — and
   * declined. That is correct behaviour, and a deployed check that flags
   * correct behaviour as a failure just teaches people to re-run it.
   *
   * The failure modes worth catching here all surface as a 5xx: a model id
   * that 404s in this region, a key that lists models but cannot call
   * generateContent, a backend switch that never took.
   */
  it("reaches the real model and returns a usable outcome", async () => {
    const response = await ask("what is the overall success score for this location?");
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      kind: string;
      text?: string;
      reason?: string;
    };

    expect(["answer", "declined", "adjust"]).toContain(body.kind);
    expect((body.text ?? body.reason ?? "").length).toBeGreaterThan(20);
  }, 45_000);

  it("declines what the data does not cover instead of inventing it", async () => {
    const body = (await (await ask("how busy will it be during Ramadan?")).json()) as {
      kind: string;
    };
    expect(["declined", "refused"]).toContain(body.kind);
  }, 45_000);

  it("validates before spending anything on the model", async () => {
    // A bad body must cost nothing.
    const response = await fetch(`${baseUrl}/v1/location/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-smoke-key": smokeKey },
      body: JSON.stringify({ question: "", category: "korean_restaurant", radiusMetres: 500 }),
    });
    expect(response.status).toBe(400);
  }, 20_000);
});

/**
 * Retail listings — the Rent tab's "Available properties".
 *
 * DELIBERATELY DOES NOT ASSERT THAT LISTINGS COME BACK. PropertyGuru sits
 * behind Cloudflare and refuses datacentre IPs, so on Cloud Run this route
 * legitimately returns `available: false, reason: "http_403"` — and that is
 * their decision to make and to change, in either direction, without telling
 * us. Pinning a listing count here would mean a red check every time they
 * adjust their edge rules, which just teaches people to re-run the suite.
 *
 * What IS asserted is the part we own: the route answers, the shape is right,
 * a failure degrades to an empty list rather than a 5xx, and the cache is the
 * real one. Same reasoning as never asserting which outcome the model picks.
 */
describe.skipIf(!baseUrl)("deployed listings", () => {
  it("answers with a well-formed result, whatever the source did", async () => {
    const response = await fetch(`${baseUrl}/v1/properties?area=KLCC`, {
      headers: { ...(smokeKey ? { "x-smoke-key": smokeKey } : {}) },
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      listings: unknown[];
      available: boolean;
      reason: string | null;
      area: string;
    };

    expect(Array.isArray(body.listings)).toBe(true);
    expect(typeof body.available).toBe("boolean");
    expect(body.area).toBe("KLCC");

    // The invariant that actually matters: unavailable never means garbage.
    if (!body.available) expect(body.listings).toEqual([]);
    // And when it IS available, the cards must have what they render.
    for (const listing of body.listings as Record<string, unknown>[]) {
      expect(typeof listing["url"]).toBe("string");
      expect(String(listing["url"])).toMatch(/^https:\/\//);
      expect(typeof listing["rentLabel"]).toBe("string");
    }
  }, 30_000);

  it("rejects a junk area rather than fetching for it", async () => {
    const response = await fetch(`${baseUrl}/v1/properties?area=`, {
      headers: { ...(smokeKey ? { "x-smoke-key": smokeKey } : {}) },
    });
    expect(response.status).toBe(400);
  }, 20_000);

  it("is gated, like every other route that reaches outside", async () => {
    const response = await fetch(`${baseUrl}/v1/properties?area=KLCC`);
    expect(response.status).toBe(401);
  }, 20_000);

  it("uses the real cache, not a per-instance one", async () => {
    const health = (await (await fetch(`${baseUrl}/health`)).json()) as {
      backends: Record<string, string>;
    };
    // An in-memory downgrade would re-fetch a third party on every cold start.
    expect(health.backends["listingsCache"]).toBe("firestore");
    expect(health.backends["listings"]).toBe("propertyguru");
  }, 20_000);
});

/**
 * The city heatmap — real hexagons and the bundled amenities snapshot.
 *
 * The seed assertion is load-bearing. esbuild bundles the service into one
 * file, so a data path written relative to the source tree resolves somewhere
 * else at runtime — which is exactly what happened: the snapshot silently
 * failed to load in production while every unit test passed, because the
 * tests pass the directory explicitly. Same class as the in-memory cache
 * downgrade, and the same fix: assert what the deployment actually resolved.
 */
describe.skipIf(!baseUrl)("deployed city demand", () => {
  const KL = "west=101.6319&south=3.084&east=101.7419&north=3.194";

  it("serves true hexagon geometry, not centroids", async () => {
    const response = await fetch(`${baseUrl}/v1/heatmap?${KL}`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      cells: { lat: number; lng: number; population: number; boundary: number[] }[];
      resolution: number;
    };

    expect(body.resolution).toBe(8);
    expect(body.cells.length).toBeGreaterThan(100);
    for (const cell of body.cells.slice(0, 25)) {
      // Six vertices. Squares cannot tile a hexagonal grid, which is how the
      // old rendering left a visible gap between every cell.
      expect(cell.boundary).toHaveLength(12);
      expect(cell.population).toBeGreaterThan(0);
    }
  }, 30_000);

  it("loaded the bundled amenities snapshot", async () => {
    const health = (await (await fetch(`${baseUrl}/health`)).json()) as {
      backends: Record<string, string>;
    };
    // "none" means the file did not load and every page view now depends on a
    // volunteer service being healthy.
    expect(health.backends["amenitiesSeed"]).toMatch(/^cities:[1-9]/);
    expect(health.backends["amenitiesCache"]).toBe("firestore");
  }, 20_000);

  it("answers a shipped city from the bundle, without touching Overpass", async () => {
    const response = await fetch(`${baseUrl}/v1/amenities?${KL}`, {
      headers: { ...(smokeKey ? { "x-smoke-key": smokeKey } : {}) },
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      layers: { id: string; count: number; points: unknown[]; pinned: boolean }[];
      places: { name: string }[];
      available: boolean;
      source?: string;
      attribution?: string;
    };

    expect(body.available).toBe(true);
    expect(body.source).toBe("bundled");
    expect(body.places.length).toBeGreaterThan(20);
    expect(body.attribution).toMatch(/OpenStreetMap/);

    const rail = body.layers.find((l) => l.id === "rail");
    expect(rail?.points.length).toBeGreaterThan(10);

    // Dense kinds keep a true count and stay undrawn.
    const bus = body.layers.find((l) => l.id === "bus");
    expect(bus?.count).toBeGreaterThan(100);
    expect(bus?.points).toHaveLength(0);
  }, 30_000);

  it("is gated, like every route that can reach outside", async () => {
    expect((await fetch(`${baseUrl}/v1/amenities?${KL}`)).status).toBe(401);
  }, 20_000);
});

describe.skipIf(baseUrl)("deployed smoke", () => {
  it("is skipped without SIMULATOR_URL", () => {
    expect(baseUrl).toBeUndefined();
  });
});
