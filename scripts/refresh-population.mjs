#!/usr/bin/env node
/**
 * Regenerate the 400m population grid.
 *
 *   npm run refresh:population
 *
 * WHY THIS EXISTS: until now the only population figure in the app was the
 * DOSM district total — over two million for Kuala Lumpur. A walk-in catchment
 * is nothing like a district, so every panel that showed it had to carry a
 * warning that it must never be multiplied into anything. This dataset gives a
 * real catchment instead: population within 500m of an actual point.
 *
 * Source: Kontur Population, 400m H3 hexagons, CC BY 4.0, via HDX. A fusion of
 * GHSL, Meta, Microsoft Buildings, Copernicus and OpenStreetMap. Free, and the
 * reason the city heatmap costs nothing — competitor data is what bills, and
 * this replaces the demand half of it entirely.
 *
 * NO NEW DEPENDENCIES. The GeoPackage is SQLite, which Node 22 reads natively,
 * and each row's coordinates come from the GeoPackage envelope header rather
 * than from parsing WKB geometry or resolving H3 indices.
 *
 * Fails loudly on anything unexpected, exactly like refresh:demographics: a
 * schema change or a collapsed row count must stop the build rather than
 * quietly shipping a thinner map.
 */

import { DatabaseSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "services", "simulator", "data");
const OUT_FILE = join(OUT_DIR, "population-hexagons.json");

const VINTAGE = "20231101";
const SOURCE_URL =
  `https://geodata-eu-central-1-kontur-public.s3.amazonaws.com/kontur_datasets/kontur_population_MY_${VINTAGE}.gpkg.gz`;
const ATTRIBUTION = "Kontur Population (CC BY 4.0), via HDX";

/**
 * Sanity bounds. Malaysia's population is about 34 million; anything far from
 * that means the upstream file changed shape and the output should not ship.
 */
const EXPECT_POPULATION = [30_000_000, 40_000_000];
const EXPECT_ROWS = [100_000, 250_000];

/** Rough 11km buckets. A 1km catchment touches at most four of them. */
const BUCKET_DEGREES = 0.1;

/** ~11m. Meaningless precision below that for a 400m hexagon. */
const COORD_DP = 4;

/**
 * Centre of a GeoPackage feature, straight out of the binary header.
 *
 * Layout: "GP", version, flags, srs_id (4 bytes), then the envelope as
 * doubles. Flag bits 1–3 give the envelope type — 1 means [minX, maxX, minY,
 * maxY] — and bit 0 gives endianness. Reading the envelope avoids pulling in a
 * WKB parser or an H3 library for something this simple.
 */
function centreOf(blob) {
  const b = Buffer.from(blob);
  if (b[0] !== 0x47 || b[1] !== 0x50) return null; // not "GP"

  const flags = b[3];
  if (((flags >> 1) & 0x07) !== 1) return null; // no XY envelope
  const little = (flags & 1) === 1;
  const read = (offset) => (little ? b.readDoubleLE(offset) : b.readDoubleBE(offset));

  const x = (read(8) + read(16)) / 2;
  const y = (read(24) + read(32)) / 2;

  // EPSG:3857 -> WGS84.
  const lng = (x / 20037508.34) * 180;
  const mercatorLat = (y / 20037508.34) * 180;
  const lat =
    (180 / Math.PI) * (2 * Math.atan(Math.exp((mercatorLat * Math.PI) / 180)) - Math.PI / 2);

  return { lat, lng };
}

const round = (value, dp) => Number(value.toFixed(dp));

async function main() {
  const cached = process.argv.includes("--gpkg")
    ? process.argv[process.argv.indexOf("--gpkg") + 1]
    : null;

  const scratch = join(tmpdir(), `kontur-${VINTAGE}.gpkg`);
  let gpkgPath = cached;

  if (!gpkgPath) {
    process.stdout.write(`Fetching ${SOURCE_URL}\n`);
    const response = await fetch(SOURCE_URL);
    if (!response.ok) {
      throw new Error(`Kontur download failed: ${response.status} ${response.statusText}`);
    }
    const gz = Buffer.from(await response.arrayBuffer());
    await writeFile(scratch, gunzipSync(gz));
    gpkgPath = scratch;
    process.stdout.write(`  ${(gz.length / 1048576).toFixed(1)} MB compressed\n`);
  }

  const db = new DatabaseSync(gpkgPath, { readOnly: true });

  const columns = db
    .prepare("pragma table_info(population)")
    .all()
    .map((c) => c.name);
  for (const required of ["geom", "population"]) {
    if (!columns.includes(required)) {
      throw new Error(
        `Kontur schema changed: expected a "${required}" column, found [${columns.join(", ")}]. ` +
          `Check the dataset before regenerating.`,
      );
    }
  }

  const rows = db.prepare("select population, geom from population").all();
  if (rows.length < EXPECT_ROWS[0] || rows.length > EXPECT_ROWS[1]) {
    throw new Error(
      `Expected ${EXPECT_ROWS[0].toLocaleString()}–${EXPECT_ROWS[1].toLocaleString()} hexagons, ` +
        `got ${rows.length.toLocaleString()}. Refusing to ship a grid this different.`,
    );
  }

  /** bucket key -> flat [lat, lng, population, ...]. Flat to keep the file small. */
  const buckets = {};
  let total = 0;
  let undecodable = 0;

  for (const row of rows) {
    const centre = centreOf(row.geom);
    if (!centre) {
      undecodable += 1;
      continue;
    }

    const population = Math.round(row.population);
    if (population <= 0) continue;

    total += population;

    const key = `${Math.floor(centre.lat / BUCKET_DEGREES)},${Math.floor(centre.lng / BUCKET_DEGREES)}`;
    (buckets[key] ??= []).push(
      round(centre.lat, COORD_DP),
      round(centre.lng, COORD_DP),
      population,
    );
  }

  if (undecodable > 0) {
    throw new Error(
      `${undecodable} hexagons had an unreadable geometry header. The GeoPackage encoding ` +
        `changed; the envelope shortcut in centreOf() needs revisiting.`,
    );
  }

  if (total < EXPECT_POPULATION[0] || total > EXPECT_POPULATION[1]) {
    throw new Error(
      `Total population ${total.toLocaleString()} is outside the expected ` +
        `${EXPECT_POPULATION[0].toLocaleString()}–${EXPECT_POPULATION[1].toLocaleString()}. ` +
        `Verify the source before shipping.`,
    );
  }

  const output = {
    source: SOURCE_URL,
    attribution: ATTRIBUTION,
    licence: "CC BY 4.0",
    vintage: VINTAGE,
    fetched: new Date().toISOString().slice(0, 10),
    hexagonEdgeMetres: 400,
    bucketDegrees: BUCKET_DEGREES,
    totalPopulation: total,
    hexagons: rows.length,
    /** Flat triples per bucket: lat, lng, population. */
    buckets,
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(output));

  const bytes = JSON.stringify(output).length;
  process.stdout.write(
    `\nWrote ${OUT_FILE}\n` +
      `  ${rows.length.toLocaleString()} hexagons in ${Object.keys(buckets).length} buckets\n` +
      `  ${total.toLocaleString()} people\n` +
      `  ${(bytes / 1048576).toFixed(1)} MB\n`,
  );

  if (!cached) await rm(scratch, { force: true });
}

main().catch((error) => {
  process.stderr.write(`\nrefresh:population failed\n  ${error.message}\n`);
  process.exitCode = 1;
});
