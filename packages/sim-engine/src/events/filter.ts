import type { BusinessCategory } from "../types.js";
import { sectorOf } from "../presets/categories.js";
import { entryPrice } from "./score.js";
import type { EventListing, EventType, MalaysianState } from "./types.js";

/**
 * Browse filters.
 *
 * Pure and shared, so the same predicate runs in the browser as on the server
 * — the client can filter a cached list instantly without a round trip, and a
 * server-side filter can never disagree with what the page shows.
 *
 * Every filter is OPTIONAL and absent means "do not narrow". The distinction
 * matters at the boundaries: `maxBoothPriceRm: 0` is a real request (free
 * booths only) and must not be swallowed by a falsy check, which is the same
 * class of bug as `Number("")` being 0 elsewhere in this codebase.
 */

export interface EventFilters {
  /** Case-insensitive match on name, venue, or address. */
  query?: string;
  state?: MalaysianState;
  eventType?: EventType;
  /** Events wanting this category, or open to all. */
  category?: BusinessCategory;
  /** Include the whole sector, not just the exact category. */
  sectorMatch?: boolean;
  /** Cheapest booth must be at or under this. */
  maxBoothPriceRm?: number;
  /** ISO dates. An event matches if its run OVERLAPS the window. */
  startsAfter?: string;
  endsBefore?: string;
  /** Hide events with no booths left. */
  availableOnly?: boolean;
}

/**
 * An event is "open" when the organizer says slots remain.
 *
 * Reported by the organizer and never guaranteed by us — which is exactly why
 * booking was scoped to applying rather than reserving. A vendor should read
 * this as "worth asking", not "held for you".
 */
export function hasAvailability(event: EventListing): boolean {
  return event.availableSlots > 0;
}

/** Has the run finished? Compared date-only, so an event is live all its last day. */
export function isPast(event: EventListing, now: Date = new Date()): boolean {
  const end = Date.parse(`${event.endDate}T23:59:59+08:00`);
  return Number.isFinite(end) && end < now.getTime();
}

export function matchesFilters(
  event: EventListing,
  filters: EventFilters,
  now: Date = new Date(),
): boolean {
  if (isPast(event, now)) return false;

  if (filters.query) {
    const needle = filters.query.trim().toLowerCase();
    if (needle.length > 0) {
      const haystack =
        `${event.name} ${event.venueName} ${event.address} ${event.organizerName}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
  }

  if (filters.state && event.state !== filters.state) return false;
  if (filters.eventType && event.eventType !== filters.eventType) return false;

  if (filters.category) {
    const wanted = event.wantedCategories;
    // An empty wanted-list means open to all, so it matches every category
    // rather than none — the opposite reading would hide the most accessible
    // events from every search.
    if (wanted.length > 0) {
      const exact = wanted.includes(filters.category);
      const sector =
        filters.sectorMatch === true &&
        wanted.some((c) => sectorOf(c) === sectorOf(filters.category as BusinessCategory));
      if (!exact && !sector) return false;
    }
  }

  // Explicit undefined check: 0 is a legitimate ceiling (free booths only).
  if (filters.maxBoothPriceRm !== undefined) {
    const price = entryPrice(event);
    // No published price cannot satisfy a price ceiling — we do not know that
    // it fits, and guessing in the vendor's favour wastes their time.
    if (price === null || price > filters.maxBoothPriceRm) return false;
  }

  if (filters.startsAfter) {
    const bound = Date.parse(filters.startsAfter);
    const ends = Date.parse(event.endDate);
    // Overlap, not containment: an event already running when the window
    // opens is still one a vendor can join.
    if (Number.isFinite(bound) && Number.isFinite(ends) && ends < bound) return false;
  }

  if (filters.endsBefore) {
    const bound = Date.parse(filters.endsBefore);
    const starts = Date.parse(event.startDate);
    if (Number.isFinite(bound) && Number.isFinite(starts) && starts > bound) return false;
  }

  if (filters.availableOnly === true && !hasAvailability(event)) return false;

  return true;
}

export function filterEvents(
  events: EventListing[],
  filters: EventFilters,
  now: Date = new Date(),
): EventListing[] {
  return events.filter((event) => matchesFilters(event, filters, now));
}

/** Soonest first — the default order before a vendor profile exists to rank by. */
export function byStartDate(events: EventListing[]): EventListing[] {
  return [...events].sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate));
}
