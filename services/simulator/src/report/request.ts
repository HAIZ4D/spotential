import {
  CATEGORY_PRESETS,
  isValidLatLng,
  parseScenarioInputs,
  type BusinessCategory,
  type CompetitorSummary,
  type CompetitorWithDistance,
  type DensityBand,
  type LatLng,
  type ScenarioInputs,
} from "@spotential/sim-engine";
import type { LocationReportInput } from "./model.js";
import type { GapFacts } from "../chat/facts.js";

/**
 * Report request validation — Feature 4.
 *
 * A request body is untrusted, and for reports that matters more than usual:
 * the output is a document someone may hand to a bank. So NOTHING DERIVABLE IS
 * ACCEPTED FROM THE CLIENT. A body carrying its own `score`, `overall` or
 * `breakEven` has those fields ignored outright — every figure is recomputed
 * from inputs by the shared engine.
 *
 * Free text (labels) is length-capped: it lands in a PDF, and an unbounded
 * string is both a layout problem and a way to pad a response.
 */

const MAX_LABEL = 120;
const MAX_LOCATIONS = 3;
const MAX_DENSITY_BANDS = 8;
/**
 * The report prints at most 12 rivals; accepting a few more costs nothing and
 * lets the model choose. A hostile list cannot inflate the document because
 * both this cap and the print slice are hard.
 */
const MAX_RIVALS = 40;
const MAX_RIVAL_NAME = 60;

export type ReportRequest =
  | { kind: "scenario"; inputs: ScenarioInputs }
  | { kind: "location"; location: LocationReportInput }
  | {
      kind: "comparison";
      category: BusinessCategory;
      radiusMetres: number;
      locations: LocationReportInput[];
    };

export type ParseResult =
  | { ok: true; value: ReportRequest }
  | { ok: false; error: string; message: string };

const fail = (message: string): ParseResult => ({ ok: false, error: "invalid_report", message });

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, MAX_LABEL) : fallback;
}

/** Finite, non-negative, and not NaN — `Number("")` is 0 and must not pass as data. */
function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function summaryOf(value: unknown): CompetitorSummary {
  const raw = (value ?? {}) as Record<string, unknown>;
  const rating = Number(raw["averageRating"]);

  return {
    total: Math.floor(count(raw["total"])),
    // Null, never 0. A zero rating reads as "terrible" rather than "unrated".
    averageRating: Number.isFinite(rating) && rating > 0 ? rating : null,
    ratedCount: Math.floor(count(raw["ratedCount"])),
    totalReviews: Math.floor(count(raw["totalReviews"])),
    nearestMetres: Number.isFinite(Number(raw["nearestMetres"]))
      ? Math.floor(count(raw["nearestMetres"]))
      : null,
    operational: Math.floor(count(raw["operational"])),
  };
}

function densityOf(value: unknown): DensityBand[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_DENSITY_BANDS).map((band) => ({
    upToMetres: Math.floor(count((band as Record<string, unknown>)?.["upToMetres"])),
    count: Math.floor(count((band as Record<string, unknown>)?.["count"])),
  }));
}

/**
 * The competitor list, sanitised the same way everything else here is.
 *
 * These are INPUTS at the same trust level as the summary beside them — the
 * server cannot re-derive them without a paid Places call. Nothing scored is
 * computed from them; they populate one table. Every field is clamped so a
 * hand-edited request cannot produce a document with Spotential's name on
 * absurd figures.
 */
function rivalsOf(value: unknown): CompetitorWithDistance[] {
  if (!Array.isArray(value)) return [];

  return value.slice(0, MAX_RIVALS).flatMap((entry) => {
    const raw = (entry ?? {}) as Record<string, unknown>;
    const name = text(raw["name"], "").slice(0, MAX_RIVAL_NAME).trim();
    if (name === "") return [];

    const rating = Number(raw["rating"]);
    const lat = Number(raw["lat"]);
    const lng = Number(raw["lng"]);

    return [
      {
        id: text(raw["id"], name).slice(0, 80),
        name,
        // Null, never 0 — a zero rating reads as "terrible" rather than "unrated".
        rating: Number.isFinite(rating) && rating > 0 ? Math.min(5, rating) : null,
        reviewCount: Math.min(1_000_000, Math.floor(count(raw["reviewCount"]))),
        lat: Number.isFinite(lat) ? lat : 0,
        lng: Number.isFinite(lng) ? lng : 0,
        distanceMetres: Math.min(50_000, Math.floor(count(raw["distanceMetres"]))),
        businessStatus: text(raw["businessStatus"], "OPERATIONAL").slice(0, 32),
        priceLevel: raw["priceLevel"] === null ? null : text(raw["priceLevel"], "").slice(0, 32) || null,
        primaryType: raw["primaryType"] === null ? null : text(raw["primaryType"], "").slice(0, 48) || null,
      } as CompetitorWithDistance,
    ];
  });
}

function demographicsOf(value: unknown): LocationReportInput["demographics"] {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const age = raw["age"];
  if (!age || typeof age !== "object") return null;

  const bands: Record<string, number> = {};
  for (const [band, population] of Object.entries(age as Record<string, unknown>)) {
    bands[band] = count(population);
  }

  return {
    district: text(raw["district"], "Unknown district"),
    state: text(raw["state"], ""),
    total: count(raw["total"]),
    age: bands,
  };
}

export function categoryOf(value: unknown): BusinessCategory | null {
  return typeof value === "string" && value in CATEGORY_PRESETS
    ? (value as BusinessCategory)
    : null;
}

/**
 * Gap analysis, sanitised.
 *
 * Accepted as an INPUT at the same trust level as the rival list above: the
 * server cannot re-derive it without paying Places again, and the caller has
 * just fetched it from this very service. It is used only as narration
 * material for the AI briefing and is never scored, so the worst a
 * hand-edited request can do is change some prose about itself.
 *
 * Capped hard. Fifteen categories is the real ceiling; anything longer is
 * someone trying to stuff the model's context.
 */
const MAX_GAP_ROWS = 20;

export function gapsOf(value: unknown): GapFacts | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  const rows = Array.isArray(raw["ranked"]) ? (raw["ranked"] as unknown[]) : [];
  const ranked = rows.slice(0, MAX_GAP_ROWS).flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const row = entry as Record<string, unknown>;
    const label = text(row["label"], "").slice(0, MAX_LABEL).trim();
    if (!label) return [];
    return [
      {
        label,
        outlets: count(row["outlets"]),
        outletsAreMinimum: row["outletsAreMinimum"] === true,
        reviewsPerOutlet: Number.isFinite(Number(row["reviewsPerOutlet"]))
          ? Number(row["reviewsPerOutlet"])
          : null,
        averageRating: Number.isFinite(Number(row["averageRating"]))
          ? Number(row["averageRating"])
          : null,
        verdict: text(row["verdict"], "unknown").slice(0, 32),
      },
    ];
  });

  if (ranked.length === 0) return null;

  const absent = Array.isArray(raw["noPresence"]) ? (raw["noPresence"] as unknown[]) : [];
  const noPresence = absent.slice(0, MAX_GAP_ROWS).flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const label = text((entry as Record<string, unknown>)["label"], "").slice(0, MAX_LABEL).trim();
    return label ? [{ label }] : [];
  });

  const top = raw["topOpportunity"];
  const topLabel =
    typeof top === "object" && top !== null
      ? text((top as Record<string, unknown>)["label"], "").slice(0, MAX_LABEL).trim()
      : "";

  return { ranked, noPresence, topOpportunity: topLabel ? { label: topLabel } : null };
}

export const RADIUS_RANGE = { min: 100, max: 2_000 } as const;

/** Finite, inside the searchable band. Shared by the report and chat routes. */
export function radiusOf(value: unknown): number | null {
  const radius = Number(value);
  return Number.isFinite(radius) && radius >= RADIUS_RANGE.min && radius <= RADIUS_RANGE.max
    ? radius
    : null;
}

function pointOf(value: unknown): LatLng | null {
  const raw = (value ?? {}) as Record<string, unknown>;
  const lat = Number(raw["lat"]);
  const lng = Number(raw["lng"]);
  return isValidLatLng({ lat, lng }) ? { lat, lng } : null;
}

/**
 * Shared with the chat route — Feature 3.
 *
 * Both routes take the same untrusted location body, so they apply the same
 * discipline from one definition rather than growing a second copy that can
 * drift on which fields it sanitises.
 */
export function locationOf(
  value: unknown,
  category: BusinessCategory,
  radiusMetres: number,
): LocationReportInput | null {
  const raw = (value ?? {}) as Record<string, unknown>;
  const point = pointOf(raw["point"]);
  if (!point) return null;

  const rent = Number(raw["rentOverride"]);
  const completeTo = Number(raw["completeToMetres"]);

  return {
    point,
    label: text(raw["label"], `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`),
    category,
    radiusMetres,
    competitors: summaryOf(raw["competitors"]),
    truncated: raw["truncated"] === true,
    completeToMetres: Number.isFinite(completeTo) && completeTo > 0 ? completeTo : null,
    density: densityOf(raw["density"]),
    demographics: demographicsOf(raw["demographics"]),
    rivals: rivalsOf(raw["rivals"]),
    // A rent of 0 is not "no rent" — it would score as a free shop.
    rentOverride: Number.isFinite(rent) && rent > 0 ? rent : null,
  };
}

const KINDS = ["scenario", "location", "comparison"] as const;

export function parseReportRequest(body: unknown): ParseResult {
  const raw = (body ?? {}) as Record<string, unknown>;
  const kind = raw["kind"];

  // Checked first so an unknown kind is reported as such, rather than as
  // whatever field the wrong branch happened to validate next.
  if (typeof kind !== "string" || !(KINDS as readonly string[]).includes(kind)) {
    return fail('kind must be one of "scenario", "location" or "comparison".');
  }

  if (kind === "scenario") {
    // Exactly the guard /v1/simulate uses, so a report cannot accept a
    // scenario the simulator would reject.
    const parsed = parseScenarioInputs(raw["inputs"]);
    if (!parsed.ok) {
      return fail(`The scenario did not pass validation: ${parsed.errors.join("; ")}`);
    }
    return { ok: true, value: { kind: "scenario", inputs: parsed.value } };
  }

  const category = categoryOf(raw["category"]);
  if (!category) return fail("category must be one of the supported business types.");

  const radius = radiusOf(raw["radiusMetres"]);
  if (radius === null) {
    return fail(`radiusMetres must be between ${RADIUS_RANGE.min} and ${RADIUS_RANGE.max}.`);
  }

  if (kind === "location") {
    const location = locationOf(raw["location"], category, radius);
    if (!location) return fail("location.point must be a valid coordinate.");
    return { ok: true, value: { kind: "location", location } };
  }

  const list = raw["locations"];
  if (!Array.isArray(list) || list.length < 2) {
    return fail("A comparison needs at least two locations.");
  }
  if (list.length > MAX_LOCATIONS) {
    return fail(`A comparison holds at most ${MAX_LOCATIONS} locations.`);
  }

  const locations: LocationReportInput[] = [];
  for (const entry of list) {
    const location = locationOf(entry, category, radius);
    if (!location) return fail("Every location needs a valid coordinate.");
    locations.push(location);
  }

  return { ok: true, value: { kind: "comparison", category, radiusMetres: radius, locations } };
}

/** Every point a report needs a map for. */
export function pointsOf(request: ReportRequest): LatLng[] {
  if (request.kind === "location") return [request.location.point];
  if (request.kind === "comparison") return request.locations.map((l) => l.point);
  // A scenario has no location — it is the same arithmetic anywhere.
  return [];
}

/** A filename the browser can save without further escaping. */
export function filenameOf(request: ReportRequest): string {
  const stem =
    request.kind === "scenario"
      ? "scenario"
      : request.kind === "location"
        ? request.location.label
        : request.locations.map((l) => l.label).join("-vs-");

  const safe = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

  return `spotential-${safe || request.kind}.pdf`;
}
