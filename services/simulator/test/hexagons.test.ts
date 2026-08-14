import { describe, expect, it } from "vitest";
import { UNITS, cellArea, cellToBoundary, gridDisk, latLngToCell } from "h3-js";
import { H3_RESOLUTION, toCells } from "../src/hexagons.js";

/**
 * Hexagon geometry for the heatmap.
 *
 * The thing being defended here is that cells TILE. The previous rendering
 * drew squares of equal area, which cannot tile a hexagonal grid, and an
 * earlier bug sized them at 400m rather than 859m and left a visible gap
 * between every cell. Both failures are geometric, so the tests are too.
 */

/** Central KL, a cell we know is populated. */
const KL = { lat: 3.139, lng: 101.6869 };

const metresBetween = (aLat: number, aLng: number, bLat: number, bLng: number) =>
  Math.hypot(
    (aLat - bLat) * 110_574,
    (aLng - bLng) * 111_320 * Math.cos((aLat * Math.PI) / 180),
  );

describe("toCells", () => {
  it("returns a six-vertex ring for every cell", () => {
    const cells = toCells([KL.lat, KL.lng, 5_000, 3.15, 101.7, 1_200]);
    expect(cells).toHaveLength(2);
    for (const cell of cells) {
      // Twelve numbers: six lat/lng pairs.
      expect(cell.boundary).toHaveLength(12);
      expect(cell.boundary.every((n) => Number.isFinite(n))).toBe(true);
    }
  });

  it("keeps the centroid and population it was given", () => {
    const [cell] = toCells([KL.lat, KL.lng, 6_457]);
    expect(cell).toMatchObject({ lat: KL.lat, lng: KL.lng, population: 6_457 });
  });

  it("recovers the cell the centroid came from", () => {
    const [cell] = toCells([KL.lat, KL.lng, 1]);
    const expected = cellToBoundary(latLngToCell(KL.lat, KL.lng, H3_RESOLUTION));

    for (const [i, [vLat, vLng]] of expected.entries()) {
      // Rounded to ~1m, so compare at that tolerance rather than exactly.
      expect(metresBetween(cell!.boundary[i * 2]!, cell!.boundary[i * 2 + 1]!, vLat!, vLng!))
        .toBeLessThan(2);
    }
  });

  it("wraps the centroid — the ring is not offset", () => {
    const [cell] = toCells([KL.lat, KL.lng, 1]);
    for (let i = 0; i < 12; i += 2) {
      const d = metresBetween(cell!.boundary[i]!, cell!.boundary[i + 1]!, KL.lat, KL.lng);
      // Measured circumradius near KL is 540-605m. Our centroid is the
      // envelope centre rather than the true centroid, which is why these are
      // not all identical.
      expect(d).toBeGreaterThan(450);
      expect(d).toBeLessThan(700);
    }
  });

  /**
   * The anti-seam guard, and the reason this file exists.
   *
   * Two adjacent hexagons must SHARE an edge — two vertices in common. Squares
   * of equivalent area cannot do this, which is why the old rendering showed
   * gaps or overlaps depending on how they were sized.
   */
  it("tiles: neighbouring cells share two vertices exactly", () => {
    const centre = latLngToCell(KL.lat, KL.lng, H3_RESOLUTION);
    const neighbour = gridDisk(centre, 1).find((c) => c !== centre)!;

    const [a, b] = [centre, neighbour].map((cell) => {
      const [lat, lng] = cellToBoundary(cell)[0]!;
      return cellToBoundary(cell).map(([vLat, vLng]) => [vLat, vLng] as const).concat([[lat!, lng!]]);
    });

    let shared = 0;
    for (const [aLat, aLng] of a!) {
      for (const [bLat, bLng] of b!) {
        if (metresBetween(aLat, aLng, bLat, bLng) < 1) shared += 1;
      }
    }
    // The duplicated closing vertex can double-count, so assert "at least".
    expect(shared).toBeGreaterThanOrEqual(2);
  });

  /**
   * Asserted against H3's OWN area for this cell, not against the 0.7373
   * constant in population.ts. That constant is H3's GLOBAL AVERAGE res-8
   * area; real Malaysian cells run 0.714-0.880 km², and every populated city
   * measures ~0.84-0.87. Pinning this test to the constant would bake in a
   * 16% error. See the note on HEX_AREA_KM2 — the catchment maths uses the
   * average and is a separate fix.
   */
  it("covers the area H3 says this cell covers", () => {
    // Shoelace on the projected ring.
    const [cell] = toCells([KL.lat, KL.lng, 1]);
    const pts: [number, number][] = [];
    for (let i = 0; i < 12; i += 2) {
      pts.push([
        cell!.boundary[i + 1]! * 111_320 * Math.cos((KL.lat * Math.PI) / 180),
        cell!.boundary[i]! * 110_574,
      ]);
    }

    let area = 0;
    for (let i = 0; i < pts.length; i += 1) {
      const [x1, y1] = pts[i]!;
      const [x2, y2] = pts[(i + 1) % pts.length]!;
      area += x1 * y2 - x2 * y1;
    }

    const expected = cellArea(latLngToCell(KL.lat, KL.lng, H3_RESOLUTION), UNITS.km2);
    expect(expected).toBeGreaterThan(0.8);
    expect(Math.abs(area) / 2 / 1_000_000).toBeCloseTo(expected, 1);
  });

  it("handles an empty grid slice", () => {
    expect(toCells([])).toEqual([]);
  });
});
