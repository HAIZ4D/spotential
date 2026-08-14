import {
  distanceMetres,
  formatLatLng,
  isInMalaysia,
  isValidLatLng,
  type LatLng,
} from "@spotential/sim-engine";

/**
 * Location state — Feature 1a.
 *
 * Mirrors how the simulator handles share links, for the same reason: there is
 * no account, so the URL is how a location gets sent to a business partner.
 *
 * A URL is untrusted input. Coordinates are validated on the way in and a bad
 * link falls back to a default viewport with a notice, rather than handing
 * NaN to the Maps API and getting a blank grey rectangle.
 *
 * The geometry primitives themselves live in the engine — the server needs the
 * same Haversine maths to filter competitors by radius.
 */

export { distanceMetres, formatLatLng, isInMalaysia, isValidLatLng, type LatLng };

export interface PickedLocation extends LatLng {
  /** What the user typed or what the geocoder resolved it to. */
  label: string;
}

/** Central Kuala Lumpur. Used when there is nothing in the URL to honour. */
export const DEFAULT_LOCATION: PickedLocation = {
  lat: 3.1578,
  lng: 101.7117,
  label: "Kuala Lumpur city centre",
};

export const DEFAULT_ZOOM = 16;

export type LocationParseResult =
  | { ok: true; location: PickedLocation; outsideMalaysia: boolean }
  | { ok: false; reason: string };

/**
 * @param search a query string, e.g. `?lat=3.17&lng=101.65&q=Mont+Kiara`
 */
export function parseLocationFromSearch(search: string): LocationParseResult {
  const params = new URLSearchParams(search);
  const rawLat = params.get("lat");
  const rawLng = params.get("lng");

  if (rawLat === null && rawLng === null) {
    return { ok: false, reason: "no location in the link" };
  }
  if (rawLat === null || rawLng === null) {
    return { ok: false, reason: "the link is missing a coordinate" };
  }

  const lat = Number(rawLat);
  const lng = Number(rawLng);
  // Number("") is 0, which would silently land you in the Gulf of Guinea.
  if (rawLat.trim() === "" || rawLng.trim() === "" || !isValidLatLng({ lat, lng })) {
    return { ok: false, reason: "the coordinates in the link are not valid" };
  }

  const label = (params.get("q") ?? "").trim();
  return {
    ok: true,
    location: { lat, lng, label: label || formatLatLng({ lat, lng }) },
    outsideMalaysia: !isInMalaysia({ lat, lng }),
  };
}

/**
 * A rent the user typed, carried in the link — Feature 1e.
 *
 * Worth persisting because it is the only figure on the page the user supplied
 * themselves; losing it on a page reload would mean re-entering the one number
 * the score trusts most.
 */
export interface RentFromLink {
  monthlyRent: number | null;
  unitSqft: number | null;
}

/**
 * A positive number, or null.
 *
 * Number("") is 0 — the same trap that puts a pin on Null Island. Here it
 * would read as a shop with no rent and score as if it were free, so an empty,
 * blank, zero, negative or non-numeric value all mean "not supplied".
 */
function positiveOrNull(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function parseRentFromSearch(search: string): RentFromLink {
  const params = new URLSearchParams(search);
  return {
    monthlyRent: positiveOrNull(params.get("rent")),
    unitSqft: positiveOrNull(params.get("sqft")),
  };
}

/** Six decimals is about 11cm — well past the precision of anything here. */
export function locationSearchParams(
  location: PickedLocation,
  rent?: RentFromLink,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("lat", location.lat.toFixed(6));
  params.set("lng", location.lng.toFixed(6));
  if (location.label) params.set("q", location.label);
  if (rent?.monthlyRent) params.set("rent", String(rent.monthlyRent));
  if (rent?.unitSqft) params.set("sqft", String(rent.unitSqft));
  return params;
}

