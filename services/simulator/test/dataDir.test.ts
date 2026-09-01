import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveDataDir } from "../src/dataDir.js";
import { EventCatalogue } from "../src/events/catalogue.js";
import { AmenitiesSeed } from "../src/amenities/seed.js";

/**
 * The reference data has to resolve in BOTH run modes.
 *
 * Production runs a single bundled `dist/server.js` with `data/` copied beside
 * it; `npm run dev:service` runs the real source tree under tsx. A path
 * correct for one is wrong for the other, and the existing tests never caught
 * it because they all pass `dataDir` explicitly — so the loaders were only
 * ever exercised on a path the app itself does not use.
 *
 * These call them with NO argument, which is how the server calls them.
 */
describe("reference data resolution", () => {
  it("finds the data directory from a source-tree module", () => {
    const dir = resolveDataDir(import.meta.url);
    expect(existsSync(dir), `resolved to ${dir}`).toBe(true);
    expect(existsSync(join(dir, "events.json"))).toBe(true);
    expect(existsSync(join(dir, "population-hexagons.json"))).toBe(true);
    expect(existsSync(join(dir, "city-amenities.json"))).toBe(true);
  });

  it("loads the event catalogue with no explicit path", async () => {
    // The failure this guards showed up as `events: none` on /health and
    // "Could not load events" on the page, with the server otherwise fine.
    const catalogue = await EventCatalogue.load();
    expect(catalogue.size).toBeGreaterThan(0);
  });

  it("loads the amenities snapshot with no explicit path", async () => {
    const seed = await AmenitiesSeed.load();
    expect(seed.cityCount).toBeGreaterThan(0);
  });

  it("prefers a directory beside the entrypoint over any walk upward", () => {
    /**
     * The order matters and is not cosmetic. In the bundle `dist/data` exists
     * and must win outright — walking up from there would eventually find the
     * SOURCE `data/`, which in a deployed image is not present at all and on a
     * developer machine would silently serve a different copy than the build.
     */
    const dir = resolveDataDir(import.meta.url);
    expect(dir.endsWith("data")).toBe(true);
  });
});
