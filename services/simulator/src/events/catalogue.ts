import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveDataDir } from "../dataDir.js";
import type { EventListing } from "@spotential/sim-engine";

/**
 * The bundled event catalogue.
 *
 * Versioned reference data shipped inside the image, exactly like the
 * population grid, the district polygons and the amenities snapshot. There is
 * no free events API for Malaysia and the one obvious source disallows the
 * paths that carry booth pricing, so the catalogue is curated rather than
 * fetched — the same house rule the rent benchmarks follow, and for the same
 * reason: no automatable source exists.
 *
 * THESE ARE SAMPLE LISTINGS AND THE UI SAYS SO. They are modelled on real
 * Malaysian event economics — booth prices, slot counts and vendor
 * requirements are realistic — but they are not live bookings, and a vendor
 * must never be led to believe they applied to a real event that does not
 * exist. Every entry carries `source: "seed"`, which the client renders as a
 * visible badge, and the apply flow refuses to send an application anywhere
 * for a sample. Real bookable events arrive through organizer submission and
 * carry `source: "organizer"`.
 */

/**
 * NO "..", for the reason written out in amenities/seed.ts: esbuild bundles
 * the service into one `dist/server.js`, so `import.meta.url` is always that
 * file and the data sits at `dist/data`. A `".."` here would resolve outside
 * the image's data directory and fail silently in production while every test
 * passed, because tests pass `dataDir` explicitly.
 */
const DATA_DIR = resolveDataDir(import.meta.url);

interface CatalogueFile {
  version: number;
  generated: string;
  note: string;
  events: EventListing[];
}

export class EventCatalogue {
  private constructor(private readonly file: CatalogueFile) {}

  static async load(dataDir = DATA_DIR): Promise<EventCatalogue> {
    const raw = await readFile(join(dataDir, "events.json"), "utf8");
    const file = JSON.parse(raw) as CatalogueFile;

    // Fail loudly rather than serving an empty events page that looks like a
    // filter returning nothing. Same posture as the population grid loader.
    if (!Array.isArray(file.events) || file.events.length === 0) {
      throw new Error("events.json contains no events.");
    }

    return new EventCatalogue(file);
  }

  all(): EventListing[] {
    return this.file.events;
  }

  byId(id: string): EventListing | null {
    return this.file.events.find((e) => e.id === id || e.slug === id) ?? null;
  }

  get vintage(): string {
    return this.file.generated;
  }

  get size(): number {
    return this.file.events.length;
  }
}
