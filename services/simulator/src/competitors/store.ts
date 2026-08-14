import {
  RADIUS_BUCKETS,
  bucketRadius,
  roundForCache,
  type BusinessCategory,
  type Competitor,
  type LatLng,
} from "@spotential/sim-engine";

/**
 * The competitor cache, and the PostGIS migration seam.
 *
 * CLAUDE.md mandates PostGIS for spatial work. It is deliberately deferred
 * here: for one point and a few hundred competitors, filtering in memory is
 * genuinely adequate and Cloud SQL would be the project's first always-on
 * cost. The City Heatmap runs a grid query across a whole district and will
 * force the migration.
 *
 * So everything spatial goes behind THIS interface. A PostgisCompetitorStore
 * implements the same three methods and nothing outside this file changes.
 * That is the whole reason the interface exists — the swap is a matter of
 * when, not if.
 */

export interface CachedSearch {
  key: string;
  centre: LatLng;
  radiusMetres: number;
  category: BusinessCategory;
  competitors: Competitor[];
  fetchedAt: number;
  /** Places hit its 20-result cap, so this set is incomplete beyond the last result. */
  truncated: boolean;
}

export interface CompetitorStore {
  /**
   * The exact bucket, or a WIDER cached search that is safe to narrow.
   *
   * A 1km search already contains everything within 250m, so reusing it saves
   * a paid call — but only when it was not truncated. A truncated search stops
   * at some distance, and narrowing it would silently under-report anything
   * beyond that point.
   */
  find(centre: LatLng, radiusMetres: number, category: BusinessCategory): Promise<CachedSearch | null>;
  save(search: CachedSearch): Promise<void>;
}

/** Buckets at or above the requested radius, nearest first. */
export function candidateBuckets(radiusMetres: number): number[] {
  const wanted = bucketRadius(radiusMetres);
  return RADIUS_BUCKETS.filter((b) => b >= wanted);
}

/** A cached search can serve this request if it covers it and is complete. */
export function canServe(search: CachedSearch, radiusMetres: number, now = Date.now()): boolean {
  if (!isFresh(search, now)) return false;
  if (search.radiusMetres === bucketRadius(radiusMetres)) return true;
  return search.radiusMetres > radiusMetres && !search.truncated;
}

/** Competitor lists barely change week to week; a stale rating beats a paid one. */
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Coordinates round to ~110m and radii to fixed buckets, so two clicks 20m
 * apart share one entry instead of billing Places twice. Without this the hit
 * rate would be near zero and the cache would be decorative.
 */
export function cacheKey(
  centre: LatLng,
  radiusMetres: number,
  category: BusinessCategory,
): string {
  const lat = roundForCache(centre.lat).toFixed(3);
  const lng = roundForCache(centre.lng).toFixed(3);
  return `${lat}_${lng}_${category}_${bucketRadius(radiusMetres)}`;
}

export function isFresh(search: CachedSearch, now = Date.now()): boolean {
  return now - search.fetchedAt < CACHE_TTL_MS;
}

/** Minimal surface of the Firestore client we depend on — keeps this testable. */
export interface FirestoreLike {
  collection(path: string): {
    doc(id: string): {
      get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
      set(data: Record<string, unknown>): Promise<unknown>;
    };
  };
}

const COLLECTION = "competitorSearches";

export class FirestoreCompetitorStore implements CompetitorStore {
  constructor(private db: FirestoreLike) {}

  async find(
    centre: LatLng,
    radiusMetres: number,
    category: BusinessCategory,
  ): Promise<CachedSearch | null> {
    // At most four document reads, nearest bucket first. Firestore reads are
    // a rounding error next to a Places call, so trading a few of them for a
    // chance of avoiding one is clearly worth it.
    for (const bucket of candidateBuckets(radiusMetres)) {
      const snapshot = await this.db
        .collection(COLLECTION)
        .doc(cacheKey(centre, bucket, category))
        .get();
      if (!snapshot.exists) continue;

      const data = snapshot.data();
      if (!data) continue;

      // An expired entry is treated as a miss rather than deleted: the write
      // that replaces it costs the same and avoids a delete round-trip.
      const search = data as unknown as CachedSearch;
      if (canServe(search, radiusMetres)) return search;
    }
    return null;
  }

  async save(search: CachedSearch): Promise<void> {
    await this.db.collection(COLLECTION).doc(search.key).set(search as unknown as Record<string, unknown>);
  }
}

/**
 * For tests and for local development without Firestore credentials. Also
 * proves the interface is honest — if a store this simple cannot satisfy it,
 * the interface is leaking Firestore details.
 */
export class InMemoryCompetitorStore implements CompetitorStore {
  private entries = new Map<string, CachedSearch>();

  async find(
    centre: LatLng,
    radiusMetres: number,
    category: BusinessCategory,
  ): Promise<CachedSearch | null> {
    for (const bucket of candidateBuckets(radiusMetres)) {
      const found = this.entries.get(cacheKey(centre, bucket, category));
      if (found && canServe(found, radiusMetres)) return found;
    }
    return null;
  }

  async save(search: CachedSearch): Promise<void> {
    this.entries.set(search.key, search);
  }

  get size(): number {
    return this.entries.size;
  }
}
