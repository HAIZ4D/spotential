import type { PropertyListing } from "./propertyguru.js";

/**
 * The listings cache.
 *
 * Same shape as the competitor store, and for a sharper reason: every miss is
 * a request to somebody else's server. A day of caching turns "one fetch per
 * page view" into "one fetch per area per day", which is the difference
 * between being a nuisance to PropertyGuru and being invisible to them.
 *
 * Listings genuinely do change daily, so a longer TTL would start showing
 * units that are already let. A day is the honest ceiling.
 */

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface CachedListings {
  key: string;
  area: string;
  listings: PropertyListing[];
  fetchedAt: number;
}

export interface ListingsStore {
  find(area: string): Promise<CachedListings | null>;
  save(entry: CachedListings): Promise<void>;
}

/**
 * Areas are free text off a benchmark label or a DOSM district, so "Mont
 * Kiara", "mont kiara" and "Mont  Kiara" must not become three cache entries
 * and three fetches. Anything outside a-z0-9 collapses to a single hyphen,
 * which also keeps the key safe as a Firestore document id.
 */
export function cacheKey(area: string): string {
  const slug = area
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "unknown" : slug;
}

export function isFresh(entry: CachedListings, now = Date.now()): boolean {
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

const COLLECTION = "propertyListings";

export class FirestoreListingsStore implements ListingsStore {
  constructor(private db: FirestoreLike) {}

  async find(area: string): Promise<CachedListings | null> {
    const snapshot = await this.db.collection(COLLECTION).doc(cacheKey(area)).get();
    if (!snapshot.exists) return null;

    const data = snapshot.data();
    if (!data) return null;

    // Expired is treated as a miss rather than deleted — the write that
    // replaces it costs the same and saves a round-trip.
    const entry = data as unknown as CachedListings;
    return isFresh(entry) ? entry : null;
  }

  async save(entry: CachedListings): Promise<void> {
    await this.db
      .collection(COLLECTION)
      .doc(entry.key)
      .set(entry as unknown as Record<string, unknown>);
  }
}

/** For tests and for local development without Firestore credentials. */
export class InMemoryListingsStore implements ListingsStore {
  private entries = new Map<string, CachedListings>();

  async find(area: string): Promise<CachedListings | null> {
    const found = this.entries.get(cacheKey(area));
    return found && isFresh(found) ? found : null;
  }

  async save(entry: CachedListings): Promise<void> {
    this.entries.set(entry.key, entry);
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * Cache-first lookup.
 *
 * `allowFetch` is the quota gate, and a refusal is NOT an error: over the
 * ceiling we serve nothing rather than queueing more requests at a third
 * party. The caller renders plain portal links in that case, exactly as it
 * does before any listing has ever loaded.
 */
export async function loadListings(
  store: ListingsStore,
  area: string,
  fetcher: (area: string) => Promise<{ listings: PropertyListing[]; available: boolean; reason: string | null }>,
  options: { allowFetch: boolean; now?: number },
): Promise<{ listings: PropertyListing[]; fromCache: boolean; available: boolean; reason: string | null }> {
  const cached = await store.find(area);
  if (cached) {
    return { listings: cached.listings, fromCache: true, available: true, reason: null };
  }

  if (!options.allowFetch) {
    return { listings: [], fromCache: false, available: false, reason: "quota" };
  }

  const outcome = await fetcher(area);

  // Only a successful read is cached. Caching a failure would turn a transient
  // block into a day of empty panels.
  if (outcome.available) {
    await store.save({
      key: cacheKey(area),
      area,
      listings: outcome.listings,
      fetchedAt: options.now ?? Date.now(),
    });
  }

  return {
    listings: outcome.listings,
    fromCache: false,
    available: outcome.available,
    reason: outcome.reason,
  };
}
