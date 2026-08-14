import { cellToBoundary, latLngToCell } from "h3-js";

/**
 * True H3 geometry for the heatmap.
 *
 * The grid file stores only a centroid per hexagon, so the map used to draw
 * SQUARES of equivalent area. That was a deliberate approximation to avoid an
 * H3 dependency, and it cost us twice: it looks like a bar chart rather than a
 * population surface, and sizing the squares at 400m instead of 859m once left
 * a visible gap between every cell.
 *
 * Recovering the real hexagon turns out to be exact rather than approximate.
 * Kontur's cells ARE H3 resolution 8, so `latLngToCell` on the stored centroid
 * returns the original cell — verified across the whole grid: 147,936
 * centroids produce 147,936 DISTINCT cells, with no collisions. Our centroid
 * is the geometry envelope's centre rather than the true centroid, so it
 * drifts by up to 7.7m; a resolution-8 cell is about 460m across, so that is
 * nowhere near enough to land in a neighbour.
 *
 * Hexagons also tile, which squares of hexagon area do not. The seam bug
 * cannot recur by construction.
 */

/** Kontur publishes at H3 resolution 8 — the 400m-edge cell. */
export const H3_RESOLUTION = 8;

/** Coordinates are rounded to ~1m: finer is noise on a 460m cell and costs bytes. */
const VERTEX_DP = 5;

const round = (value: number) => Math.round(value * 10 ** VERTEX_DP) / 10 ** VERTEX_DP;

/**
 * Turn the grid's flat [lat, lng, population, …] triples into drawable cells.
 *
 * Boundaries are emitted as flat [lat, lng, …] pairs for the same reason the
 * grid itself is flat — an array of six `{lat, lng}` objects per cell roughly
 * doubles the JSON for no gain.
 */
export interface HeatmapCell {
  /** Centroid, kept so the client can identify and fly to a cell. */
  lat: number;
  lng: number;
  population: number;
  /** Twelve numbers: six vertices as lat, lng pairs, in ring order. */
  boundary: number[];
}

export function toCells(flatTriples: number[]): HeatmapCell[] {
  const cells: HeatmapCell[] = [];

  for (let i = 0; i < flatTriples.length; i += 3) {
    const lat = flatTriples[i] as number;
    const lng = flatTriples[i + 1] as number;
    const population = flatTriples[i + 2] as number;

    const boundary: number[] = [];
    for (const [vLat, vLng] of cellToBoundary(latLngToCell(lat, lng, H3_RESOLUTION))) {
      boundary.push(round(vLat as number), round(vLng as number));
    }

    cells.push({ lat, lng, population, boundary });
  }

  return cells;
}
