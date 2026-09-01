import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveDataDir } from "../dataDir.js";
import type { AmenityLayer, Bounds, NamedPlace } from "./overpass.js";
import { cacheKey } from "./store.js";

/**
 * The bundled amenities snapshot.
 *
 * Overpass is volunteer-run and behaves like it: measured across our four
 * cities in one sitting, one returned everything, one degraded to partial
 * counts, one 504'd and one throttled. Every one of those is fair behaviour
 * from free infrastructure, and none of them is acceptable on a user's first
 * page load.
 *
 * So the cities we ship are answered from a versioned file in the image, the
 * same way district polygons and the population grid already are. Railway
 * stations and universities do not move; this is reference data, not a feed.
 * Runtime Overpass traffic for those cities drops to exactly zero, which is
 * also the most considerate thing we can do with someone else's server.
 *
 * A box we have no snapshot for still falls through to a live fetch, so the
 * feature is not restricted to four cities — it is merely reliable for them.
 */

/**
 * NO "..", even though this file lives one directory deeper than the others.
 *
 * esbuild bundles the whole service into a single `dist/server.js`, so at
 * runtime `import.meta.url` is that file regardless of which source directory
 * the code was written in — `dirname` is always `dist/`, and the data sits at
 * `dist/data`. A `".."` here resolved outside the image's data directory and
 * the snapshot silently failed to load in production while every test passed,
 * because the tests pass `dataDir` explicitly. Matches population.ts.
 */
const DATA_DIR = resolveDataDir(import.meta.url);

interface SeedCity {
  label: string;
  layers: AmenityLayer[];
  places: NamedPlace[];
}

interface SeedFile {
  vintage: string;
  halfSpanDegrees: number;
  cities: Record<string, SeedCity>;
}

export class AmenitiesSeed {
  private constructor(private readonly file: SeedFile) {}

  static async load(dataDir = DATA_DIR): Promise<AmenitiesSeed> {
    const raw = await readFile(join(dataDir, "city-amenities.json"), "utf8");
    const file = JSON.parse(raw) as SeedFile;

    if (!file.cities || Object.keys(file.cities).length === 0) {
      throw new Error("city-amenities.json has no cities.");
    }

    return new AmenitiesSeed(file);
  }

  get cityCount(): number {
    return Object.keys(this.file.cities).length;
  }

  get vintage(): string {
    return this.file.vintage;
  }

  /**
   * Keyed identically to the runtime cache, so the snapshot and a live result
   * are interchangeable for the same box rather than two parallel notions of
   * "this city".
   */
  find(bounds: Bounds): { layers: AmenityLayer[]; places: NamedPlace[]; label: string } | null {
    const city = this.file.cities[cacheKey(bounds)];
    return city ? { layers: city.layers, places: city.places, label: city.label } : null;
  }
}
