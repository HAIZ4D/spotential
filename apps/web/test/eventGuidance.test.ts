import { describe, expect, it } from "vitest";
import type { EventListing } from "@spotential/sim-engine";
import {
  buildGuidance,
  closingHour,
  looksOutdoor,
  openingHour,
} from "../src/components/events/guidance.js";

/**
 * The event page's guidance.
 *
 * Two properties are worth protecting here and only one of them is about
 * usefulness.
 *
 *   1. NOTHING WE WRITE MAY BE ATTRIBUTED TO THE ORGANIZER. The same page
 *      prints their real requirements verbatim, so advice in their voice would
 *      read as a term somebody has agreed to. The last test in this file walks
 *      every string and fails on any that names them.
 *   2. IT HAS TO BE DERIVED, not a static list wearing a derivation's clothes.
 *      "Bring your own lighting" is useful at a bazaar running to 11pm and
 *      noise at a morning market, and a section full of advice that does not
 *      apply teaches people to skip the section.
 */

const BASE: EventListing = {
  id: "evt-1",
  slug: "test-market",
  name: "Test Market",
  summary: "A market.",
  eventType: "market",
  venueName: "Some Field",
  address: "Somewhere, Selangor",
  state: "Selangor",
  point: { lat: 3.1, lng: 101.6 },
  startDate: "2099-09-19",
  endDate: "2099-09-20",
  dailyHours: "14:00 - 22:00",
  wantedCategories: ["cafe_coffee_shop"],
  packages: [
    {
      id: "std",
      label: "Standard",
      priceRm: 650,
      sizeLabel: "3m x 3m",
      slots: 20,
      slotsAvailable: 10,
      includes: [],
    },
  ],
  totalSlots: 20,
  availableSlots: 10,
  expectedVisitors: 8_000,
  vendorRequirements: ["Own canopy for outdoor lots"],
  organizerName: "Malayan Market",
  source: "seed",
  sourceNote: "Curated.",
  reviewed: "2026-09-13",
};

const titles = (items: { title: string }[]) => items.map((i) => i.title).join(" | ");

describe("reading the hours", () => {
  it("pulls the opening and closing hour out of the published range", () => {
    expect(openingHour("14:00 - 22:00")).toBe(14);
    expect(closingHour("14:00 - 22:00")).toBe(22);
    // The catalogue is not consistent about separators, and a poster is the
    // source for most of these.
    expect(openingHour("7.00 am - 11.00 pm")).toBe(7);
  });

  it("says nothing rather than guessing when the string is not a range", () => {
    expect(openingHour("all day")).toBeNull();
    expect(closingHour("TBC")).toBeNull();
  });
});

describe("reading the venue", () => {
  it("infers outdoors from what the organizer requires, not from a field", () => {
    // There is no `indoor` flag on a listing. A requirement to bring a canopy
    // is the organizer saying outdoors in the only place the data says
    // anything about it.
    expect(looksOutdoor(BASE)).toBe(true);
  });

  it("infers indoors from a mall or hall venue", () => {
    expect(looksOutdoor({ ...BASE, venueName: "IOI Galleria Bangi", vendorRequirements: [] })).toBe(
      false,
    );
  });

  it("reads a Malaysian public square as outdoors", () => {
    // `Dataran Putrajaya` was returning null, so a genuinely outdoor event got
    // no wet-weather guidance. Found by printing the output for real listings
    // rather than by a test, which is the argument for reading what a
    // derivation actually produces.
    expect(
      looksOutdoor({ ...BASE, venueName: "Dataran Putrajaya", vendorRequirements: [] }),
    ).toBe(true);
  });

  it("claims NOTHING when the listing does not say", () => {
    // Null, not false. An event we cannot place is not an indoor event, and
    // guessing would print wet-weather advice at a mall or withhold it from a
    // field.
    // A venue name that signals neither way. "Dataran" no longer belongs here:
    // it is a public square and now reads as outdoors, which is the point of
    // the test above this one.
    expect(looksOutdoor({ ...BASE, venueName: "Bayu Emas", vendorRequirements: [] })).toBeNull();
  });
});

describe("what the guidance actually says", () => {
  it("gives an outdoor event wet-weather guidance and an indoor one none", () => {
    const outdoor = buildGuidance(BASE, "cafe_coffee_shop");
    expect(titles(outdoor.doThis)).toMatch(/canopy/i);
    expect(titles(outdoor.askFirst)).toMatch(/rains/i);

    const indoor = buildGuidance(
      { ...BASE, venueName: "Suria KLCC", vendorRequirements: [] },
      "cafe_coffee_shop",
    );
    expect(titles(indoor.doThis)).not.toMatch(/canopy/i);
    expect(titles(indoor.askFirst)).not.toMatch(/rains/i);
  });

  it("asks for last edition's real footfall when no turnout is published", () => {
    const silent = buildGuidance({ ...BASE, expectedVisitors: null }, "cafe_coffee_shop");
    expect(titles(silent.askFirst)).toMatch(/how many people actually came/i);
  });

  it("leads with the price when no price is published, because everything waits on it", () => {
    const unpriced = buildGuidance({ ...BASE, packages: [] }, "cafe_coffee_shop");
    expect(unpriced.askFirst[0]?.title).toMatch(/what does a booth actually cost/i);
  });

  it("mentions lighting only for an event that trades after dark", () => {
    const evening = buildGuidance(BASE, "cafe_coffee_shop");
    expect(titles(evening.doThis)).toMatch(/light/i);

    const morning = buildGuidance({ ...BASE, dailyHours: "08:00 - 14:00" }, "cafe_coffee_shop");
    expect(titles(morning.doThis)).not.toMatch(/bring your own light/i);
  });

  it("gives food handling guidance to F&B and stock guidance to retail", () => {
    expect(titles(buildGuidance(BASE, "cafe_coffee_shop").doThis)).toMatch(/food handling/i);
    expect(titles(buildGuidance(BASE, "clothing_fashion").doThis)).not.toMatch(/food handling/i);
    expect(titles(buildGuidance(BASE, "clothing_fashion").doThis)).toMatch(/small stock/i);
  });

  it("warns a vendor whose category is not being recruited", () => {
    // The listing wants cafes. A barber reading it should be told before they
    // plan around a lot they may never be offered.
    const mismatch = buildGuidance(BASE, "salon_barber");
    expect(titles(mismatch.notThis)).toMatch(/not assume your category is wanted/i);
    expect(titles(buildGuidance(BASE, "cafe_coffee_shop").notThis)).not.toMatch(
      /not assume your category/i,
    );
  });

  it("flags a nearly-full event by naming what is actually left", () => {
    const nearlyFull = buildGuidance({ ...BASE, availableSlots: 3 }, "cafe_coffee_shop");
    expect(titles(nearlyFull.askFirst)).toMatch(/which lots are actually left/i);
    // And says the real numbers rather than "hurry".
    expect(nearlyFull.askFirst.map((i) => i.detail).join(" ")).toContain("17 of 20");
  });

  it("raises staffing only when the trading day is genuinely long", () => {
    const marathon = buildGuidance({ ...BASE, dailyHours: "07:00 - 23:00" }, "cafe_coffee_shop");
    expect(titles(marathon.doThis)).toMatch(/relief shift/i);
    expect(marathon.traits).toContain("16 hour days");

    // Eight hours is an ordinary day and needs no such note.
    expect(titles(buildGuidance(BASE, "cafe_coffee_shop").doThis)).not.toMatch(/relief shift/i);
  });

  it("says nothing about single-day storage on a one-day event", () => {
    const oneDay = buildGuidance(
      { ...BASE, startDate: "2099-09-19", endDate: "2099-09-19" },
      "cafe_coffee_shop",
    );
    expect(titles(oneDay.doThis)).not.toMatch(/split your stock/i);
    expect(titles(buildGuidance(BASE, "cafe_coffee_shop").doThis)).toMatch(/split your stock/i);
  });
});

describe("the attribution, which is the whole reason this is derived here", () => {
  it("NEVER puts words in the organizer's mouth", () => {
    /**
     * The page prints `vendorRequirements` verbatim under the organizer's
     * name, a few centimetres from this. If anything in here read as theirs, a
     * vendor deciding whether to pay them money would take our advice for
     * their terms. So no string may name them, and none may claim a rule.
     */
    const guidance = buildGuidance(BASE, "cafe_coffee_shop");
    const every = [...guidance.askFirst, ...guidance.doThis, ...guidance.notThis].flatMap((i) => [
      i.title,
      i.detail,
    ]);

    for (const line of every) {
      expect(line, line).not.toMatch(/Malayan Market/);
      expect(line, line).not.toMatch(/\b(?:they|the organizer) require/i);
      expect(line, line).not.toMatch(/you must\b/i);
    }

    // And it does refer to the organizer as somebody to ASK, which is the only
    // relationship this block is allowed to assert.
    expect(every.join(" ")).toMatch(/ask/i);
  });

  it("says plainly that Spotential cannot confirm a booking", () => {
    const guidance = buildGuidance(BASE, "cafe_coffee_shop");
    expect(guidance.notThis.map((i) => i.detail).join(" ")).toMatch(
      /Spotential is not a party to any of it/i,
    );
  });
});
