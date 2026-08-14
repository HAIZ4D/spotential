import { afterAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { StaticMapFetcher } from "../src/staticmap.js";
import { seedScenario } from "@spotential/sim-engine";
import { filenameOf, parseReportRequest } from "../src/report/request.js";

/**
 * POST /v1/report — Feature 4.
 *
 * The rule these tests exist to hold: NOTHING DERIVABLE IS TAKEN FROM THE
 * REQUEST BODY. The output is a document someone may hand to a bank, so a
 * client that posts its own score must not see that score in the PDF.
 */

const app = buildApp();
afterAll(async () => {
  await app.close();
});

const scenario = seedScenario("korean_restaurant", "mont_kiara");

const LOCATION = {
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
};

const post = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/v1/report", payload });

describe("rendering", () => {
  it("returns a PDF for a scenario", async () => {
    const res = await post({ kind: "scenario", inputs: scenario });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  }, 60_000);

  it("returns a PDF for a location", async () => {
    const res = await post({
      kind: "location",
      category: "korean_restaurant",
      radiusMetres: 500,
      location: LOCATION,
    });

    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  }, 60_000);

  it("returns a PDF for a comparison", async () => {
    const res = await post({
      kind: "comparison",
      category: "korean_restaurant",
      radiusMetres: 500,
      locations: [LOCATION, { ...LOCATION, point: { lat: 3.0738, lng: 101.5183 }, label: "PJ" }],
    });

    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  }, 60_000);

  it("offers a filename the browser can save directly", async () => {
    const res = await post({
      kind: "location",
      category: "korean_restaurant",
      radiusMetres: 500,
      location: LOCATION,
    });

    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="spotential-central-kl.pdf"',
    );
  }, 60_000);

  it("is never cached — the report is derived entirely from the body", async () => {
    const res = await post({ kind: "scenario", inputs: scenario });
    expect(res.headers["cache-control"]).toBe("no-store");
  }, 60_000);

  /**
   * content-disposition is NOT a CORS-safelisted response header, and the
   * browser app is on a different origin to this service. Without the expose
   * header the client cannot read the filename at all and every download gets
   * a generic fallback name — which looked fine locally and only showed up
   * once the browser was talking cross-origin.
   */
  it("exposes the filename header across origins", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/report",
      headers: { origin: "https://spotential-app.web.app" },
      payload: { kind: "scenario", inputs: scenario },
    });

    expect(String(res.headers["access-control-expose-headers"]).toLowerCase()).toContain(
      "content-disposition",
    );
  }, 60_000);
});

describe("nothing derivable is trusted from the body", () => {
  /**
   * The whole reason the route recomputes rather than formats. If a posted
   * score could reach the page, the PDF would be a forgeable document with
   * Spotential's name on it.
   */
  it("ignores a score supplied by the client", () => {
    const parsed = parseReportRequest({
      kind: "location",
      category: "korean_restaurant",
      radiusMetres: 500,
      location: { ...LOCATION, score: { overall: 99 }, overall: 99, breakEven: 1 },
    });

    expect(parsed.ok).toBe(true);
    // The parsed shape has no route by which a supplied score could survive.
    const value = parsed.ok && parsed.value.kind === "location" ? parsed.value.location : null;
    expect(value).not.toBeNull();
    expect(Object.keys(value!)).not.toContain("score");
    expect(Object.keys(value!)).not.toContain("overall");
  });

  /**
   * The rival list is a new input, and inputs from the browser are the one
   * place this route relaxes — the server cannot re-derive competitor names
   * without a paid Places call. It is accepted, then clamped hard.
   */
  it("caps and sanitises a hostile rival list", () => {
    const parsed = parseReportRequest({
      kind: "location",
      category: "korean_restaurant",
      radiusMetres: 500,
      location: {
        ...LOCATION,
        rivals: [
          ...Array.from({ length: 500 }, (_, i) => ({
            name: `Spam ${i}`,
            rating: 99,
            reviewCount: -5,
            distanceMetres: 9_999_999,
          })),
          { name: "x".repeat(400), rating: "high", reviewCount: "many" },
          { name: "" },
          null,
        ],
      },
    });

    expect(parsed.ok).toBe(true);
    const rivals =
      parsed.ok && parsed.value.kind === "location" ? (parsed.value.location.rivals ?? []) : [];

    // Bounded, so a huge list cannot inflate the document.
    expect(rivals.length).toBeLessThanOrEqual(40);
    // Nameless entries are dropped rather than printed as blanks.
    expect(rivals.every((r) => r.name.length > 0 && r.name.length <= 60)).toBe(true);

    for (const rival of rivals) {
      expect(rival.rating === null || (rival.rating > 0 && rival.rating <= 5)).toBe(true);
      expect(rival.reviewCount).toBeGreaterThanOrEqual(0);
      expect(rival.distanceMetres).toBeLessThanOrEqual(50_000);
    }
  });

  it("treats a missing rival list as no rivals, not as an error", () => {
    const parsed = parseReportRequest({
      kind: "location",
      category: "korean_restaurant",
      radiusMetres: 500,
      location: LOCATION,
    });

    expect(parsed.ok).toBe(true);
    const rivals =
      parsed.ok && parsed.value.kind === "location" ? (parsed.value.location.rivals ?? []) : null;
    expect(rivals).toEqual([]);
  });

  it("rejects a scenario the simulator itself would reject", async () => {
    const res = await post({
      kind: "scenario",
      inputs: { ...scenario, avgPricePerTransaction: "free" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_report");
  });

  it("rejects an unknown kind", async () => {
    const res = await post({ kind: "everything", inputs: scenario });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/kind must be one of/);
  });

  it("rejects a malformed coordinate", async () => {
    const res = await post({
      kind: "location",
      category: "korean_restaurant",
      radiusMetres: 500,
      location: { ...LOCATION, point: { lat: 999, lng: 101 } },
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects an unsupported category and an out-of-range radius", async () => {
    for (const body of [
      { kind: "location", category: "car_wash", radiusMetres: 500, location: LOCATION },
      { kind: "location", category: "korean_restaurant", radiusMetres: 50_000, location: LOCATION },
    ]) {
      expect((await post(body)).statusCode).toBe(400);
    }
  });

  it("rejects a comparison of fewer than two or more than three", async () => {
    const base = { kind: "comparison", category: "korean_restaurant", radiusMetres: 500 };
    expect((await post({ ...base, locations: [LOCATION] })).statusCode).toBe(400);
    expect(
      (await post({ ...base, locations: Array.from({ length: 4 }, () => LOCATION) })).statusCode,
    ).toBe(400);
  });

  it("caps a hostile label rather than laying it out", () => {
    const parsed = parseReportRequest({
      kind: "location",
      category: "korean_restaurant",
      radiusMetres: 500,
      location: { ...LOCATION, label: "A".repeat(50_000) },
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.value.kind === "location") {
      expect(parsed.value.location.label.length).toBeLessThanOrEqual(120);
    }
  });

  it("treats a zero rent as absent, not as a free shop", () => {
    const parsed = parseReportRequest({
      kind: "location",
      category: "korean_restaurant",
      radiusMetres: 500,
      location: { ...LOCATION, rentOverride: 0 },
    });

    if (parsed.ok && parsed.value.kind === "location") {
      expect(parsed.value.location.rentOverride).toBeNull();
    }
  });

  it("treats a zero average rating as unrated, not as terrible", () => {
    const parsed = parseReportRequest({
      kind: "location",
      category: "korean_restaurant",
      radiusMetres: 500,
      location: { ...LOCATION, competitors: { ...LOCATION.competitors, averageRating: 0 } },
    });

    if (parsed.ok && parsed.value.kind === "location") {
      expect(parsed.value.location.competitors.averageRating).toBeNull();
    }
  });

  it("produces a safe filename from a hostile label", () => {
    const parsed = parseReportRequest({
      kind: "location",
      category: "korean_restaurant",
      radiusMetres: 500,
      location: { ...LOCATION, label: '../../etc/passwd"; rm -rf /' },
    });

    if (parsed.ok) {
      expect(filenameOf(parsed.value)).toMatch(/^spotential-[a-z0-9-]*\.pdf$/);
    }
  });
});

describe("the map never fails the report", () => {
  const locationBody = {
    kind: "location",
    category: "korean_restaurant",
    radiusMetres: 500,
    location: LOCATION,
  };

  it("renders without a map when no key is configured", async () => {
    const res = await post(locationBody);
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  }, 60_000);

  it("renders when the map service returns an error", async () => {
    const fetcher = new StaticMapFetcher({ apiKey: "test-key" });
    const withMap = buildApp({ staticMaps: fetcher });
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 403 }));

    try {
      const res = await withMap.inject({
        method: "POST",
        url: "/v1/report",
        payload: locationBody,
      });
      expect(res.statusCode).toBe(200);
      expect(res.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    } finally {
      spy.mockRestore();
      await withMap.close();
    }
  }, 60_000);

  it("renders when the map service is unreachable", async () => {
    const fetcher = new StaticMapFetcher({ apiKey: "test-key" });
    const withMap = buildApp({ staticMaps: fetcher });
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ENOTFOUND"));

    try {
      const res = await withMap.inject({
        method: "POST",
        url: "/v1/report",
        payload: locationBody,
      });
      expect(res.statusCode).toBe(200);
    } finally {
      spy.mockRestore();
      await withMap.close();
    }
  }, 60_000);

  it("never asks for a map for a scenario, which has no location", async () => {
    const fetcher = new StaticMapFetcher({ apiKey: "test-key" });
    const withMap = buildApp({ staticMaps: fetcher });
    const spy = vi.spyOn(globalThis, "fetch");

    try {
      await withMap.inject({
        method: "POST",
        url: "/v1/report",
        payload: { kind: "scenario", inputs: scenario },
      });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      await withMap.close();
    }
  }, 60_000);

  it("bills one map call for a three-way comparison, not three", async () => {
    const fetcher = new StaticMapFetcher({ apiKey: "test-key" });
    const withMap = buildApp({ staticMaps: fetcher });
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(png, { status: 200 }));

    try {
      await withMap.inject({
        method: "POST",
        url: "/v1/report",
        payload: {
          kind: "comparison",
          category: "korean_restaurant",
          radiusMetres: 500,
          locations: [
            LOCATION,
            { ...LOCATION, point: { lat: 3.0738, lng: 101.5183 }, label: "PJ" },
            { ...LOCATION, point: { lat: 3.1578, lng: 101.7123 }, label: "KLCC" },
          ],
        },
      });
      // One image with three markers, not one image each.
      expect(spy).toHaveBeenCalledTimes(1);

      const url = String(spy.mock.calls[0]?.[0]);
      expect(url.match(/markers=/g)).toHaveLength(3);
      // Google fits the viewport exactly to the markers, clipping the
      // outermost pins in half. Two invisible corner points pad the bounds.
      expect(url.match(/visible=/g)).toHaveLength(2);
      // Coordinates are rounded so repeat reports of a site hit the cache.
      expect(url).toContain("3.148%2C101.695");
    } finally {
      spy.mockRestore();
      await withMap.close();
    }
  }, 60_000);

  it("reuses a cached map rather than paying for the same view twice", async () => {
    const withMap = buildApp({ staticMaps: new StaticMapFetcher({ apiKey: "test-key" }) });
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(png, { status: 200 }));

    try {
      // Second request nudges the pin by a few metres — inside the rounding,
      // so it must not bill again.
      await withMap.inject({ method: "POST", url: "/v1/report", payload: locationBody });
      await withMap.inject({
        method: "POST",
        url: "/v1/report",
        payload: {
          ...locationBody,
          location: { ...LOCATION, point: { lat: 3.14781, lng: 101.69531 } },
        },
      });

      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      await withMap.close();
    }
  }, 60_000);
});

describe("/health reports the map backend", () => {
  it("says none when no key is configured", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.json().backends.staticMaps).toBe("none");
  });

  it("says configured when one is", async () => {
    const withMap = buildApp({ staticMaps: new StaticMapFetcher({ apiKey: "test-key" }) });
    try {
      const res = await withMap.inject({ method: "GET", url: "/health" });
      expect(res.json().backends.staticMaps).toBe("configured");
    } finally {
      await withMap.close();
    }
  });
});
