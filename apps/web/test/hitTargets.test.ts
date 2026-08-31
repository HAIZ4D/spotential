import { describe, expect, it } from "vitest";
import { hitTargetOptions, pathFor } from "../src/components/heatmap/HexLayer.js";
import type { HeatmapCell } from "../src/lib/api.js";

/**
 * The invisible hit targets.
 *
 * Once HeatLayer paints a smooth surface, these hexagons exist for one reason:
 * a gradient has nothing discrete to click, and the inspector is the page's
 * most useful part. They must therefore be completely invisible and completely
 * clickable at the same time.
 *
 * This is asserted in a unit test rather than an E2E because CI blocks Google
 * Maps outright, so no polygon is ever constructed in the browser — an E2E
 * "check" here would pass over an empty list and prove nothing.
 */

const cell: HeatmapCell = {
  lat: 3.1464,
  lng: 101.687,
  population: 9_800,
  boundary: [3.14875, 101.69105, 3.1511, 101.687, 3.14875, 101.68295],
};

describe("hit targets are invisible", () => {
  it("draws no fill at all", () => {
    // The regression that would undo the entire redesign: a nonzero fill tiles
    // hard-edged hexagons straight back over the smooth surface.
    expect(hitTargetOptions(cell, false).fillOpacity).toBe(0);
    expect(hitTargetOptions(cell, true).fillOpacity).toBe(0);
  });

  it("draws no outline unless the cell is the selected one", () => {
    const idle = hitTargetOptions(cell, false);
    expect(idle.strokeOpacity).toBe(0);
    expect(idle.strokeWeight).toBe(0);

    // The one exception, so you can see which cell the inspector describes.
    const selected = hitTargetOptions(cell, true);
    expect(selected.strokeOpacity).toBe(1);
    expect(selected.strokeWeight).toBeGreaterThan(0);
  });

  it("stays clickable, which is the only reason it exists", () => {
    expect(hitTargetOptions(cell, false).clickable).toBe(true);
  });

  it("lifts the selected cell above its neighbours", () => {
    const selected = hitTargetOptions(cell, true).zIndex as number;
    const idle = hitTargetOptions(cell, false).zIndex as number;
    expect(selected).toBeGreaterThan(idle);
  });
});

describe("pathFor", () => {
  it("unpacks the flat lat/lng boundary the API sends", () => {
    expect(pathFor([1, 2, 3, 4])).toEqual([
      { lat: 1, lng: 2 },
      { lat: 3, lng: 4 },
    ]);
  });

  it("keeps the real hexagon geometry, not a bounding shape", () => {
    // Six vertices in, six out — squares of equivalent area once left a
    // visible gap between every cell.
    const six = pathFor(cell.boundary);
    expect(six).toHaveLength(cell.boundary.length / 2);
    expect(six[0]).toEqual({ lat: 3.14875, lng: 101.69105 });
  });

  it("returns nothing for an empty boundary rather than throwing", () => {
    // Ranked-area selection synthesises a cell with `boundary: []`.
    expect(pathFor([])).toEqual([]);
  });
});
