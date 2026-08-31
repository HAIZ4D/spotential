import type { EventListing } from "@spotential/sim-engine";

/**
 * Booth applications, and the first thing Spotential has ever stored that
 * belongs to a person.
 *
 * Everything in Firestore until now was a CACHE: competitor searches, property
 * listings, amenity snapshots. All of it derived from public sources, all of
 * it disposable, none of it anyone's. An application is none of those things —
 * it carries a business name and a contact number, it belongs to exactly one
 * vendor, and an organizer will act on it.
 *
 * Three consequences, and they are the whole design of this file:
 *
 *   1. OWNERSHIP IS ENFORCED SERVER-SIDE, always. The uid comes from a
 *      verified ID token, never from the request body, and a read is filtered
 *      by that uid rather than trusting a client-supplied filter.
 *   2. THE BROWSER NEVER TOUCHES FIRESTORE. There is no client SDK and no
 *      security rules to misconfigure; the only path in is through Cloud Run,
 *      which already has App Check in front of it.
 *   3. WE STORE THE MINIMUM. What the organizer needs to reply, and nothing
 *      else. No browsing history, no score, no derived profile.
 */

export type ApplicationStatus = "submitted" | "withdrawn";

export interface BoothApplication {
  id: string;
  /** From the verified ID token. Never read from the request body. */
  uid: string;
  eventId: string;
  eventName: string;
  packageId: string | null;

  businessName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  /** What the vendor sells — free text they wrote themselves. */
  productDescription: string;

  status: ApplicationStatus;
  submittedAt: number;
}

/**
 * An organizer-submitted event, before and after review.
 *
 * `pending` is the default and is NOT publicly listed. An unreviewed listing
 * is an unverified claim about a real-world commitment — booth prices vendors
 * would pay and dates they would plan around — so it does not reach the browse
 * page until a human has looked at it.
 */
export type EventReviewStatus = "pending" | "published" | "rejected";

export interface SubmittedEvent {
  listing: EventListing;
  /** Owner uid, from the verified token. */
  uid: string;
  status: EventReviewStatus;
  submittedAt: number;
}

/** Minimal Firestore surface we depend on, so this stays testable. */
export interface FirestoreLike {
  collection(path: string): {
    doc(id: string): {
      get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
      set(data: Record<string, unknown>): Promise<unknown>;
    };
    where(
      field: string,
      op: string,
      value: unknown,
    ): {
      get(): Promise<{ docs: { data(): Record<string, unknown> | undefined }[] }>;
    };
  };
}

export interface ApplicationStore {
  save(application: BoothApplication): Promise<void>;
  /** Only ever this uid's own applications. */
  listForUser(uid: string): Promise<BoothApplication[]>;
  findForUserAndEvent(uid: string, eventId: string): Promise<BoothApplication | null>;
}

const APPLICATIONS = "boothApplications";

/**
 * One application per vendor per event.
 *
 * The id is derived rather than random, which makes a duplicate submission
 * idempotent instead of creating a second record an organizer has to
 * reconcile. A double-tapped Apply button is the most likely thing to happen
 * to this route on a phone.
 */
export function applicationId(uid: string, eventId: string): string {
  return `${uid}__${eventId}`;
}

export class FirestoreApplicationStore implements ApplicationStore {
  constructor(private db: FirestoreLike) {}

  async save(application: BoothApplication): Promise<void> {
    await this.db
      .collection(APPLICATIONS)
      .doc(application.id)
      .set(application as unknown as Record<string, unknown>);
  }

  async listForUser(uid: string): Promise<BoothApplication[]> {
    // Filtered by uid in the QUERY, not after the fact. A post-filter would
    // mean the whole collection crossed the wire before being narrowed.
    const snapshot = await this.db.collection(APPLICATIONS).where("uid", "==", uid).get();
    return snapshot.docs
      .map((d) => d.data() as unknown as BoothApplication)
      .filter((a): a is BoothApplication => Boolean(a));
  }

  async findForUserAndEvent(uid: string, eventId: string): Promise<BoothApplication | null> {
    const snapshot = await this.db
      .collection(APPLICATIONS)
      .doc(applicationId(uid, eventId))
      .get();
    if (!snapshot.exists) return null;
    const data = snapshot.data();
    return data ? (data as unknown as BoothApplication) : null;
  }
}

/** For tests and for local development without Firestore credentials. */
export class InMemoryApplicationStore implements ApplicationStore {
  private readonly rows = new Map<string, BoothApplication>();

  async save(application: BoothApplication): Promise<void> {
    this.rows.set(application.id, application);
  }

  async listForUser(uid: string): Promise<BoothApplication[]> {
    return [...this.rows.values()].filter((a) => a.uid === uid);
  }

  async findForUserAndEvent(uid: string, eventId: string): Promise<BoothApplication | null> {
    return this.rows.get(applicationId(uid, eventId)) ?? null;
  }
}
