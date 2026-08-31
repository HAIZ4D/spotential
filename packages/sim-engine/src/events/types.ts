import type { BusinessCategory, BusinessSector } from "../types.js";
import type { LatLng } from "../geo.js";

/**
 * Events — the opportunity marketplace.
 *
 * Spotential already answers "is this a good place to open?" for a permanent
 * shop. This points the same engine at the far cheaper and far more common
 * MSME decision: WHICH BAZAAR OR EXPO IS WORTH A BOOTH NEXT MONTH. Same shape
 * — a location, a cost, a catchment, a break-even — so almost nothing here is
 * new maths; it is the existing maths aimed at a shorter horizon.
 *
 * THE ONE THING TO BE CAREFUL ABOUT is who supplies each number. A location
 * analysis is built from Places, DOSM and Kontur: third parties with no stake
 * in the answer. An event listing is written by THE PARTY SELLING THE BOOTH.
 * Booth price, slot count and dates are verifiable commitments; the expected
 * visitor figure is marketing. The type system separates them — see
 * `expectedVisitors` — and every consumer must keep them separate too.
 */

/** DOSM's own state names, so the events filter and demographics agree. */
export const MALAYSIAN_STATES = [
  "Johor",
  "Kedah",
  "Kelantan",
  "Melaka",
  "Negeri Sembilan",
  "Pahang",
  "Perak",
  "Perlis",
  "Pulau Pinang",
  "Sabah",
  "Sarawak",
  "Selangor",
  "Terengganu",
  "W.P. Kuala Lumpur",
  "W.P. Labuan",
  "W.P. Putrajaya",
] as const;

export type MalaysianState = (typeof MALAYSIAN_STATES)[number];

export const EVENT_TYPES = [
  "bazaar",
  "festival",
  "expo",
  "market",
  "pop_up",
  "carnival",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  bazaar: "Bazaar",
  festival: "Festival",
  expo: "Expo",
  market: "Market",
  pop_up: "Pop-up",
  carnival: "Carnival",
};

/**
 * One booth tier. Price is for the WHOLE RUN of the event, not per day —
 * quoting per-day next to a per-run price is how a vendor mis-reads a
 * five-figure commitment as a bargain.
 */
export interface BoothPackage {
  id: string;
  label: string;
  /** Total RM for the entire event, excluding deposit. */
  priceRm: number;
  sizeLabel: string;
  slots: number;
  slotsAvailable: number;
  /** What the fee actually covers — table, power, wifi, and so on. */
  includes: string[];
}

/**
 * Where a listing came from, and it is shown to the reader.
 *
 * `seed` is a curated entry with a source note and review date, following the
 * same house rule as the rent benchmarks. `organizer` is submitted through the
 * app. They render identically except for the label, because a reader deserves
 * to know which one they are looking at.
 */
export type EventSource = "seed" | "organizer";

export interface EventListing {
  id: string;
  slug: string;
  name: string;
  summary: string;
  eventType: EventType;

  venueName: string;
  address: string;
  state: MalaysianState;
  point: LatLng;

  /** ISO dates, inclusive. */
  startDate: string;
  endDate: string;
  dailyHours: string;

  /**
   * Which business categories the organizer is recruiting. Empty means open to
   * all — a real and common case, scored as such rather than as a mismatch.
   */
  wantedCategories: BusinessCategory[];

  packages: BoothPackage[];
  totalSlots: number;
  availableSlots: number;

  /**
   * THE ORGANIZER'S CLAIM, and never anything else.
   *
   * Not measured, not verifiable, and supplied by the party selling the booth.
   * Null when unstated — which must never be rendered as 0, because "we expect
   * nobody" and "they did not say" are opposite claims. Every dimension built
   * on this is `proxy` and carries the lowest weight on the board.
   */
  expectedVisitors: number | null;

  vendorRequirements: string[];
  organizerName: string;
  /** Where to actually apply. Ours is an intelligence layer, not the registry. */
  applyUrl?: string;

  source: EventSource;
  sourceNote: string;
  reviewed: string;
}

/**
 * What we know about the vendor doing the shopping.
 *
 * Every field beyond `category` is optional, and the score degrades honestly
 * as they are left blank rather than assuming a default: a vendor who has not
 * said their budget should see the affordability axis go unavailable, not see
 * a number invented for them.
 */
export interface VendorProfile {
  category: BusinessCategory;
  /** Where the vendor is based. Null means the travel axis goes unavailable. */
  base: LatLng | null;
  baseLabel?: string;
  /** Most the vendor will pay for a booth, RM for the whole run. */
  boothBudgetRm: number | null;
  /** How far they are willing to travel, km. */
  maxTravelKm: number | null;
  /** Overrides the category preset when the vendor knows their own average. */
  avgPricePerTransaction?: number;
}

export interface EventSectorFit {
  sector: BusinessSector;
  wanted: boolean;
}
