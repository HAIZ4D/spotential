/**
 * Demand generators from OpenStreetMap, via Overpass.
 *
 * The heatmap colours one measured thing — residents per hexagon. That answers
 * "where do people sleep", which is not the same question as "where do people
 * go". Rail stations, malls, universities and hospitals are where footfall
 * concentrates during the trading day, and OSM has all of them for free.
 *
 * WHY THIS IS FINE TO FETCH, unlike the property portals:
 *
 *   - OSM data is open (ODbL). Attribution is required and is rendered in the
 *     UI, not buried — the same treatment Kontur's CC BY gets.
 *   - Overpass is a volunteer-run COMMONS, not a company protecting inventory.
 *     The obligation is to be light on it, which is what the 7-day cache is
 *     for: four cities is about four queries a week.
 *   - Nothing is republished as our own. These are counts and pins pointing at
 *     public infrastructure.
 *
 * It throttles readily — 429s appeared twice while researching this — so every
 * failure degrades to "layer unavailable" and the density map carries on.
 */

export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

/** Overpass is slow by nature; this is generous but still bounded. */
export const FETCH_TIMEOUT_MS = 60_000;

export const ATTRIBUTION = "© OpenStreetMap contributors (ODbL)";

/**
 * What we ask for, and whether it is worth drawing.
 *
 * `pinned` is a rendering decision made from measured counts, not taste. An
 * 11km box around central KL holds 1,026 bus stops and 1,018 offices; drawing
 * those turns the map into confetti and the browser into treacle. They are
 * still COUNTED, because "300 offices in this cell" is a genuine demand
 * signal even when 300 pins are not a genuine picture.
 */
export interface AmenityKind {
  id: string;
  label: string;
  /** Overpass filter clauses, already scoped to the bounding box at build time. */
  filters: (bbox: string) => string[];
  pinned: boolean;
}

export const AMENITY_KINDS: AmenityKind[] = [
  {
    id: "rail",
    label: "Rail & metro",
    filters: (b) => [`nwr["railway"~"station|halt"](${b});`, `nwr["public_transport"="station"](${b});`],
    pinned: true,
  },
  {
    id: "mall",
    label: "Malls",
    filters: (b) => [`nwr["shop"~"mall|department_store"](${b});`],
    pinned: true,
  },
  {
    id: "university",
    label: "Universities",
    filters: (b) => [`nwr["amenity"~"university|college"](${b});`],
    pinned: true,
  },
  {
    id: "healthcare",
    label: "Hospitals",
    filters: (b) => [`nwr["amenity"="hospital"](${b});`],
    pinned: true,
  },
  {
    id: "school",
    label: "Schools",
    filters: (b) => [`nwr["amenity"="school"](${b});`],
    pinned: false,
  },
  {
    id: "office",
    label: "Offices",
    filters: (b) => [`nwr["office"](${b});`],
    pinned: false,
  },
  {
    id: "hotel",
    label: "Hotels",
    filters: (b) => [`nwr["tourism"="hotel"](${b});`],
    pinned: false,
  },
  {
    id: "bus",
    label: "Bus stops",
    filters: (b) => [`nwr["highway"="bus_stop"](${b});`],
    pinned: false,
  },
];

/** Named neighbourhoods, so "top areas" can say Bukit Bintang, not 3.148, 101.712. */
const PLACE_FILTER = (b: string) => `node["place"~"suburb|neighbourhood|quarter"](${b});`;

/**
 * A pin is capped hard.
 *
 * Even the "pinned" categories can surprise us in a city we have not measured,
 * and a payload is easier to bound here than to apologise for later.
 */
export const MAX_PINS_PER_KIND = 150;

export interface AmenityPoint {
  lat: number;
  lng: number;
  /** Present only where OSM has one; many nodes are unnamed. */
  name?: string;
}

export interface AmenityLayer {
  id: string;
  label: string;
  /** Everything found in the box, including what was not pinned. */
  count: number;
  /** Empty for unpinned kinds — the count is the signal there. */
  points: AmenityPoint[];
  pinned: boolean;
}

export interface NamedPlace {
  lat: number;
  lng: number;
  name: string;
}

export interface AmenitiesResult {
  layers: AmenityLayer[];
  places: NamedPlace[];
  available: boolean;
  reason: string | null;
  /**
   * The underlying error, for logs only.
   *
   * `reason` is a stable code the UI branches on; this is the sentence that
   * tells an operator WHY. Swallowing it cost a deploy cycle: a failure
   * reported only as "unreachable" is indistinguishable from a DNS problem, a
   * refused connection, a TLS failure and a truncated body.
   */
  detail?: string;
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * TWO queries, not one, and not nine.
 *
 * Measured against the live API on an 11km box over central KL:
 *
 *   4 pinned kinds + places   4.4s, reliable
 *   all 8 kinds + places      7-16s, and it 504s intermittently
 *
 * The wildcard `nwr["office"]` and the 1,026 bus stops are what cost the
 * difference, and both are count-only — we never draw them. Paying 2-4x the
 * query time and a real failure rate for four extra numbers is a bad trade
 * against a volunteer-run service.
 *
 * So the map data goes in one fast query that must succeed, and the
 * count-only categories in a second, best-effort one. If the second fails the
 * first is unaffected: you lose four numbers, not the layer.
 *
 * COUNTS AND PINS ARE ASKED FOR SEPARATELY within each query. `out center 150`
 * caps the RESULT, so using it alone would have reported 150 bus stops where
 * there are 1,026 — the same truncation trap that once flattened the
 * competition score.
 *
 * Overpass emits results in STATEMENT order, so each count block arrives in
 * the order its kinds were declared and is zipped back by index.
 */
export const PINNED_KINDS = AMENITY_KINDS.filter((kind) => kind.pinned);
export const COUNT_ONLY_KINDS = AMENITY_KINDS.filter((kind) => !kind.pinned);

function bboxOf(bounds: Bounds): string {
  return `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
}

/** The query that matters: what gets drawn, plus the names for ranked areas. */
export function buildPinnedQuery(bounds: Bounds): string {
  const bbox = bboxOf(bounds);
  return [
    "[out:json][timeout:90];",
    ...PINNED_KINDS.map((kind) => `(${kind.filters(bbox).join("")})->.${kind.id};`),
    ...PINNED_KINDS.map((kind) => `.${kind.id} out count;`),
    ...PINNED_KINDS.map((kind) => `.${kind.id} out center ${MAX_PINS_PER_KIND};`),
    `(${PLACE_FILTER(bbox)})->.places;.places out body;`,
  ].join("\n");
}

/** Counts only, for categories too dense to draw. Best-effort. */
export function buildCountsQuery(bounds: Bounds): string {
  const bbox = bboxOf(bounds);
  return [
    "[out:json][timeout:90];",
    ...COUNT_ONLY_KINDS.map((kind) => `(${kind.filters(bbox).join("")})->.${kind.id};`),
    ...COUNT_ONLY_KINDS.map((kind) => `.${kind.id} out count;`),
  ].join("\n");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Ways and relations come back with a `center`; nodes carry lat/lng directly. */
function positionOf(element: Record<string, unknown>): { lat: number; lng: number } | null {
  const centre = asRecord(element["center"]);
  const lat = typeof element["lat"] === "number" ? element["lat"] : centre?.["lat"];
  const lng = typeof element["lon"] === "number" ? element["lon"] : centre?.["lon"];
  return typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null;
}

/**
 * Sort elements into layers.
 *
 * Overpass does not label which of our sets an element came from, so each is
 * matched back by its own tags. That is slightly redundant with the query, and
 * it is the redundancy that makes the parser safe: an element we cannot
 * classify is dropped rather than guessed into the wrong layer.
 */
function classify(element: Record<string, unknown>): string[] {
  const tags = asRecord(element["tags"]) ?? {};
  const has = (key: string, pattern?: RegExp) => {
    const value = tags[key];
    return typeof value === "string" && (!pattern || pattern.test(value));
  };

  const kinds: string[] = [];
  if (has("railway", /^(station|halt)$/) || has("public_transport", /^station$/)) kinds.push("rail");
  if (has("shop", /^(mall|department_store)$/)) kinds.push("mall");
  if (has("amenity", /^(university|college)$/)) kinds.push("university");
  if (has("amenity", /^hospital$/)) kinds.push("healthcare");
  if (has("amenity", /^school$/)) kinds.push("school");
  if (has("office")) kinds.push("office");
  if (has("tourism", /^hotel$/)) kinds.push("hotel");
  if (has("highway", /^bus_stop$/)) kinds.push("bus");
  return kinds;
}

export function parseAmenities(
  json: unknown,
  kinds: AmenityKind[] = AMENITY_KINDS,
): { layers: AmenityLayer[]; places: NamedPlace[] } {
  const layers: AmenityLayer[] = kinds.map((kind) => ({
    id: kind.id,
    label: kind.label,
    count: 0,
    points: [] as AmenityPoint[],
    pinned: kind.pinned,
  }));

  const elements = asRecord(json)?.["elements"];
  if (!Array.isArray(elements)) return { layers, places: [] };

  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const places: NamedPlace[] = [];

  // Counts arrive first, one per kind, in the order the query declared them.
  let countIndex = 0;

  for (const raw of elements) {
    const element = asRecord(raw);
    if (!element) continue;

    if (element["type"] === "count") {
      const total = Number(asRecord(element["tags"])?.["total"]);
      const layer = layers[countIndex];
      if (layer && Number.isFinite(total)) layer.count = total;
      countIndex += 1;
      continue;
    }

    const position = positionOf(element);
    if (!position) continue;

    const tags = asRecord(element["tags"]) ?? {};
    const name = typeof tags["name"] === "string" ? tags["name"] : undefined;

    if (typeof tags["place"] === "string" && name) {
      places.push({ ...position, name });
      continue;
    }

    for (const kind of classify(element)) {
      const layer = byId.get(kind);
      if (!layer?.pinned) continue;
      if (layer.points.length >= MAX_PINS_PER_KIND) continue;
      layer.points.push(name ? { ...position, name } : position);
    }
  }

  return { layers, places };
}

export type Fetcher = (
  url: string,
  init: { method: string; body: string; headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const emptyLayer = (kind: AmenityKind) => ({
  id: kind.id,
  label: kind.label,
  count: 0,
  points: [] as AmenityPoint[],
  pinned: kind.pinned,
});

/** Describe a failure precisely enough for an operator to act on it. */
function failureOf(error: unknown): { reason: string; detail: string } {
  const aborted = error instanceof Error && error.name === "AbortError";
  // fetch wraps the real problem in a generic TypeError, so the `cause` is
  // usually the only part worth reading.
  const cause = error instanceof Error ? (error.cause as Error | undefined) : undefined;

  return {
    reason: aborted ? "timeout" : "unreachable",
    detail: [
      error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      cause ? `cause ${cause.name}: ${cause.message}` : "",
    ]
      .filter(Boolean)
      .join(" — ")
      .slice(0, 300),
  };
}

/** One Overpass round trip. Never throws. */
async function runQuery(
  query: string,
  kinds: AmenityKind[],
  fetcher: Fetcher,
): Promise<{ layers: AmenityLayer[]; places: NamedPlace[]; ok: boolean; reason: string | null; detail?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetcher(OVERPASS_URL, {
      method: "POST",
      body: query,
      headers: {
        "content-type": "text/plain;charset=UTF-8",
        // Overpass asks callers to identify themselves so it can talk to them
        // about load rather than just blocking.
        "user-agent": "SpotentialBot/1.0 (+https://spotential-app.web.app)",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        layers: kinds.map(emptyLayer),
        places: [],
        ok: false,
        reason: response.status === 429 ? "throttled" : `http_${response.status}`,
      };
    }

    const { layers, places } = parseAmenities(await response.json(), kinds);
    return { layers, places, ok: true, reason: null };
  } catch (error) {
    const { reason, detail } = failureOf(error);
    return { layers: kinds.map(emptyLayer), places: [], ok: false, reason, detail };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch and classify. Never throws.
 *
 * Two round trips, sequential rather than parallel: firing both at once at a
 * volunteer service to save four seconds on a result cached for a week is not
 * a trade worth making, and Overpass rate-limits concurrent slots per IP
 * anyway.
 *
 * The second query is BEST-EFFORT. Losing it costs four counts; losing the
 * first costs the whole layer, which is why they are separate at all.
 */
export async function fetchAmenities(
  bounds: Bounds,
  fetcher: Fetcher = globalThis.fetch as unknown as Fetcher,
): Promise<AmenitiesResult> {
  const pinned = await runQuery(buildPinnedQuery(bounds), PINNED_KINDS, fetcher);

  if (!pinned.ok) {
    return {
      layers: AMENITY_KINDS.map(emptyLayer),
      places: [],
      available: false,
      reason: pinned.reason,
      ...(pinned.detail ? { detail: pinned.detail } : {}),
    };
  }

  const counts = await runQuery(buildCountsQuery(bounds), COUNT_ONLY_KINDS, fetcher);

  return {
    // Declared order, not query order — the UI lists them the way
    // AMENITY_KINDS does.
    layers: AMENITY_KINDS.map(
      (kind) =>
        pinned.layers.find((l) => l.id === kind.id) ??
        counts.layers.find((l) => l.id === kind.id) ??
        emptyLayer(kind),
    ),
    places: pinned.places,
    available: true,
    // A partial result is still a result, but say so rather than implying the
    // zeroes are real counts.
    reason: counts.ok ? null : "counts_unavailable",
  };
}
