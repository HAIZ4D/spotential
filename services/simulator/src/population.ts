import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveDataDir } from "./dataDir.js";
import { distanceMetres, type LatLng } from "@spotential/sim-engine";

/**
 * Catchment population — the 400m grid.
 *
 * THE PROBLEM THIS SOLVES: the only population figure the app had was the DOSM
 * district total. Kuala Lumpur district is over two million people; a walk-in
 * catchment is nothing like that, so every panel showing it had to warn that
 * it must never be multiplied into anything. Getting that wrong by two orders
 * of magnitude, next to a break-even calculator, is exactly the error this
 * product cannot afford.
 *
 * Kontur's 400m hexagons give a real answer instead: the population actually
 * within 500m of a point. Free, CC BY, and nationwide — which is also why the
 * city heatmap costs nothing.
 *
 * Loaded once per instance. Bucketed on an ~11km grid so a catchment query
 * scans a few hundred hexagons rather than 147,936.
 */

const DATA_DIR = resolveDataDir(import.meta.url);

export interface Catchment {
  radiusMetres: number;
  population: number;
  /** Hexagons contributing any area. Zero means genuinely empty, not a lookup miss. */
  hexagons: number;
}

/**
 * H3 resolution 8: mean cell area 0.7373 km².
 *
 * Kontur's "400m" is the hexagon EDGE, not its width — which matters more than
 * it sounds. A 500m circle is 0.785 km², so it holds roughly ONE cell. Counting
 * a hexagon as in or out by whether its centre falls inside therefore makes the
 * answer lurch by thousands of people as a single cell crosses the boundary:
 * two points 16m apart in central KL differed by 73%.
 */
/**
 * KNOWN INACCURACY, measured 2026-08-14 and deliberately not yet changed.
 *
 * This is H3's GLOBAL AVERAGE resolution-8 area. Real cells vary: across
 * Malaysia they run 0.714-0.880 km², and every populated city measures around
 * 0.84-0.87 — so this constant is about 16% too small where it actually gets
 * used. The equal-area radius below is therefore ~484m when the true figure
 * near KL is ~523m.
 *
 * Not corrected here because the fix is not local. CATCHMENT_DECILES in
 * score.ts were measured through this same code, so catchments and the
 * percentile scale are currently self-consistent; changing the constant alone
 * would shift every published catchment figure while leaving the deciles
 * describing the old distribution. Fixing it properly means recomputing the
 * deciles and re-publishing the scores in one deliberate change — exactly the
 * "adding a dimension silently reprices the others" trap.
 *
 * The heatmap does NOT use this constant: it draws true per-cell H3 geometry
 * via hexagons.ts, and a test there pins the real area.
 */
const HEX_AREA_KM2 = 0.7373275975;

/** Radius of the equal-area circle, in metres. Hexagons are close enough to round. */
const HEX_RADIUS_M = Math.sqrt((HEX_AREA_KM2 * 1_000_000) / Math.PI);

/**
 * Overlap area of two circles — the weighting that smooths the above.
 *
 * Treating each hexagon as an equal-area circle gives a closed form, and the
 * shape error is far smaller than the error it replaces: a hexagon and its
 * equal-area circle differ by a few percent at the rim, against an all-or-
 * nothing decision on a cell holding thousands of people.
 */
function circleOverlap(d: number, r1: number, r2: number): number {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;

  const a1 = r1 ** 2 * Math.acos((d ** 2 + r1 ** 2 - r2 ** 2) / (2 * d * r1));
  const a2 = r2 ** 2 * Math.acos((d ** 2 + r2 ** 2 - r1 ** 2) / (2 * d * r2));
  const lens =
    0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));

  return a1 + a2 - lens;
}

interface PopulationFile {
  attribution: string;
  licence: string;
  vintage: string;
  hexagonEdgeMetres: number;
  bucketDegrees: number;
  totalPopulation: number;
  hexagons: number;
  buckets: Record<string, number[]>;
}

export class PopulationGrid {
  private constructor(private file: PopulationFile) {}

  static async load(dataDir = DATA_DIR): Promise<PopulationGrid> {
    const raw = await readFile(join(dataDir, "population-hexagons.json"), "utf8");
    const file = JSON.parse(raw) as PopulationFile;

    if (!file.buckets || typeof file.bucketDegrees !== "number") {
      throw new Error("population-hexagons.json is missing its bucket index.");
    }

    return new PopulationGrid(file);
  }

  get vintage(): string {
    return this.file.vintage;
  }

  get attribution(): string {
    return this.file.attribution;
  }

  get hexagonCount(): number {
    return this.file.hexagons;
  }

  /**
   * Population within `radiusMetres` of a point.
   *
   * AREA-WEIGHTED, not centre-in-or-out: each hexagon contributes the share of
   * its people that its overlap with the circle implies. Population is assumed
   * uniform inside a 0.74 km² cell, which is the honest limit of this data —
   * the UI presents the result as an estimate rather than a count.
   */
  catchment(point: LatLng, radiusMetres: number): Catchment {
    const step = this.file.bucketDegrees;

    // Reach a hexagon-radius further out: a cell centred beyond the circle can
    // still have part of itself inside it.
    const reach = radiusMetres + HEX_RADIUS_M;

    // Degrees of longitude shrink with latitude; at 7°N that is about 0.7%,
    // so a fixed margin would be wrong near the equator in the other
    // direction. Derive it instead.
    const latMargin = reach / 110_574;
    const lngMargin = reach / (111_320 * Math.cos((point.lat * Math.PI) / 180));

    const minLat = Math.floor((point.lat - latMargin) / step);
    const maxLat = Math.floor((point.lat + latMargin) / step);
    const minLng = Math.floor((point.lng - lngMargin) / step);
    const maxLng = Math.floor((point.lng + lngMargin) / step);

    let population = 0;
    let hexagons = 0;

    for (let lat = minLat; lat <= maxLat; lat += 1) {
      for (let lng = minLng; lng <= maxLng; lng += 1) {
        const flat = this.file.buckets[`${lat},${lng}`];
        if (!flat) continue;

        // Flat triples: lat, lng, population.
        for (let i = 0; i < flat.length; i += 3) {
          const centre = { lat: flat[i] as number, lng: flat[i + 1] as number };
          const d = distanceMetres(point, centre);
          if (d >= reach) continue;

          const share = circleOverlap(d, radiusMetres, HEX_RADIUS_M) / (Math.PI * HEX_RADIUS_M ** 2);
          if (share <= 0) continue;

          population += (flat[i + 2] as number) * share;
          hexagons += 1;
        }
      }
    }

    return { radiusMetres, population: Math.round(population), hexagons };
  }

  /**
   * Every hexagon inside a bounding box — the heatmap's only data source.
   *
   * Returns tuples rather than objects: a city view is tens of thousands of
   * hexagons and the difference shows up in both the payload and the parse.
   */
  within(box: { west: number; south: number; east: number; north: number }): number[] {
    const step = this.file.bucketDegrees;
    const out: number[] = [];

    for (let lat = Math.floor(box.south / step); lat <= Math.floor(box.north / step); lat += 1) {
      for (let lng = Math.floor(box.west / step); lng <= Math.floor(box.east / step); lng += 1) {
        const flat = this.file.buckets[`${lat},${lng}`];
        if (!flat) continue;

        for (let i = 0; i < flat.length; i += 3) {
          const hexLat = flat[i] as number;
          const hexLng = flat[i + 1] as number;
          if (
            hexLat >= box.south &&
            hexLat <= box.north &&
            hexLng >= box.west &&
            hexLng <= box.east
          ) {
            out.push(hexLat, hexLng, flat[i + 2] as number);
          }
        }
      }
    }

    return out;
  }
}
