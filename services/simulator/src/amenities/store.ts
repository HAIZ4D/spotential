import type { AmenitiesResult, Bounds } from "./overpass.js";

/**
 * The amenities cache.
 *
 * Longer-lived than anything else in the app, on purpose. Property listings
 * change daily and competitors change monthly, but a railway station is where
 * it was last week — so a week of caching costs the user nothing in accuracy
 * and reduces our load on a volunteer-run service to roughly four queries a
 * week across all four cities.
 *
 * That ratio is the whole justification for fetching Overpass at all.
 */

export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedAmenities {
  key: string;
  layers: AmenitiesResult["layers"];
  places: AmenitiesResult["places"];
  fetchedAt: number;
}

export interface AmenitiesStore {
  find(bounds: Bounds): Promise<CachedAmenities | null>;
  save(entry: CachedAmenities): Promise<void>;
}

/**
 * Bounds rounded to ~1km before they become a key.
 *
 * The client sends a fixed box per city, but a hand-built request one metre
 * off would otherwise miss the cache and cost a fresh Overpass query. Two
 * decimal places is about 1.1km — coarse enough to absorb that, fine enough
 * that two genuinely different cities never collide.
 */
export function cacheKey(bounds: Bounds): string {
  const r = (n: number) => n.toFixed(2);
  return `${r(bounds.west)},${r(bounds.south)},${r(bounds.east)},${r(bounds.north)}`.replace(
    /[^0-9a-z.,-]/gi,
    "",
  );
}

export function isFresh(entry: CachedAmenities, now = Date.now()): boolean {
  return now - entry.fetchedAt < CACHE_TTL_MS;
}

export interface FirestoreLike {
  collection(path: string): {
    doc(id: string): {
      get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
      set(data: Record<string, unknown>): Promise<unknown>;
    };
  };
}

const COLLECTION = "cityAmenities";

export class FirestoreAmenitiesStore implements AmenitiesStore {
  constructor(private db: FirestoreLike) {}

  async find(bounds: Bounds): Promise<CachedAmenities | null> {
    const snapshot = await this.db.collection(COLLECTION).doc(cacheKey(bounds)).get();
    if (!snapshot.exists) return null;

    const data = snapshot.data();
    if (!data) return null;

    const entry = data as unknown as CachedAmenities;
    return isFresh(entry) ? entry : null;
  }

  async save(entry: CachedAmenities): Promise<void> {
    await this.db
      .collection(COLLECTION)
      .doc(entry.key)
      .set(entry as unknown as Record<string, unknown>);
  }
}

/** For tests and local development without Firestore credentials. */
export class InMemoryAmenitiesStore implements AmenitiesStore {
  private entries = new Map<string, CachedAmenities>();

  async find(bounds: Bounds): Promise<CachedAmenities | null> {
    const found = this.entries.get(cacheKey(bounds));
    return found && isFresh(found) ? found : null;
  }

  async save(entry: CachedAmenities): Promise<void> {
    this.entries.set(entry.key, entry);
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * Cache-first lookup. Mirrors the listings store deliberately.
 *
 * A failed fetch is never cached: Overpass throttling is transient, and
 * writing a week-long empty entry because of one 429 would be by far the
 * worst possible response to a temporary problem.
 */
export async function loadAmenities(
  store: AmenitiesStore,
  bounds: Bounds,
  fetcher: (bounds: Bounds) => Promise<AmenitiesResult>,
  options: { allowFetch: boolean; now?: number },
): Promise<AmenitiesResult & { fromCache: boolean }> {
  const cached = await store.find(bounds);
  if (cached) {
    return {
      layers: cached.layers,
      places: cached.places,
      available: true,
      reason: null,
      fromCache: true,
    };
  }

  if (!options.allowFetch) {
    return { layers: [], places: [], available: false, reason: "quota", fromCache: false };
  }

  const result = await fetcher(bounds);

  if (result.available) {
    await store.save({
      key: cacheKey(bounds),
      layers: result.layers,
      places: result.places,
      fetchedAt: options.now ?? Date.now(),
    });
  }

  return { ...result, fromCache: false };
}
