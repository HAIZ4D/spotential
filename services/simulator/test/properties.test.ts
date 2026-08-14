import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  MAX_LISTINGS,
  USER_AGENT,
  fetchListings,
  parseListings,
  searchUrl,
  type Fetcher,
} from "../src/properties/propertyguru.js";
import {
  CACHE_TTL_MS,
  InMemoryListingsStore,
  cacheKey,
  isFresh,
  loadListings,
} from "../src/properties/store.js";

/**
 * Retail listings — the Rent tab's "Available properties".
 *
 * The fixture is a REAL capture of a PropertyGuru search for KLCC, trimmed to
 * the listing payload. Tests written against a hand-built blob would only
 * prove the parser agrees with my idea of their format; this proves it agrees
 * with theirs, as of the date it was captured.
 */

const fixture = readFileSync(
  fileURLToPath(new URL("./fixtures/propertyguru-klcc.html", import.meta.url)),
  "utf-8",
);

describe("parseListings", () => {
  it("reads every listing on the page", () => {
    // Their page holds 20; the panel asks for fewer, so parse without a cap.
    expect(parseListings(fixture, 50)).toHaveLength(20);
  });

  it("maps the fields the card actually shows", () => {
    const [first] = parseListings(fixture, 1);
    expect(first).toBeDefined();

    expect(first!.url).toMatch(/^https:\/\/www\.propertyguru\.com\.my\/property-listing\//);
    expect(first!.monthlyRent).toBeGreaterThan(0);
    expect(first!.rentLabel).toMatch(/^RM /);
    expect(first!.thumbnailUrl).toMatch(/^https:\/\//);
    expect(first!.address).not.toBe("");
    expect(first!.propertyType).toBe("Retail Space");
  });

  it("carries the psf figure, which is the one the rent panel talks in", () => {
    const withPsf = parseListings(fixture, 50).filter((l) => l.psfLabel !== null);
    expect(withPsf.length).toBeGreaterThan(0);
    expect(withPsf[0]!.psfLabel).toMatch(/psf/i);
  });

  it("honours the limit", () => {
    expect(parseListings(fixture, 5)).toHaveLength(5);
    expect(parseListings(fixture)).toHaveLength(MAX_LISTINGS);
  });

  /**
   * The copyright line. Facts, a thumbnail URL and a link back are one thing;
   * republishing the agent's written description is another, and this asserts
   * we never start doing it by accident.
   */
  it("copies no listing prose and no agent contact details", () => {
    const serialised = JSON.stringify(parseListings(fixture, 50));
    expect(serialised).not.toMatch(/"body"/);
    expect(serialised).not.toMatch(/"agent"/);
    expect(serialised).not.toMatch(/"description"/);
    expect(serialised).not.toMatch(/phone|mobile|whatsapp/i);
  });

  it("returns nothing rather than throwing on anything unexpected", () => {
    for (const bad of [
      "",
      "<html><body>no script here</body></html>",
      '<script id="__NEXT_DATA__">{ not json</script>',
      '<script id="__NEXT_DATA__">{"props":{}}</script>',
      '<script id="__NEXT_DATA__">{"props":{"pageProps":{"pageData":{"data":{"listingsData":"nope"}}}}}</script>',
      '<script id="__NEXT_DATA__">null</script>',
    ]) {
      expect(parseListings(bad)).toEqual([]);
    }
  });

  it("skips a listing with no id or url instead of dropping the page", () => {
    const html =
      '<script id="__NEXT_DATA__">' +
      JSON.stringify({
        props: {
          pageProps: {
            pageData: {
              data: {
                listingsData: [
                  { listingData: { id: 1, url: "https://example.com/a", localizedTitle: "Good" } },
                  { listingData: { localizedTitle: "No id or url" } },
                  { listingData: null },
                  "not an object",
                ],
              },
            },
          },
        },
      }) +
      "</script>";

    const listings = parseListings(html, 10);
    expect(listings).toHaveLength(1);
    expect(listings[0]!.title).toBe("Good");
  });
});

describe("searchUrl", () => {
  it("uses the retail path, not the parameter that gets inverted", () => {
    // property-for-rent?...&property_type=C is 301'd to isCommercial=false and
    // serves residential. This path survives the redirect intact.
    expect(searchUrl("KLCC")).toBe(
      "https://www.propertyguru.com.my/retail-shops-for-rent?freetext=KLCC",
    );
    expect(searchUrl("Mont Kiara")).toContain("freetext=Mont%20Kiara");
  });
});

describe("fetchListings", () => {
  const okResponse = { ok: true, status: 200, text: async () => fixture };

  it("identifies itself honestly rather than as a browser", async () => {
    const fetcher = vi.fn(async () => okResponse) as unknown as Fetcher;
    await fetchListings("KLCC", 3, fetcher);

    const [, init] = (fetcher as unknown as { mock: { calls: [string, { headers: Record<string, string> }][] } })
      .mock.calls[0]!;
    expect(init.headers["user-agent"]).toBe(USER_AGENT);
    expect(init.headers["user-agent"]).toContain("+https://");
    expect(init.headers["user-agent"]).not.toMatch(/Chrome|Safari|Mozilla/);
  });

  it("returns listings on success", async () => {
    const result = await fetchListings("KLCC", 3, (async () => okResponse) as unknown as Fetcher);
    expect(result.available).toBe(true);
    expect(result.listings).toHaveLength(3);
    expect(result.reason).toBeNull();
  });

  it("reports a block rather than retrying around it", async () => {
    const result = await fetchListings("KLCC", 3, (async () => ({
      ok: false,
      status: 403,
      text: async () => "",
    })) as unknown as Fetcher);

    expect(result.available).toBe(false);
    expect(result.reason).toBe("http_403");
    expect(result.listings).toEqual([]);
  });

  it("never throws when the network does", async () => {
    const result = await fetchListings("KLCC", 3, (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as Fetcher);

    expect(result).toEqual({ listings: [], available: false, reason: "unreachable" });
  });

  it("distinguishes a timeout, because that one is worth seeing in logs", async () => {
    const result = await fetchListings("KLCC", 3, (async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }) as unknown as Fetcher);

    expect(result.reason).toBe("timeout");
  });

  it("succeeds with an empty list when the area genuinely has nothing", async () => {
    const result = await fetchListings("Nowhere", 3, (async () => ({
      ok: true,
      status: 200,
      text: async () => "<html></html>",
    })) as unknown as Fetcher);

    // available:true — we reached them and they had none. Different from a
    // block, and the client says different things about the two.
    expect(result.available).toBe(true);
    expect(result.reason).toBe("no_listings");
  });
});

describe("cacheKey", () => {
  it("collapses casing and spacing so one area is one fetch", () => {
    expect(cacheKey("Mont Kiara")).toBe("mont-kiara");
    expect(cacheKey("mont  kiara")).toBe("mont-kiara");
    expect(cacheKey("MONT KIARA")).toBe("mont-kiara");
  });

  it("produces a safe document id from an awkward label", () => {
    expect(cacheKey("Jalan TAR / Dang Wangi, KL")).toBe("jalan-tar-dang-wangi-kl");
    expect(cacheKey("...")).toBe("unknown");
  });
});

describe("loadListings", () => {
  const listing = {
    id: "1",
    url: "https://example.com/1",
    title: "Shop",
    address: "KLCC",
    monthlyRent: 5000,
    rentLabel: "RM 5,000 /mo",
    psfLabel: "RM 5.00 psf",
    floorSqft: 1000,
    sizeLabel: "1,000 sqft",
    propertyType: "Retail Space",
    thumbnailUrl: "https://example.com/1.jpg",
    postedLabel: "13 Aug 2026",
    transitLabel: null,
  };
  const hit = async () => ({ listings: [listing], available: true, reason: null });

  it("fetches once, then serves the cache", async () => {
    const store = new InMemoryListingsStore();
    const fetcher = vi.fn(hit);

    const first = await loadListings(store, "KLCC", fetcher, { allowFetch: true });
    const second = await loadListings(store, "klcc", fetcher, { allowFetch: true });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(second.listings).toEqual([listing]);
  });

  it("does not fetch when over the ceiling, and says why", async () => {
    const fetcher = vi.fn(hit);
    const result = await loadListings(new InMemoryListingsStore(), "KLCC", fetcher, {
      allowFetch: false,
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(result).toMatchObject({ listings: [], available: false, reason: "quota" });
  });

  /**
   * Caching a failure would turn a transient block into a full day of empty
   * panels, which is much worse than trying again on the next view.
   */
  it("never caches a failed fetch", async () => {
    const store = new InMemoryListingsStore();
    const failing = vi.fn(async () => ({ listings: [], available: false, reason: "http_403" }));

    await loadListings(store, "KLCC", failing, { allowFetch: true });
    await loadListings(store, "KLCC", failing, { allowFetch: true });

    expect(failing).toHaveBeenCalledTimes(2);
    expect(store.size).toBe(0);
  });

  it("caches a genuine empty result, which is a real answer", async () => {
    const store = new InMemoryListingsStore();
    const empty = vi.fn(async () => ({ listings: [], available: true, reason: "no_listings" }));

    await loadListings(store, "Nowhere", empty, { allowFetch: true });
    await loadListings(store, "Nowhere", empty, { allowFetch: true });

    expect(empty).toHaveBeenCalledTimes(1);
  });

  it("expires after a day, because listings go stale", () => {
    const entry = { key: "klcc", area: "KLCC", listings: [], fetchedAt: 1_000_000 };
    expect(isFresh(entry, 1_000_000 + CACHE_TTL_MS - 1)).toBe(true);
    expect(isFresh(entry, 1_000_000 + CACHE_TTL_MS)).toBe(false);
  });
});
