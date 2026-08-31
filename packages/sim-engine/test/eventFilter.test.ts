import { describe, expect, it } from "vitest";
import { byStartDate, filterEvents, hasAvailability, isPast } from "../src/events/filter.js";
import type { EventListing } from "../src/events/types.js";

/**
 * Browse filters.
 *
 * The interesting cases are all boundaries, and two of them are the same class
 * of bug this codebase has already paid for elsewhere: a legitimate zero being
 * swallowed by a falsy check, and an absent value being treated as a stated one.
 */

const BASE: EventListing = {
  id: "e1",
  slug: "e1",
  name: "Terang Malam Market",
  summary: "",
  eventType: "bazaar",
  venueName: "Setia Ecohill Walk",
  address: "Semenyih, Selangor",
  state: "Selangor",
  point: { lat: 3.0, lng: 101.8 },
  startDate: "2026-10-01",
  endDate: "2026-10-03",
  dailyHours: "17:00 - 23:00",
  wantedCategories: ["korean_restaurant"],
  packages: [
    {
      id: "std",
      label: "Standard",
      priceRm: 900,
      sizeLabel: "3x3",
      slots: 40,
      slotsAvailable: 10,
      includes: [],
    },
  ],
  totalSlots: 40,
  availableSlots: 10,
  expectedVisitors: 20_000,
  vendorRequirements: [],
  organizerName: "Setia Events",
  source: "seed",
  sourceNote: "",
  reviewed: "2026-08-30",
};

/** Fixed "now" so these never start failing on a calendar boundary. */
const NOW = new Date("2026-09-15T12:00:00+08:00");

const make = (over: Partial<EventListing>): EventListing => ({ ...BASE, ...over });

describe("past events drop out", () => {
  it("keeps an event that is still to come", () => {
    expect(filterEvents([BASE], {}, NOW)).toHaveLength(1);
  });

  it("removes one that finished", () => {
    const done = make({ id: "old", startDate: "2026-08-01", endDate: "2026-08-03" });
    expect(filterEvents([done], {}, NOW)).toHaveLength(0);
  });

  it("keeps an event through the whole of its final day", () => {
    // Someone browsing on the last morning can still walk in. Comparing
    // date-only rather than by timestamp is what makes that true.
    const today = make({ startDate: "2026-09-14", endDate: "2026-09-15" });
    expect(isPast(today, NOW)).toBe(false);
  });
});

describe("price ceiling", () => {
  it("keeps a booth at exactly the ceiling", () => {
    expect(filterEvents([BASE], { maxBoothPriceRm: 900 }, NOW)).toHaveLength(1);
  });

  it("drops one a ringgit over", () => {
    expect(filterEvents([BASE], { maxBoothPriceRm: 899 }, NOW)).toHaveLength(0);
  });

  it("treats a ceiling of zero as a real request, not as no filter", () => {
    /**
     * `maxBoothPriceRm: 0` means "free booths only" and must not be swallowed
     * by a falsy check — the same trap as `Number("")` being 0 in the share
     * URLs, which once put a location in the Gulf of Guinea.
     */
    const free = make({
      id: "free",
      packages: [{ ...BASE.packages[0]!, priceRm: 0 }],
    });
    const result = filterEvents([BASE, free], { maxBoothPriceRm: 0 }, NOW);
    expect(result.map((e) => e.id)).toEqual(["free"]);
  });

  it("excludes an event with no published price rather than guessing", () => {
    // We do not know that it fits the budget. Assuming it does wastes the
    // vendor's time; assuming it does not is merely a missed listing they can
    // still find by clearing the filter.
    const unpriced = make({ id: "ask", packages: [] });
    expect(filterEvents([unpriced], { maxBoothPriceRm: 5_000 }, NOW)).toHaveLength(0);
    expect(filterEvents([unpriced], {}, NOW)).toHaveLength(1);
  });
});

describe("category", () => {
  it("matches an event recruiting that exact category", () => {
    expect(filterEvents([BASE], { category: "korean_restaurant" }, NOW)).toHaveLength(1);
  });

  it("hides an event recruiting something else", () => {
    expect(filterEvents([BASE], { category: "salon_barber" }, NOW)).toHaveLength(0);
  });

  it("keeps open-to-all events in every category search", () => {
    // An empty wanted-list means the organizer takes all comers, so it must
    // match every category rather than none.
    const open = make({ id: "open", wantedCategories: [] });
    expect(filterEvents([open], { category: "salon_barber" }, NOW)).toHaveLength(1);
  });

  it("can widen to the whole sector on request", () => {
    const result = filterEvents(
      [BASE],
      { category: "bubble_tea_dessert", sectorMatch: true },
      NOW,
    );
    expect(result).toHaveLength(1);
  });
});

describe("date window matches on OVERLAP", () => {
  it("keeps an event already running when the window opens", () => {
    // Containment would hide a bazaar a vendor could still join on day two.
    expect(filterEvents([BASE], { startsAfter: "2026-10-02" }, NOW)).toHaveLength(1);
  });

  it("drops one that ends before the window", () => {
    expect(filterEvents([BASE], { startsAfter: "2026-10-04" }, NOW)).toHaveLength(0);
  });

  it("drops one starting after the window closes", () => {
    expect(filterEvents([BASE], { endsBefore: "2026-09-30" }, NOW)).toHaveLength(0);
  });
});

describe("availability", () => {
  it("is reported by the organizer, never guaranteed by us", () => {
    expect(hasAvailability(BASE)).toBe(true);
    expect(hasAvailability(make({ availableSlots: 0 }))).toBe(false);
  });

  it("hides full events only when asked", () => {
    const full = make({ id: "full", availableSlots: 0 });
    expect(filterEvents([BASE, full], {}, NOW)).toHaveLength(2);
    expect(filterEvents([BASE, full], { availableOnly: true }, NOW).map((e) => e.id)).toEqual([
      "e1",
    ]);
  });
});

describe("free-text search", () => {
  it("matches name, venue and organizer alike", () => {
    for (const query of ["terang", "ecohill", "setia events"]) {
      expect(filterEvents([BASE], { query }, NOW)).toHaveLength(1);
    }
  });

  it("ignores case and surrounding space", () => {
    expect(filterEvents([BASE], { query: "  TERANG  " }, NOW)).toHaveLength(1);
  });

  it("treats an empty query as no filter at all", () => {
    expect(filterEvents([BASE], { query: "   " }, NOW)).toHaveLength(1);
  });
});

describe("byStartDate", () => {
  it("puts the soonest first and does not mutate its input", () => {
    const later = make({ id: "later", startDate: "2026-11-01", endDate: "2026-11-02" });
    const input = [later, BASE];
    expect(byStartDate(input).map((e) => e.id)).toEqual(["e1", "later"]);
    expect(input.map((e) => e.id)).toEqual(["later", "e1"]);
  });
});
