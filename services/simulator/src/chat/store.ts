import { createHash } from "node:crypto";
import type { Briefing } from "./brief.js";

/**
 * The briefing cache.
 *
 * The panel renders on every location view, so without this it would be one
 * Gemini call per page load, per refresh, and per person opening a shared
 * link. Cached, a location costs one call a week.
 *
 * KEYED ON A HASH OF THE FACT SHEET, not on the coordinates alone. That is the
 * part worth keeping: if any underlying figure moves — a competitor opens, the
 * user types a real rent, the radius changes — the key changes and the
 * briefing regenerates. A cache keyed on position would happily serve prose
 * describing numbers that are no longer on the screen beside it, which is the
 * exact contradiction this product refuses everywhere else.
 */

export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedBriefing {
  key: string;
  briefing: Briefing;
  generatedAt: number;
}

export interface BriefingStore {
  find(key: string): Promise<CachedBriefing | null>;
  save(entry: CachedBriefing): Promise<void>;
}

/**
 * THE SHAPE OF A BRIEFING, not just its content.
 *
 * Bump this whenever the `Briefing` type changes. Caught in production and
 * nowhere else: the key was a hash of the fact sheet alone, so when the
 * briefing grew an `opportunity` block, entries written by the previous
 * revision were still served — and the new UI rendered a gap section with an
 * empty heading for every location briefed in the past seven days.
 *
 * A cache key has to cover the SHAPE of what it stores as well as the inputs
 * that produced it. Hashing the facts told us the figures had not moved; it
 * could not know the reader now expects more fields than the writer wrote.
 */
const SHAPE_VERSION = "2-opportunity";

/** Hex digest of the facts plus the shape version. Safe as a doc id. */
export function briefingKey(facts: string): string {
  return createHash("sha256")
    .update(`${SHAPE_VERSION}
${facts}`)
    .digest("hex")
    .slice(0, 40);
}

const COLLECTION = "aiBriefings";

const isFresh = (entry: CachedBriefing) => Date.now() - entry.generatedAt < CACHE_TTL_MS;

interface FirestoreLike {
  collection(name: string): {
    doc(id: string): {
      get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
      set(data: Record<string, unknown>): Promise<void>;
    };
  };
}

export class FirestoreBriefingStore implements BriefingStore {
  constructor(private db: FirestoreLike) {}

  async find(key: string): Promise<CachedBriefing | null> {
    const snapshot = await this.db.collection(COLLECTION).doc(key).get();
    if (!snapshot.exists) return null;

    const data = snapshot.data();
    if (!data) return null;

    // Expired is a miss rather than a delete: the write that replaces it costs
    // the same and saves a round-trip.
    const entry = data as unknown as CachedBriefing;
    return isFresh(entry) ? entry : null;
  }

  async save(entry: CachedBriefing): Promise<void> {
    await this.db
      .collection(COLLECTION)
      .doc(entry.key)
      .set(entry as unknown as Record<string, unknown>);
  }
}

/** For tests and for local development without Firestore credentials. */
export class InMemoryBriefingStore implements BriefingStore {
  private entries = new Map<string, CachedBriefing>();

  async find(key: string): Promise<CachedBriefing | null> {
    const found = this.entries.get(key);
    return found && isFresh(found) ? found : null;
  }

  async save(entry: CachedBriefing): Promise<void> {
    this.entries.set(entry.key, entry);
  }

  get size(): number {
    return this.entries.size;
  }
}
