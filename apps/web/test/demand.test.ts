import { describe, expect, it } from "vitest";
import {
  DEMAND_VIEW_METRES,
  GRID_PAD,
  amenityBoxFor,
  canFetchAmenities,
  canFetchGrid,
  cellAt,
  cellsWithin,
  demandBounds,
  framingRadius,
} from "../src/lib/demand.js";
import { INFLUENCE_METRES } from "../src/components/heatmap/HeatLayer.js";

/**
 * The population surface on the Location map.
 *
 * The framing is the part that can go wrong invisibly. At the search framing
 * the surface is a flat wash — a 500m circle spans about one and a half Kontur
 * cells and the kernel smooths over more than the whole frame — so it renders
 * as a coloured filter that looks deliberate and means nothing. These pin the
 * two numbers that stop that, and the single-owner rule that stops the surface
 * and the radius control racing for the camera.
 */

/** Kontur res-8: 400m edge, so centres sit edge·√3 apart. */
const CELL_SPACING_M = 400 * Math.sqrt(3);

describe("the widened framing", () => {
  it("shows enough cells for the surface to have shape", () => {
    const across = (2 * DEMAND_VIEW_METRES) / CELL_SPACING_M;
    // Under about four and the blur has nothing to vary against.
    expect(across).toBeGreaterThan(6);
  });

  it("is wider than the kernel, which the search framing is not", () => {
    // The failure this guards: a viewport narrower than the smoothing radius
    // cannot show a gradient, only a tint.
    expect(2 * DEMAND_VIEW_METRES).toBeGreaterThan(2 * INFLUENCE_METRES);

    const searchFrame = 2 * 500;
    expect(searchFrame).toBeLessThan(INFLUENCE_METRES);
  });
});

describe("one owner for the camera", () => {
  it("hands back the search radius when the layer is off", () => {
    for (const r of [250, 500, 1000, 2000]) {
      expect(framingRadius(r, false)).toBe(r);
    }
  });

  it("hands back the same widened radius whatever the search radius", () => {
    // Both "on" states must frame identically, or toggling at one radius
    // would land somewhere different than toggling at another.
    const seen = new Set([250, 500, 1000, 2000].map((r) => framingRadius(r, true)));
    expect(seen.size).toBe(1);
    expect([...seen][0]).toBe(DEMAND_VIEW_METRES);
  });
});

describe("the fetch box", () => {
  const KL = { lat: 3.1478, lng: 101.6953 };

  it("reaches past the frame so the blur's edge falls off screen", () => {
    const b = demandBounds(KL);
    const northSpanM = (b.north - KL.lat) * 110_574;
    expect(Math.round(northSpanM)).toBe(Math.round(DEMAND_VIEW_METRES * GRID_PAD));
    expect(northSpanM).toBeGreaterThan(DEMAND_VIEW_METRES);
  });

  it("is centred on the point", () => {
    const b = demandBounds(KL);
    expect((b.north + b.south) / 2).toBeCloseTo(KL.lat, 9);
    expect((b.east + b.west) / 2).toBeCloseTo(KL.lng, 9);
  });

  it("widens in longitude away from the equator, not narrows", () => {
    /**
     * Longitude degrees shrink toward the poles, so a box built from a fixed
     * degree span covers less ground the further north you go. The correction
     * is what keeps the fetched area the same size everywhere.
     */
    const equator = demandBounds({ lat: 0, lng: 101 });
    const north = demandBounds({ lat: 55, lng: 101 });
    expect(north.east - 101).toBeGreaterThan(equator.east - 101);
  });

  it("cannot ask for the whole planet at a nonsensical latitude", () => {
    // cos(90°) is 0, and an unclamped divide would return Infinity.
    const polar = demandBounds({ lat: 90, lng: 101 });
    expect(Number.isFinite(polar.east)).toBe(true);
    expect(polar.east - polar.west).toBeLessThan(1);
  });
});

describe("the cell a point falls in", () => {
  /**
   * Nearest CENTROID, and that is exact rather than an approximation: a
   * hexagonal grid is the Voronoi tessellation of its own centroids, so every
   * point inside a hexagon is closer to that hexagon's centre than to any
   * other. The design turns on this — the inspector follows the pin instead of
   * a click, because a click already moves the pin.
   */
  const SPACING_DEG = (400 * Math.sqrt(3)) / 110_574;

  const grid = [
    { lat: 3.14, lng: 101.69, population: 100 },
    { lat: 3.14 + SPACING_DEG, lng: 101.69, population: 200 },
    { lat: 3.14, lng: 101.69 + SPACING_DEG, population: 300 },
  ];

  it("returns the cell the point sits on", () => {
    expect(cellAt(grid, { lat: 3.14, lng: 101.69 })?.population).toBe(100);
    expect(cellAt(grid, { lat: 3.14 + SPACING_DEG, lng: 101.69 })?.population).toBe(200);
  });

  it("picks the nearer centroid just either side of a boundary", () => {
    // The midpoint belongs to whichever side the point falls on, and a nudge
    // across it must flip the answer — that is the whole behaviour.
    const justBelow = { lat: 3.14 + SPACING_DEG * 0.49, lng: 101.69 };
    const justAbove = { lat: 3.14 + SPACING_DEG * 0.51, lng: 101.69 };
    expect(cellAt(grid, justBelow)?.population).toBe(100);
    expect(cellAt(grid, justAbove)?.population).toBe(200);
  });

  it("returns null on an empty grid rather than inventing a cell", () => {
    // "No data here" and "nobody lives here" are different statements and must
    // not render alike.
    expect(cellAt([], { lat: 3.14, lng: 101.69 })).toBeNull();
  });
});

describe("what the panel is allowed to count", () => {
  const view = { west: 101.6, south: 3.1, east: 101.7, north: 3.2 };

  it("excludes cells outside the visible box", () => {
    /**
     * The grid is deliberately fetched past the frame so the blur has no
     * visible edge. Counting that padding would make every figure describe a
     * bigger area than the one on screen — the same trap the heatmap page
     * already avoids with `cellsInView`.
     */
    const cells = [
      { lat: 3.15, lng: 101.65, population: 1 },
      { lat: 3.25, lng: 101.65, population: 2 },
      { lat: 3.15, lng: 101.9, population: 3 },
    ];
    expect(cellsWithin(cells, view).map((c) => c.population)).toEqual([1]);
  });
});

describe("what may be asked of each endpoint", () => {
  const box = (span: number) => ({ west: 101, south: 3, east: 101 + span, north: 3 + span });

  it("knows the two caps are different", () => {
    // /v1/heatmap accepts 1.5 degrees; /v1/amenities only 0.3. Firing past
    // either spends a round trip to be told 400.
    expect(canFetchGrid(box(1.4))).toBe(true);
    expect(canFetchGrid(box(1.6))).toBe(false);
    expect(canFetchAmenities(box(0.2))).toBe(true);
    expect(canFetchAmenities(box(0.4))).toBe(false);
  });

  it("snaps a city view to the seeded box, so the snapshot is hit", () => {
    /**
     * The store keys its cache on the box rounded to two decimals, so an
     * arbitrary viewport misses every time and falls through to a live
     * Overpass call — measured across these four cities as one full answer,
     * one partial, one 504 and one throttle. Snapping is what keeps the
     * shipped cities instant.
     */
    const nearKl = { west: 101.68, south: 3.13, east: 101.7, north: 3.15 };
    const snapped = amenityBoxFor(nearKl);
    expect(snapped.west.toFixed(2)).toBe("101.63");
    expect(snapped.south.toFixed(2)).toBe("3.08");
    expect(snapped.east.toFixed(2)).toBe("101.74");
    expect(snapped.north.toFixed(2)).toBe("3.19");
  });

  it("passes an unseeded view straight through", () => {
    // The feature is not restricted to four cities; it is merely reliable there.
    const remote = { west: 117.0, south: 5.9, east: 117.1, north: 6.0 };
    expect(amenityBoxFor(remote)).toEqual(remote);
  });
});
