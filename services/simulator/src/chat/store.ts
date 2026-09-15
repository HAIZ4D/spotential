import { createHash } from "node:crypto";
import type { AgentReading } from "./agents.js";

/**
 * The AI readings cache, shared by both panels.
 *
 * The location panel renders on every view of a location and the comparison
 * panel on every view of a comparison, so without this each would be a handful
 * of Gemini calls per page load, per refresh, and per person opening a shared
 * link. Cached, a location or a comparison costs its calls once a week.
 *
 * KEYED ON A HASH OF THE FACT SHEET, not on the coordinates alone. That is the
 * part worth keeping: if any underlying figure moves, a competitor opens, the
 * user types a real rent, the radius changes, the key changes and the readings
 * regenerate. A cache keyed on position would happily serve prose describing
 * numbers that are no longer on the screen beside it, which is the exact
 * contradiction this product refuses everywhere else.
 */

export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedReadings {
  key: string;
  readings: AgentReading[];
  generatedAt: number;
}

export interface ReadingsStore {
  find(key: string): Promise<CachedReadings | null>;
  save(entry: CachedReadings): Promise<void>;
}

/**
 * THE SHAPE OF WHAT IS STORED, not just its content.
 *
 * Bump a version whenever the stored type changes. Caught in production and
 * nowhere else: the key was once a hash of the fact sheet alone, so when the
 * briefing grew an `opportunity` block, entries written by the previous
 * revision were still served, and the new UI rendered a gap section with an
 * empty heading for every location briefed in the past seven days.
 *
 * A cache key has to cover the SHAPE of what it stores as well as the inputs
 * that produced it. Hashing the facts told us the figures had not moved; it
 * could not know the reader now expects more fields than the writer wrote.
 *
 * THE TWO PANELS VERSION SEPARATELY. They store the same type but evolve on
 * their own schedules, and one version would mean a change to either silently
 * invalidating the other, which is waste. It would also mean forgetting to
 * bump when only one changes, which IS the bug above.
 */
const READINGS_SHAPE_VERSION = "1-three-agents";

/** Hex digest of the facts plus the readings shape version. */
export function readingsKey(facts: string): string {
  return createHash("sha256")
    .update(`compare:${READINGS_SHAPE_VERSION}\n${facts}`)
    .digest("hex")
    .slice(0, 40);
}

/**
 * The location panel's four specialists, stored in the same shape.
 *
 * A DIFFERENT PREFIX, not a different store. The entries are `AgentReading[]`
 * either way, so the type and the collection are shared; what must never be
 * shared is the key space, because a location fact sheet and a comparison fact
 * sheet are different documents that could in principle hash alike, and
 * serving one as the other would put a comparison's prose under a single
 * site's figures.
 *
 * Its own version, for the reason stated above: a change to the comparison
 * roster must not quietly invalidate this one, and forgetting to bump when
 * only this one changes is the failure that actually reached production.
 */
const LOCATION_READINGS_SHAPE_VERSION = "1-four-agents";

export function locationReadingsKey(facts: string): string {
  return createHash("sha256")
    .update(`location:${LOCATION_READINGS_SHAPE_VERSION}\n${facts}`)
    .digest("hex")
    .slice(0, 40);
}

const COLLECTION = "aiBriefings";

const isFresh = (entry: { generatedAt: number }) => Date.now() - entry.generatedAt < CACHE_TTL_MS;

interface FirestoreLike {
  collection(name: string): {
    doc(id: string): {
      get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
      set(data: Record<string, unknown>): Promise<void>;
    };
  };
}

/**
 * One implementation, two entry shapes.
 *
 * Generic over the payload rather than duplicated, because the caching rules
 * are identical: same collection, same TTL, expiry treated as a miss. The key
 * functions are what keep the two apart, and they hash different prefixes so a
 * comparison can never collide with a location.
 */
class FirestoreCache<T extends { key: string; generatedAt: number }> {
  constructor(private db: FirestoreLike) {}

  async find(key: string): Promise<T | null> {
    const snapshot = await this.db.collection(COLLECTION).doc(key).get();
    if (!snapshot.exists) return null;

    const data = snapshot.data();
    if (!data) return null;

    // Expired is a miss rather than a delete: the write that replaces it costs
    // the same and saves a round-trip.
    const entry = data as unknown as T;
    return isFresh(entry) ? entry : null;
  }

  async save(entry: T): Promise<void> {
    await this.db
      .collection(COLLECTION)
      .doc(entry.key)
      .set(entry as unknown as Record<string, unknown>);
  }
}

class MemoryCache<T extends { key: string; generatedAt: number }> {
  private entries = new Map<string, T>();

  async find(key: string): Promise<T | null> {
    const found = this.entries.get(key);
    return found && isFresh(found) ? found : null;
  }

  async save(entry: T): Promise<void> {
    this.entries.set(entry.key, entry);
  }

  get size(): number {
    return this.entries.size;
  }
}

export class FirestoreReadingsStore
  extends FirestoreCache<CachedReadings>
  implements ReadingsStore {}

/** For tests and for local development without Firestore credentials. */
export class InMemoryReadingsStore extends MemoryCache<CachedReadings> implements ReadingsStore {}
