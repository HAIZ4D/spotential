import { beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { PopulationGrid } from "../src/population.js";

/** Source runs from src/, the bundle from dist/ — tests point at the real one. */
const DATA_DIR = join(process.cwd(), "services", "simulator", "data");

/**
 * The 400m population grid — the catchment fix.
 *
 * These figures are the whole point of the feature, so they are pinned. The
 * district total for Kuala Lumpur is 2,074,100 people; the real 500m catchment
 * is under seven thousand. Scoring on the former meant scoring on a number
 * nobody could ever serve, and if this data ever silently thins out, the score
 * quietly goes back to being wrong by two orders of magnitude.
 */

let grid: PopulationGrid;

beforeAll(async () => {
  grid = await PopulationGrid.load(DATA_DIR);
}, 60_000);

const CENTRAL_KL = { lat: 3.1478, lng: 101.6953 };
const SUBURBAN_PJ = { lat: 3.0738, lng: 101.5183 };
const KUANTAN = { lat: 3.8077, lng: 103.326 };

describe("the grid loaded intact", () => {
  it("carries the full national hexagon count", () => {
    // 147,936 for Malaysia. A collapsed count means the refresh script shipped
    // a thinner grid, which would understate every catchment silently.
    expect(grid.hexagonCount).toBe(147_936);
  });

  it("declares its source and vintage", () => {
    expect(grid.attribution).toMatch(/Kontur/);
    expect(grid.attribution).toMatch(/CC BY/);
    expect(grid.vintage).toMatch(/^\d{8}$/);
  });
});

describe("catchment population", () => {
  /**
   * Hand-checked against the raw dataset before the lookup existed. Plausible
   * on their face too: a dense city core, a suburb at roughly half, and a
   * smaller east-coast town below both.
   */
  it("reproduces the verified 500m figures", () => {
    expect(grid.catchment(CENTRAL_KL, 500).population).toBe(6_457);
    expect(grid.catchment(SUBURBAN_PJ, 500).population).toBe(3_356);
    expect(grid.catchment(KUANTAN, 500).population).toBe(2_975);
  });

  it("reproduces the verified 1km figures", () => {
    expect(grid.catchment(CENTRAL_KL, 1_000).population).toBe(23_525);
    expect(grid.catchment(SUBURBAN_PJ, 1_000).population).toBe(14_740);
    expect(grid.catchment(KUANTAN, 1_000).population).toBe(11_960);
  });

  it("is nothing like the district total it replaces", () => {
    // The entire reason this exists: 2,074,100 vs 6,717 for the same pin.
    expect(grid.catchment(CENTRAL_KL, 500).population).toBeLessThan(20_000);
  });

  it("grows with radius, never shrinks", () => {
    let previous = 0;
    for (const radius of [250, 500, 1_000, 2_000]) {
      const population = grid.catchment(CENTRAL_KL, radius).population;
      expect(population).toBeGreaterThanOrEqual(previous);
      previous = population;
    }
  });

  it("counts the hexagons it summed, so an empty result is distinguishable", () => {
    const dense = grid.catchment(CENTRAL_KL, 500);
    expect(dense.hexagons).toBeGreaterThan(0);

    // Mid-ocean, well off any coast: genuinely zero, not a lookup failure.
    const sea = grid.catchment({ lat: 2.0, lng: 106.5 }, 500);
    expect(sea.population).toBe(0);
    expect(sea.hexagons).toBe(0);
  });

  /**
   * The test that caught the real flaw here.
   *
   * Counting a hexagon as in or out by its centre made these two points, 16m
   * apart, differ by 73%: a single cell holding 8,482 people sat within 6m of
   * the 1km edge and flipped. Area-weighting each cell by its overlap with the
   * circle is what makes the field continuous. Any regression to a
   * centre-in-or-out test will fail here rather than quietly shipping a
   * catchment that jumps by thousands when a pin is nudged.
   */
  it("is continuous across a bucket seam, not a cliff", () => {
    const onSeam = grid.catchment({ lat: 3.1, lng: 101.7 }, 1_000).population;
    const justInside = grid.catchment({ lat: 3.0999, lng: 101.6999 }, 1_000).population;

    expect(onSeam).toBeGreaterThan(0);
    // 16m apart. Anything beyond a percent or two means the cliff is back.
    expect(Math.abs(onSeam - justInside) / onSeam).toBeLessThan(0.02);
  });

  it("moves smoothly as a pin is dragged", () => {
    // Twenty steps of ~11m each. No single step may jump by a third.
    let previous = grid.catchment({ lat: 3.14, lng: 101.69 }, 500).population;
    for (let step = 1; step <= 20; step += 1) {
      const next = grid.catchment({ lat: 3.14 + step * 0.0001, lng: 101.69 }, 500).population;
      expect(Math.abs(next - previous) / Math.max(previous, 1)).toBeLessThan(0.33);
      previous = next;
    }
  });
});

describe("bounding-box reads for the heatmap", () => {
  it("returns flat lat/lng/population triples", () => {
    const cells = grid.within({ west: 101.65, south: 3.1, east: 101.75, north: 3.2 });

    expect(cells.length % 3).toBe(0);
    expect(cells.length).toBeGreaterThan(300);

    for (let i = 0; i < cells.length; i += 3) {
      expect(cells[i]).toBeGreaterThanOrEqual(3.1);
      expect(cells[i]).toBeLessThanOrEqual(3.2);
      expect(cells[i + 1]).toBeGreaterThanOrEqual(101.65);
      expect(cells[i + 1]).toBeLessThanOrEqual(101.75);
      expect(cells[i + 2]).toBeGreaterThan(0);
    }
  });

  it("returns nothing over open sea rather than failing", () => {
    expect(grid.within({ west: 106, south: 1.5, east: 107, north: 2.5 })).toEqual([]);
  });
});
