#!/usr/bin/env node
/**
 * Regenerate the demographic reference data.
 *
 *   npm run refresh:demographics
 *
 * DOSM republishes population annually, so this is a reproducible script
 * rather than hand-copied numbers. Both outputs carry their source URL and the
 * date they were fetched, per the CLAUDE.md rule that reference values live as
 * versioned constants with provenance.
 *
 * There is deliberately no DOSM API. DOSM states the population catalogue is
 * "unsuitable for API access" and ships CSV instead — which suits us: no
 * runtime dependency, and the numbers are pinned in git.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "services", "simulator", "data");

const POPULATION_CSV = "https://storage.dosm.gov.my/population/population_district.csv";
const BOUNDARIES_GEOJSON =
  "https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09/releaseData/gbOpen/MYS/ADM2/geoBoundaries-MYS-ADM2_simplified.geojson";

/**
 * geoBoundaries spells seven districts differently from DOSM. Committed
 * explicitly rather than fuzzy-matched, so a genuine future rename shows up as
 * a failure instead of being silently absorbed by a similarity threshold.
 *
 * Keyed by the BOUNDARY name, valued by the DOSM name.
 */
const NAME_ALIASES = {
  "Seberang Perai Utara": "Sp Utara",
  "Seberang Perai Tengah": "Sp Tengah",
  "Seberang Perai Selatan": "Sp Selatan",
  "Cameron Highlands": "Cameron Highland",
  Ledang: "Tangkak",
  Kulaijaya: "Kulai",
  "Nabawan / Persiangan": "Nabawan",
};

/**
 * Districts DOSM has population for but geoBoundaries has no polygon for.
 * Putrajaya is a federal territory enclosed by Sepang, so a pin there resolves
 * to Sepang. Recorded rather than left as a silent wrong answer.
 */
const KNOWN_MISSING_BOUNDARIES = ["W.P. Putrajaya"];

/** Guards against a silent upstream change. Update deliberately, never to make it pass. */
const EXPECTED = {
  districts: 160,
  boundaryFeatures: 159,
  unmatchedBoundaries: 0,
  unmatchedDistricts: KNOWN_MISSING_BOUNDARIES.length,
};

const normalise = (name) =>
  name
    .toLowerCase()
    .replace(/^w\.p\.\s*/, "")
    .replace(/[^a-z]/g, "");

async function fetchText(url, label) {
  process.stdout.write(`fetching ${label}… `);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  const text = await response.text();
  console.log(`${(text.length / 1024 / 1024).toFixed(2)} MB`);
  return text;
}

function parsePopulation(csv) {
  const [header, ...lines] = csv.trim().split("\n");
  const cols = header.split(",");
  const idx = Object.fromEntries(cols.map((c, i) => [c.trim(), i]));

  const rows = lines.map((l) => l.split(","));
  const latest = rows.map((r) => r[idx["date"]]).sort().at(-1);
  console.log(`  latest year in data: ${latest}`);

  const districts = {};
  for (const row of rows) {
    if (row[idx["date"]] !== latest || row[idx["sex"]] !== "both") continue;

    const state = row[idx["state"]];
    const district = row[idx["district"]];
    const age = row[idx["age"]];
    const ethnicity = row[idx["ethnicity"]];
    // DOSM publishes population in THOUSANDS. Converted once, here, so no
    // consumer has to remember.
    const people = Math.round(Number(row[idx["population"]]) * 1000);
    if (!Number.isFinite(people)) continue;

    const key = district;
    districts[key] ??= { district, state, total: 0, age: {}, ethnicity: {} };

    if (ethnicity === "overall" && age === "overall") districts[key].total = people;
    else if (ethnicity === "overall") districts[key].age[age] = people;
    else if (age === "overall") districts[key].ethnicity[ethnicity] = people;
  }

  return { districts, vintage: latest.slice(0, 4) };
}

function checkNames(districts, features) {
  const dosmByNorm = new Map(Object.keys(districts).map((d) => [normalise(d), d]));
  const geoByNorm = new Map();

  const resolved = {};
  const unmatchedBoundaries = [];

  for (const feature of features) {
    const boundaryName = feature.properties.shapeName;
    const target = NAME_ALIASES[boundaryName] ?? boundaryName;
    const match = dosmByNorm.get(normalise(target));

    geoByNorm.set(normalise(target), boundaryName);
    if (match) resolved[boundaryName] = match;
    else unmatchedBoundaries.push(boundaryName);
  }

  const unmatchedDistricts = Object.keys(districts).filter((d) => !geoByNorm.has(normalise(d)));

  return { resolved, unmatchedBoundaries, unmatchedDistricts };
}

function assertExpected(actual) {
  const problems = [];
  for (const [key, expected] of Object.entries(EXPECTED)) {
    if (actual[key] !== expected) {
      problems.push(`  ${key}: expected ${expected}, got ${actual[key]}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      "Upstream data changed shape:\n" +
        problems.join("\n") +
        "\n\nThis is a real signal, not a nuisance. Check whether DOSM renamed a " +
        "district or geoBoundaries changed its feature set, then update " +
        "NAME_ALIASES and EXPECTED together — deliberately.",
    );
  }
}

const [csv, geojsonText] = await Promise.all([
  fetchText(POPULATION_CSV, "DOSM population"),
  fetchText(BOUNDARIES_GEOJSON, "geoBoundaries ADM2"),
]);

const { districts, vintage } = parsePopulation(csv);
const geojson = JSON.parse(geojsonText);
const { resolved, unmatchedBoundaries, unmatchedDistricts } = checkNames(
  districts,
  geojson.features,
);

console.log(`  districts: ${Object.keys(districts).length}`);
console.log(`  boundary features: ${geojson.features.length}`);
console.log(`  unmatched boundaries: ${unmatchedBoundaries.length}`);
console.log(`  districts without a boundary: ${unmatchedDistricts.join(", ") || "none"}`);

assertExpected({
  districts: Object.keys(districts).length,
  boundaryFeatures: geojson.features.length,
  unmatchedBoundaries: unmatchedBoundaries.length,
  unmatchedDistricts: unmatchedDistricts.length,
});

const reviewed = new Date().toISOString().slice(0, 10);

await mkdir(OUT_DIR, { recursive: true });

await writeFile(
  join(OUT_DIR, "population-districts.json"),
  JSON.stringify(
    {
      $source: POPULATION_CSV,
      $licence: "CC BY 4.0, Department of Statistics Malaysia",
      $vintage: vintage,
      $reviewed: reviewed,
      $note: "Population is people, already converted from DOSM's thousands.",
      districts,
    },
    null,
    0,
  ),
);

// Only what the lookup needs: name plus geometry. Dropping the other
// properties saves a meaningful slice of the 1.1 MB.
await writeFile(
  join(OUT_DIR, "district-boundaries.geojson"),
  JSON.stringify({
    type: "FeatureCollection",
    $source: BOUNDARIES_GEOJSON,
    $licence: "CC BY 3.0, geoBoundaries (wmgeolab)",
    $reviewed: reviewed,
    features: geojson.features.map((f) => ({
      type: "Feature",
      properties: { name: f.properties.shapeName, district: resolved[f.properties.shapeName] },
      geometry: f.geometry,
    })),
  }),
);

console.log(`\nwrote to ${OUT_DIR}`);
console.log(`  population-districts.json  (vintage ${vintage}, reviewed ${reviewed})`);
console.log(`  district-boundaries.geojson`);
