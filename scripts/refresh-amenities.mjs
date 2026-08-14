#!/usr/bin/env node
/**
 * Refresh the bundled city amenities snapshot.
 *
 * WHY A SNAPSHOT AT ALL. Overpass is a volunteer-run service and it shows:
 * measured across the four cities in one sitting, one returned everything, one
 * degraded to partial counts, one 504'd and one throttled. That is entirely
 * reasonable behaviour from free infrastructure, and a completely unreasonable
 * thing to put in a user's way on first load.
 *
 * The data barely changes — railway stations, universities and hospitals are
 * where they were last year — so this follows the pattern the population grid
 * and district polygons already use: fetch once, version it, ship it in the
 * image, and refresh on a human's schedule rather than a user's page load.
 * Runtime Overpass calls drop to zero for the cities we ship, which is also
 * the most considerate possible use of the service.
 *
 *   npm run refresh:amenities
 *
 * Fails loudly rather than writing a thinner file than the one it replaces.
 */

import { writeFile, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "services", "simulator", "data");
const OUT_FILE = join(OUT_DIR, "city-amenities.json");

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "SpotentialBot/1.0 (+https://spotential-app.web.app)";

/** Must match CITIES and HALF_SPAN in apps/web/src/routes/Heatmap.tsx. */
const HALF_SPAN = 0.055;
const CITIES = [
  { label: "Kuala Lumpur", lat: 3.139, lng: 101.6869 },
  { label: "Petaling Jaya", lat: 3.1073, lng: 101.6067 },
  { label: "George Town", lat: 5.4141, lng: 100.3288 },
  { label: "Johor Bahru", lat: 1.4655, lng: 103.7578 },
];

/** Mirrors AMENITY_KINDS in services/simulator/src/amenities/overpass.ts. */
const KINDS = [
  { id: "rail", label: "Rail & metro", pinned: true,
    filters: (b) => [`nwr["railway"~"station|halt"](${b});`, `nwr["public_transport"="station"](${b});`] },
  { id: "mall", label: "Malls", pinned: true,
    filters: (b) => [`nwr["shop"~"mall|department_store"](${b});`] },
  { id: "university", label: "Universities", pinned: true,
    filters: (b) => [`nwr["amenity"~"university|college"](${b});`] },
  { id: "healthcare", label: "Hospitals", pinned: true,
    filters: (b) => [`nwr["amenity"="hospital"](${b});`] },
  { id: "school", label: "Schools", pinned: false,
    filters: (b) => [`nwr["amenity"="school"](${b});`] },
  { id: "office", label: "Offices", pinned: false,
    filters: (b) => [`nwr["office"](${b});`] },
  { id: "hotel", label: "Hotels", pinned: false,
    filters: (b) => [`nwr["tourism"="hotel"](${b});`] },
  { id: "bus", label: "Bus stops", pinned: false,
    filters: (b) => [`nwr["highway"="bus_stop"](${b});`] },
];

const MAX_PINS = 150;
const PINNED = KINDS.filter((k) => k.pinned);
const COUNT_ONLY = KINDS.filter((k) => !k.pinned);

const bboxOf = (b) => `${b.south},${b.west},${b.north},${b.east}`;

function pinnedQuery(bounds) {
  const b = bboxOf(bounds);
  return [
    "[out:json][timeout:120];",
    ...PINNED.map((k) => `(${k.filters(b).join("")})->.${k.id};`),
    ...PINNED.map((k) => `.${k.id} out count;`),
    ...PINNED.map((k) => `.${k.id} out center ${MAX_PINS};`),
    `(node["place"~"suburb|neighbourhood|quarter"](${b}););out body;`,
  ].join("\n");
}

function countsQuery(bounds) {
  const b = bboxOf(bounds);
  return [
    "[out:json][timeout:120];",
    ...COUNT_ONLY.map((k) => `(${k.filters(b).join("")})->.${k.id};`),
    ...COUNT_ONLY.map((k) => `.${k.id} out count;`),
  ].join("\n");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Patient, because this runs once a year and being gentle costs us nothing.
 * A user-facing path could never wait this long; a refresh script should.
 */
async function ask(query, attempts = 6) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(OVERPASS_URL, {
      method: "POST",
      body: query,
      headers: { "content-type": "text/plain;charset=UTF-8", "user-agent": USER_AGENT },
    });

    if (response.ok) return response.json();

    const wait = Math.min(120, 15 * attempt) * 1000;
    process.stdout.write(`    HTTP ${response.status}, retrying in ${wait / 1000}s\n`);
    await sleep(wait);
  }
  throw new Error("Overpass would not answer after several patient attempts.");
}

function classify(tags) {
  const kinds = [];
  const is = (k, re) => typeof tags[k] === "string" && (!re || re.test(tags[k]));
  if (is("railway", /^(station|halt)$/) || is("public_transport", /^station$/)) kinds.push("rail");
  if (is("shop", /^(mall|department_store)$/)) kinds.push("mall");
  if (is("amenity", /^(university|college)$/)) kinds.push("university");
  if (is("amenity", /^hospital$/)) kinds.push("healthcare");
  return kinds;
}

function collect(json, kinds) {
  const layers = new Map(kinds.map((k) => [k.id, { id: k.id, label: k.label, count: 0, points: [], pinned: k.pinned }]));
  const places = [];
  let countIndex = 0;

  for (const element of json.elements ?? []) {
    if (element.type === "count") {
      const layer = layers.get(kinds[countIndex]?.id);
      if (layer) layer.count = Number(element.tags?.total ?? 0);
      countIndex += 1;
      continue;
    }

    const lat = element.lat ?? element.center?.lat;
    const lng = element.lon ?? element.center?.lon;
    if (typeof lat !== "number" || typeof lng !== "number") continue;

    const tags = element.tags ?? {};
    const name = typeof tags.name === "string" ? tags.name : undefined;

    if (tags.place && name) {
      places.push({ lat: +lat.toFixed(5), lng: +lng.toFixed(5), name });
      continue;
    }

    for (const id of classify(tags)) {
      const layer = layers.get(id);
      if (!layer?.pinned || layer.points.length >= MAX_PINS) continue;
      layer.points.push({ lat: +lat.toFixed(5), lng: +lng.toFixed(5), ...(name ? { name } : {}) });
    }
  }

  return { layers: [...layers.values()], places };
}

/** Same rounding the runtime store uses, so a seed and a live key always match. */
const cacheKey = (b) =>
  `${b.west.toFixed(2)},${b.south.toFixed(2)},${b.east.toFixed(2)},${b.north.toFixed(2)}`;

const cities = {};

for (const city of CITIES) {
  const bounds = {
    west: city.lng - HALF_SPAN,
    east: city.lng + HALF_SPAN,
    south: city.lat - HALF_SPAN,
    north: city.lat + HALF_SPAN,
  };

  process.stdout.write(`${city.label}\n`);

  const pinned = collect(await ask(pinnedQuery(bounds)), PINNED);
  await sleep(5_000);
  const counts = collect(await ask(countsQuery(bounds)), COUNT_ONLY);

  const layers = KINDS.map(
    (k) =>
      pinned.layers.find((l) => l.id === k.id) ??
      counts.layers.find((l) => l.id === k.id) ?? { id: k.id, label: k.label, count: 0, points: [], pinned: k.pinned },
  );

  const pins = layers.reduce((n, l) => n + l.points.length, 0);
  if (pins === 0 || pinned.places.length === 0) {
    throw new Error(`${city.label} produced no pins or no place names. Refusing to ship that.`);
  }

  process.stdout.write(
    `  ${pins} pins, ${pinned.places.length} places, ` +
      `${layers.map((l) => `${l.id}:${l.count}`).join(" ")}\n`,
  );

  cities[cacheKey(bounds)] = { label: city.label, layers, places: pinned.places };
  await sleep(5_000);
}

/** Never ship a thinner file than the one already in the repo. */
let previous = 0;
try {
  const existing = JSON.parse(await readFile(OUT_FILE, "utf8"));
  previous = Object.keys(existing.cities ?? {}).length;
} catch {
  previous = 0;
}

if (Object.keys(cities).length < previous) {
  throw new Error(`Got ${Object.keys(cities).length} cities but the current file has ${previous}.`);
}

const payload = {
  $source: "https://overpass-api.de/ — OpenStreetMap",
  $licence: "ODbL — © OpenStreetMap contributors. Attribution is required and is shown in the UI.",
  $note:
    "Snapshot, not a live feed. Overpass is volunteer-run and intermittently unavailable; " +
    "this data changes about annually. Regenerate with npm run refresh:amenities.",
  vintage: new Date().toISOString().slice(0, 10),
  halfSpanDegrees: HALF_SPAN,
  cities,
};

await writeFile(OUT_FILE, JSON.stringify(payload));
process.stdout.write(
  `\nWrote ${OUT_FILE}\n  ${Object.keys(cities).length} cities, ` +
    `${(JSON.stringify(payload).length / 1024).toFixed(0)}KB\n`,
);
