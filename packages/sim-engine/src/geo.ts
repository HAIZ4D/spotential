/**
 * Geospatial primitives.
 *
 * In the engine rather than the web app because the server now needs the same
 * Haversine maths for in-memory radius filtering. Same reasoning as the
 * calculation engine: one implementation, imported by both sides, so a
 * distance shown in the browser and a distance used to filter on the server
 * cannot disagree.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Roughly the bounding box of Malaysia, generously padded.
 *
 * Not a security control — it catches a corrupted link or a transposed
 * lat/lng pair, which is far likelier than a hostile one.
 *
 * A box necessarily includes Singapore and southern Thailand, because
 * Malaysia wraps around them. Acceptable for what it is used for: warning
 * someone that the F&B presets were not researched for where they dropped
 * the pin.
 */
export const MALAYSIA_BOUNDS = { minLat: 0.5, maxLat: 7.5, minLng: 99.0, maxLng: 120.0 };

export function isValidLatLng(value: unknown): value is LatLng {
  if (value === null || typeof value !== "object") return false;
  const { lat, lng } = value as Partial<LatLng>;
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export function isInMalaysia(point: LatLng): boolean {
  return (
    point.lat >= MALAYSIA_BOUNDS.minLat &&
    point.lat <= MALAYSIA_BOUNDS.maxLat &&
    point.lng >= MALAYSIA_BOUNDS.minLng &&
    point.lng <= MALAYSIA_BOUNDS.maxLng
  );
}

/** Haversine distance in whole metres. */
export function distanceMetres(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export function formatLatLng({ lat, lng }: LatLng): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/**
 * Coordinate rounding for cache keys — the single most important cost control
 * in the competitor search.
 *
 * Three decimals is about 110m. Two clicks 20m apart therefore share one
 * cached result instead of billing Places twice. Without this the hit rate
 * would be near zero and the cache would be decorative.
 */
export const CACHE_COORD_DECIMALS = 3;

export function roundForCache(value: number): number {
  const factor = 10 ** CACHE_COORD_DECIMALS;
  return Math.round(value * factor) / factor;
}

/** [west, south, east, north] */
export type BoundingBox = [number, number, number, number];

/** A GeoJSON linear ring: [lng, lat] pairs, first point repeated at the end. */
export type Ring = [number, number][];

export function boundingBoxOf(rings: Ring[]): BoundingBox {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  return [west, south, east, north];
}

export function inBoundingBox(point: LatLng, [west, south, east, north]: BoundingBox): boolean {
  return point.lng >= west && point.lng <= east && point.lat >= south && point.lat <= north;
}

/**
 * Ray casting: count crossings of a horizontal ray to the east of the point.
 * Odd means inside.
 *
 * Dependency-free and adequate here. District polygons are large relative to
 * any precision concern, and this runs once per analysis rather than across a
 * grid — which is exactly why PostGIS is not warranted yet (CLAUDE.md).
 */
export function pointInRing(point: LatLng, ring: Ring): boolean {
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!;
    const b = ring[j]!;
    const [lngA, latA] = a;
    const [lngB, latB] = b;

    // Does the edge straddle the point's latitude?
    const straddles = latA > point.lat !== latB > point.lat;
    if (!straddles) continue;

    // Longitude where the edge crosses that latitude.
    const crossingLng = ((lngB - lngA) * (point.lat - latA)) / (latB - latA) + lngA;
    if (point.lng < crossingLng) inside = !inside;
  }

  return inside;
}

/**
 * A GeoJSON Polygon: first ring is the outer boundary, any others are holes.
 * A point in a hole is outside the polygon.
 */
export function pointInPolygon(point: LatLng, rings: Ring[]): boolean {
  const [outer, ...holes] = rings;
  if (!outer || !pointInRing(point, outer)) return false;
  return !holes.some((hole) => pointInRing(point, hole));
}

/**
 * Radius buckets, for the same reason: a 500m and a 520m search should not be
 * two different cache entries.
 */
export const RADIUS_BUCKETS = [250, 500, 1000, 2000] as const;

export function bucketRadius(radiusMetres: number): number {
  for (const bucket of RADIUS_BUCKETS) {
    if (radiusMetres <= bucket) return bucket;
  }
  return RADIUS_BUCKETS[RADIUS_BUCKETS.length - 1]!;
}
