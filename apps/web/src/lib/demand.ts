/**
 * Framing and fetch geometry for the population surface on the Location map.
 *
 * Pure, and kept out of the route so it can be tested without dragging in the
 * Maps components — which CI never loads, because Google Maps bills per call
 * and adds no signal to a test.
 */

/**
 * How wide the map goes when the surface is switched on.
 *
 * Kontur cells sit 693m centre to centre (400m edge) and the kernel smooths
 * over 1,500m, so at the default search framing the whole pane spans about one
 * and a half cells — a uniform tint that says nothing and hides the streets the
 * pins sit on. 2.5km frames roughly seven cells, which is where the surface
 * starts to have shape. Below that it is not a subtler version of the same
 * picture; it is a different and misleading one.
 */
export const DEMAND_VIEW_METRES = 2_500;

/**
 * How far past the frame the grid is fetched.
 *
 * A blurred surface ends on a dead straight line wherever its data stops, so
 * the fetch reaches beyond the view and that edge falls off screen — the same
 * 1.7x the heatmap page uses. Nothing here is counted, only drawn, so unlike
 * that page there is no statistic the padding could contaminate.
 */
export const GRID_PAD = 1.7;

/** Degrees per metre of latitude. Near enough at Malaysian latitudes. */
const DEG_PER_M = 1 / 110_574;

/**
 * What to frame the camera to.
 *
 * One number, so the camera has one owner. The alternative — the toggle
 * calling setZoom itself — would put the surface and the radius control in a
 * race whenever both changed.
 */
export function framingRadius(searchRadiusMetres: number, demandOn: boolean): number {
  return demandOn ? DEMAND_VIEW_METRES : searchRadiusMetres;
}

/** The grid box to fetch for a centre, padded past the widened view. */
export function demandBounds(centre: { lat: number; lng: number }): {
  west: number;
  east: number;
  south: number;
  north: number;
} {
  const span = DEMAND_VIEW_METRES * GRID_PAD * DEG_PER_M;
  /**
   * Longitude degrees shrink toward the poles, so a fixed degree span would
   * fetch a narrower box the further from the equator you go. Clamped so a
   * nonsensical latitude cannot divide by zero and ask for the whole planet.
   */
  const lngSpan = span / Math.max(0.2, Math.cos((centre.lat * Math.PI) / 180));

  return {
    west: centre.lng - lngSpan,
    east: centre.lng + lngSpan,
    south: centre.lat - span,
    north: centre.lat + span,
  };
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * Server caps, and they differ.
 *
 * `/v1/heatmap` accepts 1.5 degrees a side (~165km); `/v1/amenities` only 0.3
 * (~33km). Zoomed out past the smaller one, the amenity layer is SKIPPED and
 * says so — firing the request anyway would spend a round trip to be told 400,
 * and would look to the reader like the layer is broken rather than out of range.
 */
export const HEATMAP_MAX_SPAN_DEG = 1.5;
export const AMENITY_MAX_SPAN_DEG = 0.3;

const spanOf = (b: Bounds) => Math.max(b.east - b.west, b.north - b.south);

export const canFetchGrid = (b: Bounds) => spanOf(b) <= HEATMAP_MAX_SPAN_DEG;
export const canFetchAmenities = (b: Bounds) => spanOf(b) <= AMENITY_MAX_SPAN_DEG;

/** Grows a box about its centre, so a blurred surface's edge falls off screen. */
export function padBounds(b: Bounds, factor = GRID_PAD): Bounds {
  const midLat = (b.north + b.south) / 2;
  const midLng = (b.east + b.west) / 2;
  const halfLat = ((b.north - b.south) / 2) * factor;
  const halfLng = ((b.east - b.west) / 2) * factor;
  return {
    north: midLat + halfLat,
    south: midLat - halfLat,
    east: midLng + halfLng,
    west: midLng - halfLng,
  };
}

/**
 * Rounds a box for use as a query key.
 *
 * Map bounds change on every pixel of a pan, so keying a query on the raw
 * numbers would refetch continuously. Three decimals is about 110m — finer than
 * a 693m cell, so nothing visible is lost, and it collapses a drag into one or
 * two cache entries instead of hundreds.
 */
export const bucketBounds = (b: Bounds): string =>
  [b.west, b.south, b.east, b.north].map((n) => n.toFixed(3)).join(",");

/** Only the cells actually on screen. Statistics claim to describe the view. */
export const cellsWithin = <T extends { lat: number; lng: number }>(
  cells: T[],
  b: Bounds,
): T[] =>
  cells.filter((c) => c.lat >= b.south && c.lat <= b.north && c.lng >= b.west && c.lng <= b.east);

const metresBetween = (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number =>
  Math.hypot(
    (a.lat - b.lat) * 110_574,
    (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180),
  );

/**
 * The cell a point falls in — by NEAREST CENTROID, which is exact here.
 *
 * A hexagonal grid is the Voronoi tessellation of its own centroids: every
 * point inside a hexagon is closer to that hexagon's centre than to any other.
 * So this is not an approximation of point-in-polygon, it is the same answer
 * for less work, and it stays correct at a cell boundary where a naive
 * nearest-VERTEX test would not.
 *
 * Returns null on an empty grid rather than a fabricated cell — "no data here"
 * and "nobody lives here" are different statements and must not render alike.
 */
export function cellAt<T extends { lat: number; lng: number }>(
  cells: T[],
  point: { lat: number; lng: number },
): T | null {
  let best: T | null = null;
  let bestDistance = Infinity;

  for (const cell of cells) {
    const d = metresBetween(cell, point);
    if (d < bestDistance) {
      bestDistance = d;
      best = cell;
    }
  }

  return best;
}

/**
 * The four cities whose places ship as a versioned snapshot in the image.
 *
 * Centres and half-span match `services/simulator/data/city-amenities.json`
 * exactly — the store keys its cache on the bounding box rounded to two
 * decimals, so a request has to ask for the SAME box to hit the snapshot.
 */
const SEEDED_CITIES = [
  { label: "Kuala Lumpur", lat: 3.135, lng: 101.685 },
  { label: "Petaling Jaya", lat: 3.105, lng: 101.605 },
  { label: "George Town", lat: 5.415, lng: 100.325 },
  { label: "Johor Bahru", lat: 1.465, lng: 103.755 },
] as const;

const SEED_HALF_SPAN = 0.055;

/**
 * Which box to ask for places, given what is on screen.
 *
 * SNAPS to a seeded city box when the view sits inside one, and that is the
 * difference between instant and unreliable. The snapshot exists because
 * Overpass, measured across these same four cities in one sitting, answered
 * fully for one, partially for another, 504'd a third and throttled the
 * fourth — fine from volunteer infrastructure, not acceptable on a page load.
 * An arbitrary viewport would miss the cache key every time and fall through
 * to exactly that live call.
 *
 * Anywhere else still passes the raw view through, so the feature is not
 * restricted to four cities — it is merely reliable in them.
 */
export function amenityBoxFor(view: Bounds): Bounds {
  const lat = (view.north + view.south) / 2;
  const lng = (view.east + view.west) / 2;

  for (const city of SEEDED_CITIES) {
    if (Math.abs(lat - city.lat) <= SEED_HALF_SPAN && Math.abs(lng - city.lng) <= SEED_HALF_SPAN) {
      return {
        west: city.lng - SEED_HALF_SPAN,
        east: city.lng + SEED_HALF_SPAN,
        south: city.lat - SEED_HALF_SPAN,
        north: city.lat + SEED_HALF_SPAN,
      };
    }
  }

  return view;
}
