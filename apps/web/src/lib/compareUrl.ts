import { isValidLatLng, type BusinessCategory } from "@spotential/sim-engine";
import { CATEGORY_PRESETS, RADIUS_BUCKETS } from "@spotential/sim-engine";
import type { PickedLocation } from "./location.js";

/**
 * Comparison state in the URL — Feature 2.
 *
 * Same storage as everywhere else: no accounts, no database, the whole thing
 * in the query string so it can be pasted into WhatsApp.
 *
 *   /compare?c=korean_restaurant&r=500
 *           &p=3.1478,101.6953,Central KL
 *           &p=3.0738,101.5183,Suburban PJ
 *
 * CATEGORY AND RADIUS ARE COMPARISON-LEVEL, not per location. A 250m Korean
 * search against a 1km cafe search is not a comparison — the numbers are not
 * commensurable — so they cannot vary between entries by construction.
 */

/** Two is the common case; three still reads on a phone. */
export const MAX_COMPARED = 3;

export interface ComparisonState {
  category: BusinessCategory;
  radiusMetres: number;
  locations: PickedLocation[];
  /**
   * Rent quoted for each location, positionally aligned with `locations`.
   *
   * Per location, unlike category and radius, and legitimately so: a rent is a
   * measurement of one specific unit, not a search setting, so it cannot make
   * two locations incommensurable the way a mismatched radius would.
   */
  rents?: (number | null)[];
}

export interface ComparisonParseResult {
  state: ComparisonState;
  /** Entries dropped as unreadable. Surfaced rather than silently discarded. */
  dropped: number;
}

const DEFAULT_CATEGORY: BusinessCategory = "korean_restaurant";
const DEFAULT_RADIUS = 500;

export function parseComparisonFromSearch(search: string): ComparisonParseResult {
  const params = new URLSearchParams(search);

  const rawCategory = params.get("c");
  const category: BusinessCategory =
    rawCategory && rawCategory in CATEGORY_PRESETS
      ? (rawCategory as BusinessCategory)
      : DEFAULT_CATEGORY;

  const rawRadius = Number(params.get("r"));
  const radiusMetres = (RADIUS_BUCKETS as readonly number[]).includes(rawRadius)
    ? rawRadius
    : DEFAULT_RADIUS;

  const entries = params.getAll("p");
  // Positionally aligned with the RAW `p` entries, not the surviving ones — a
  // dropped malformed location must not shift every later rent onto the wrong
  // site, which would be worse than losing them.
  const rentEntries = params.getAll("pr");

  const locations: PickedLocation[] = [];
  const rents: (number | null)[] = [];
  let dropped = 0;

  for (const [rawIndex, entry] of entries.entries()) {
    // "lat,lng,label" — the label may itself contain commas, so only split
    // the first two separators.
    const firstComma = entry.indexOf(",");
    const secondComma = entry.indexOf(",", firstComma + 1);
    if (firstComma < 0) {
      dropped += 1;
      continue;
    }

    const rawLat = entry.slice(0, firstComma);
    const rawLng =
      secondComma < 0 ? entry.slice(firstComma + 1) : entry.slice(firstComma + 1, secondComma);
    const label = secondComma < 0 ? "" : entry.slice(secondComma + 1).trim();

    // Number("") is 0 and (0, 0) is a VALID coordinate — Null Island, in the
    // Gulf of Guinea. Without this an entry like "p=,,Label" would sail
    // through validation and render a location off the coast of Africa. Same
    // trap already guarded in parseLocationFromSearch.
    if (rawLat.trim() === "" || rawLng.trim() === "") {
      dropped += 1;
      continue;
    }

    const lat = Number(rawLat);
    const lng = Number(rawLng);

    if (!isValidLatLng({ lat, lng })) {
      // One bad entry must not poison the rest of the comparison.
      dropped += 1;
      continue;
    }

    if (locations.length >= MAX_COMPARED) {
      dropped += 1;
      continue;
    }

    locations.push({ lat, lng, label: label || `${lat.toFixed(4)}, ${lng.toFixed(4)}` });

    // Number("") is 0, and a rent of 0 is not "no rent" — it would score as a
    // free shop. Same class of bug as the Null Island guard above.
    const rawRent = rentEntries[rawIndex];
    const rent = rawRent === undefined || rawRent.trim() === "" ? NaN : Number(rawRent);
    rents.push(Number.isFinite(rent) && rent > 0 ? rent : null);
  }

  return { state: { category, radiusMetres, locations, rents }, dropped };
}

export function comparisonSearchParams(state: ComparisonState): URLSearchParams {
  const params = new URLSearchParams();
  params.set("c", state.category);
  params.set("r", String(state.radiusMetres));

  const kept = state.locations.slice(0, MAX_COMPARED);
  const rents = state.rents ?? [];
  const anyRent = kept.some((_, index) => rents[index]);

  kept.forEach((location, index) => {
    params.append("p", `${location.lat.toFixed(6)},${location.lng.toFixed(6)},${location.label}`);
    // Only emitted once any location has one, and then for ALL of them, so the
    // positional alignment survives a round trip.
    if (anyRent) params.append("pr", rents[index] ? String(rents[index]) : "");
  });

  return params;
}

export function comparisonHref(state: ComparisonState): string {
  return `/compare?${comparisonSearchParams(state).toString()}`;
}

/**
 * The comparison being assembled, remembered across page navigations.
 *
 * Without this, "Add to comparison" on the analysis page would REPLACE the
 * comparison each time and a two-location comparison could never be built —
 * you would always arrive at /compare holding exactly one pin.
 *
 * sessionStorage rather than a store or a database: it survives the hop
 * between pages, dies with the tab, and needs no account. The URL remains the
 * durable, shareable copy.
 */
const PENDING_KEY = "spotential:comparison";

export function readPendingComparison(): ComparisonState | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = parseComparisonFromSearch(raw);
    return parsed.state.locations.length > 0 ? parsed.state : null;
  } catch {
    return null;
  }
}

export function writePendingComparison(state: ComparisonState): void {
  try {
    sessionStorage.setItem(PENDING_KEY, `?${comparisonSearchParams(state).toString()}`);
  } catch {
    // Private browsing can refuse storage. The URL still works, so losing the
    // running list is a degraded flow rather than a broken one.
  }
}

/**
 * Add a location to whatever comparison is in progress.
 *
 * Category and radius come from the caller and overwrite the stored ones: the
 * most recent search settings win, and every location is re-scored under them
 * so the comparison stays commensurable.
 */
export function appendToComparison(
  location: PickedLocation,
  category: BusinessCategory,
  radiusMetres: number,
  monthlyRent?: number | null,
): ComparisonState {
  const pending = readPendingComparison();
  const existing = pending?.locations ?? [];
  const existingRents = pending?.rents ?? [];

  // Same spot twice is not a comparison. Rounded, so a few metres of drift
  // does not sneak in a duplicate.
  const alreadyThere = existing.some(
    (l) => l.lat.toFixed(3) === location.lat.toFixed(3) && l.lng.toFixed(3) === location.lng.toFixed(3),
  );

  const rent = monthlyRent && monthlyRent > 0 ? monthlyRent : null;

  // Sliced in lockstep so a rent never ends up attached to the wrong site.
  const locations = alreadyThere ? existing : [...existing, location].slice(-MAX_COMPARED);
  const rents = alreadyThere ? existingRents : [...existingRents, rent].slice(-MAX_COMPARED);

  const next: ComparisonState = { category, radiusMetres, locations, rents };
  writePendingComparison(next);
  return next;
}
