import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  AMENITY_KINDS,
  COUNT_ONLY_KINDS,
  MAX_PINS_PER_KIND,
  PINNED_KINDS,
  buildCountsQuery,
  buildPinnedQuery,
  fetchAmenities,
  parseAmenities,
  type Fetcher,
} from "../src/amenities/overpass.js";
import {
  CACHE_TTL_MS,
  InMemoryAmenitiesStore,
  cacheKey,
  isFresh,
  loadAmenities,
} from "../src/amenities/store.js";
import { AmenitiesSeed } from "../src/amenities/seed.js";

/**
 * Demand generators from OpenStreetMap.
 *
 * The fixture is a REAL Overpass response for an 11km box over central KL,
 * trimmed to a handful of each element shape but with the count elements kept
 * intact. Counts are the part most easily got wrong, so they are the part
 * pinned hardest.
 */

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/overpass-kl.json", import.meta.url)), "utf-8"),
);

const KL = { west: 101.63, south: 3.09, east: 101.74, north: 3.19 };
const layer = (id: string) => parseAmenities(fixture).layers.find((l) => l.id === id)!;

describe("the queries", () => {
  /**
   * Split in two after measuring: 4 pinned kinds + places runs in 4.4s and is
   * reliable, while all 8 takes 7-16s and 504s intermittently. The wildcard
   * office tag and 1,026 bus stops are the cost, and both are count-only.
   */
  it("keeps the drawable data in the fast query", () => {
    const query = buildPinnedQuery(KL);

    for (const kind of PINNED_KINDS) {
      expect(query).toContain(`.${kind.id} out count;`);
      expect(query).toContain(`.${kind.id} out center ${MAX_PINS_PER_KIND}`);
    }
    // The expensive count-only kinds must not be in the query that matters.
    for (const kind of COUNT_ONLY_KINDS) expect(query).not.toContain(`.${kind.id} `);
  });

  it("asks the dense kinds for counts only, in a separate query", () => {
    const query = buildCountsQuery(KL);

    for (const kind of COUNT_ONLY_KINDS) {
      expect(query).toContain(`.${kind.id} out count;`);
      // Never geometry — `out center` would also cap the count at 150 where
      // there are 1,026, which is the truncation trap that once flattened the
      // competition score.
      expect(query).not.toContain(`.${kind.id} out center`);
    }
  });

  it("scopes every filter to the requested box", () => {
    for (const query of [buildPinnedQuery(KL), buildCountsQuery(KL)]) {
      expect(query).toContain("3.09,101.63,3.19,101.74");
      // south,west,north,east — Overpass order, not our own.
      expect(query).not.toContain("101.63,3.09");
    }
  });

  it("asks for named places so areas can be labelled without paying Google", () => {
    expect(buildPinnedQuery(KL)).toContain('node["place"');
  });
});

describe("parseAmenities", () => {
  it("reads the true counts, not the capped ones", () => {
    // Measured against the live API when the fixture was captured.
    expect(layer("rail").count).toBe(108);
    expect(layer("mall").count).toBe(89);
    expect(layer("university").count).toBe(120);
    expect(layer("healthcare").count).toBe(53);
    expect(layer("school").count).toBe(270);
    expect(layer("office").count).toBe(1_018);
    expect(layer("hotel").count).toBe(472);
    expect(layer("bus").count).toBe(1_026);
  });

  it("counts more than it pins for the dense kinds", () => {
    const bus = layer("bus");
    expect(bus.count).toBeGreaterThan(1_000);
    // Never drawn: a thousand pins is confetti, not information.
    expect(bus.points).toHaveLength(0);
    expect(bus.pinned).toBe(false);
  });

  it("pins the sparse, high-signal kinds", () => {
    for (const id of ["rail", "mall", "university", "healthcare"]) {
      const found = layer(id);
      expect(found.pinned).toBe(true);
      expect(found.points.length).toBeGreaterThan(0);
      expect(found.points.length).toBeLessThanOrEqual(MAX_PINS_PER_KIND);
      for (const point of found.points) {
        expect(Number.isFinite(point.lat)).toBe(true);
        expect(Number.isFinite(point.lng)).toBe(true);
      }
    }
  });

  it("reads a position from ways and relations, not just nodes", () => {
    // Malls and hospitals are mapped as areas; without `out center` handling
    // they would silently vanish from the map.
    const all = parseAmenities(fixture).layers.flatMap((l) => l.points);
    expect(all.length).toBeGreaterThan(0);
  });

  it("names neighbourhoods for the top-areas list", () => {
    const { places } = parseAmenities(fixture);
    expect(places.length).toBeGreaterThan(20);
    const names = places.map((p) => p.name);
    expect(names).toContain("Bukit Bintang");
    expect(names).toContain("Bangsar");
    for (const place of places) expect(place.name).not.toBe("");
  });

  it("keeps places out of the amenity layers", () => {
    const { layers, places } = parseAmenities(fixture);
    const pinned = layers.flatMap((l) => l.points.map((p) => p.name));
    for (const place of places) {
      // A suburb node is not a mall.
      expect(pinned.filter((n) => n === place.name)).toHaveLength(0);
    }
  });

  it("returns empty layers rather than throwing on anything unexpected", () => {
    for (const bad of [null, {}, { elements: "nope" }, { elements: [null, 1, "x"] }, []]) {
      const { layers, places } = parseAmenities(bad);
      expect(layers).toHaveLength(AMENITY_KINDS.length);
      expect(layers.every((l) => l.count === 0 && l.points.length === 0)).toBe(true);
      expect(places).toEqual([]);
    }
  });
});

describe("fetchAmenities", () => {
  const ok = { ok: true, status: 200, json: async () => fixture };

  it("identifies itself to a volunteer-run service", async () => {
    const fetcher = vi.fn(async () => ok) as unknown as Fetcher;
    await fetchAmenities(KL, fetcher);

    const [url, init] = (
      fetcher as unknown as { mock: { calls: [string, { headers: Record<string, string>; method: string }][] } }
    ).mock.calls[0]!;

    expect(url).toContain("overpass-api.de");
    expect(init.method).toBe("POST");
    expect(init.headers["user-agent"]).toContain("Spotential");
    expect(init.headers["user-agent"]).toContain("+https://");
  });

  it("names throttling specifically — it is the expected failure", async () => {
    const result = await fetchAmenities(KL, (async () => ({
      ok: false,
      status: 429,
      json: async () => ({}),
    })) as unknown as Fetcher);

    expect(result.available).toBe(false);
    expect(result.reason).toBe("throttled");
    expect(result.layers.every((l) => l.count === 0)).toBe(true);
  });

  /**
   * The reason the query is split at all: the dense counts are worth having
   * but not worth losing the map layer for.
   */
  it("keeps the drawn layers when only the counts query fails", async () => {
    let call = 0;
    const result = await fetchAmenities(KL, (async () => {
      call += 1;
      // First call is the pinned query, second the counts query.
      return call === 1
        ? { ok: true, status: 200, json: async () => fixture }
        : { ok: false, status: 504, json: async () => ({}) };
    }) as unknown as Fetcher);

    expect(result.available).toBe(true);
    expect(result.reason).toBe("counts_unavailable");
    expect(result.layers.find((l) => l.id === "rail")!.points.length).toBeGreaterThan(0);
    expect(result.places.length).toBeGreaterThan(0);
    // Zeroed rather than wrong: the count genuinely is not known.
    expect(result.layers.find((l) => l.id === "bus")!.count).toBe(0);
  });

  it("gives up entirely when the query that matters fails", async () => {
    const result = await fetchAmenities(KL, (async () => ({
      ok: false,
      status: 504,
      json: async () => ({}),
    })) as unknown as Fetcher);

    expect(result.available).toBe(false);
    expect(result.reason).toBe("http_504");
    expect(result.layers).toHaveLength(AMENITY_KINDS.length);
  });

  it("returns every kind in declared order, whichever query supplied it", async () => {
    const result = await fetchAmenities(KL, (async () => ({
      ok: true,
      status: 200,
      json: async () => fixture,
    })) as unknown as Fetcher);

    expect(result.layers.map((l) => l.id)).toEqual(AMENITY_KINDS.map((k) => k.id));
  });

  it("never throws when Overpass misbehaves", async () => {
    for (const boom of [
      async () => {
        throw new Error("ECONNRESET");
      },
      // Overloaded Overpass sometimes returns HTML, so json() rejects.
      async () => ({ ok: true, status: 200, json: async () => Promise.reject(new Error("not json")) }),
    ]) {
      const result = await fetchAmenities(KL, boom as unknown as Fetcher);
      expect(result.available).toBe(false);
      expect(result.layers).toHaveLength(AMENITY_KINDS.length);
    }
  });
});

describe("the amenities cache", () => {
  const result = {
    layers: [{ id: "rail", label: "Rail & metro", count: 108, points: [], pinned: true }],
    places: [],
    available: true,
    reason: null,
  };

  it("rounds bounds to about a kilometre so a nudged box still hits", () => {
    expect(cacheKey(KL)).toBe(cacheKey({ ...KL, west: KL.west + 0.0001 }));
    expect(cacheKey(KL)).not.toBe(cacheKey({ ...KL, west: 100.2 }));
  });

  it("queries once, then serves the cache", async () => {
    const store = new InMemoryAmenitiesStore();
    const fetcher = vi.fn(async () => result);

    const first = await loadAmenities(store, KL, fetcher, { allowFetch: true });
    const second = await loadAmenities(store, KL, fetcher, { allowFetch: true });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
  });

  /**
   * A 429 is transient. Caching it for a week would be the worst possible
   * response to a momentary problem.
   */
  it("never caches a throttled response", async () => {
    const store = new InMemoryAmenitiesStore();
    const failing = vi.fn(async () => ({
      layers: [],
      places: [],
      available: false,
      reason: "throttled",
    }));

    await loadAmenities(store, KL, failing, { allowFetch: true });
    await loadAmenities(store, KL, failing, { allowFetch: true });

    expect(failing).toHaveBeenCalledTimes(2);
    expect(store.size).toBe(0);
  });

  it("refuses to query when over the ceiling", async () => {
    const fetcher = vi.fn(async () => result);
    const out = await loadAmenities(new InMemoryAmenitiesStore(), KL, fetcher, {
      allowFetch: false,
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(out.reason).toBe("quota");
  });

  it("holds for a week, because stations do not move", () => {
    const entry = { key: "k", layers: [], places: [], fetchedAt: 1_000_000 };
    expect(isFresh(entry, 1_000_000 + CACHE_TTL_MS - 1)).toBe(true);
    expect(isFresh(entry, 1_000_000 + CACHE_TTL_MS)).toBe(false);
    expect(CACHE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

/**
 * The bundled snapshot.
 *
 * This is what makes the feature reliable. Overpass answered one of our four
 * cities fully, one partially, 504'd one and throttled one in a single sitting
 * — all fair from free infrastructure, none of it acceptable on a page load.
 */
describe("the bundled snapshot", () => {
  const DATA_DIR = join(process.cwd(), "services", "simulator", "data");

  it("covers every city the heatmap offers", async () => {
    const seed = await AmenitiesSeed.load(DATA_DIR);
    expect(seed.cityCount).toBe(4);
    expect(seed.vintage).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("is keyed the same way as the live cache, so the two are interchangeable", async () => {
    const seed = await AmenitiesSeed.load(DATA_DIR);
    // The exact box the client sends for Kuala Lumpur.
    const KL_BOX = { west: 101.6319, south: 3.084, east: 101.7419, north: 3.194 };

    const found = seed.find(KL_BOX);
    expect(found).not.toBeNull();
    expect(found!.label).toBe("Kuala Lumpur");
    expect(seed.find({ ...KL_BOX, west: KL_BOX.west + 0.0001 })).not.toBeNull();
  });

  it("holds real pins and real place names", async () => {
    const seed = await AmenitiesSeed.load(DATA_DIR);
    const kl = seed.find({ west: 101.6319, south: 3.084, east: 101.7419, north: 3.194 })!;

    const rail = kl.layers.find((l) => l.id === "rail")!;
    expect(rail.count).toBeGreaterThan(50);
    expect(rail.points.length).toBeGreaterThan(20);

    // Dense kinds keep their true count and stay undrawn.
    const bus = kl.layers.find((l) => l.id === "bus")!;
    expect(bus.count).toBeGreaterThan(500);
    expect(bus.points).toHaveLength(0);

    expect(kl.places.map((p) => p.name)).toContain("Bukit Bintang");
  });

  it("returns null for a box it does not ship, so the live path still runs", async () => {
    const seed = await AmenitiesSeed.load(DATA_DIR);
    expect(seed.find({ west: 110, south: 1, east: 110.1, north: 1.1 })).toBeNull();
  });
});
