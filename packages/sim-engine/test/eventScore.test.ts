import { describe, expect, it } from "vitest";
import {
  EVENT_SCORE_WEIGHTS,
  entryPrice,
  eventDays,
  rankEvents,
  scoreEvent,
} from "../src/events/score.js";
import type { EventListing, VendorProfile } from "../src/events/types.js";

/**
 * The Event Opportunity Score.
 *
 * Most of these tests defend one property: the score must never quietly
 * reward or punish an organizer for what they chose to publish. An event that
 * states no turnout figure has to score exactly what it would have scored if
 * that axis had never existed — otherwise the most honest organizers, the ones
 * who decline to invent a visitor number, rank lowest.
 */

const KL = { lat: 3.139, lng: 101.6869 };

const EVENT: EventListing = {
  id: "evt-1",
  slug: "terang-malam-market",
  name: "Terang Malam Market",
  summary: "Evening pop-up bazaar.",
  eventType: "bazaar",
  venueName: "Setia Ecohill Walk",
  address: "Semenyih, Selangor",
  state: "Selangor",
  point: { lat: 3.139, lng: 101.6869 },
  startDate: "2026-10-01",
  endDate: "2026-10-03",
  dailyHours: "17:00 - 23:00",
  wantedCategories: ["korean_restaurant", "cafe_coffee_shop"],
  packages: [
    {
      id: "std",
      label: "Standard",
      priceRm: 900,
      sizeLabel: "3m x 3m",
      slots: 30,
      slotsAvailable: 8,
      includes: ["Table", "Power point"],
    },
    {
      id: "premium",
      label: "Premium",
      priceRm: 1_600,
      sizeLabel: "3m x 6m",
      slots: 10,
      slotsAvailable: 2,
      includes: ["Table", "Power point", "Corner lot"],
    },
  ],
  totalSlots: 40,
  availableSlots: 10,
  expectedVisitors: 20_000,
  vendorRequirements: ["Own canopy", "Halal certification"],
  organizerName: "Setia Events",
  source: "seed",
  sourceNote: "Curated listing",
  reviewed: "2026-08-30",
};

const VENDOR: VendorProfile = {
  category: "korean_restaurant",
  base: KL,
  boothBudgetRm: 1_500,
  maxTravelKm: 60,
};

describe("category fit decides the most", () => {
  it("scores a specifically wanted category at full marks", () => {
    const fit = dimension(scoreEvent({ event: EVENT, vendor: VENDOR }), "categoryFit");
    expect(fit.score).toBe(100);
    expect(fit.kind).toBe("direct");
  });

  it("gives partial credit inside the same sector", () => {
    // Bubble tea is not on the wanted list, but the event clearly wants F&B.
    const vendor: VendorProfile = { ...VENDOR, category: "bubble_tea_dessert" };
    const fit = dimension(scoreEvent({ event: EVENT, vendor }), "categoryFit");
    expect(fit.score).toBeGreaterThan(50);
    expect(fit.score).toBeLessThan(100);
    expect(fit.note).toMatch(/Worth asking/);
  });

  it("marks an outright mismatch down hard", () => {
    const vendor: VendorProfile = { ...VENDOR, category: "salon_barber" };
    const fit = dimension(scoreEvent({ event: EVENT, vendor }), "categoryFit");
    expect(fit.score).toBeLessThan(20);
  });

  it("treats an empty wanted-list as open to all, not as a mismatch", () => {
    // The opposite reading would hide the most accessible events from everyone.
    const event: EventListing = { ...EVENT, wantedCategories: [] };
    const fit = dimension(scoreEvent({ event, vendor: VENDOR }), "categoryFit");
    expect(fit.score).toBeGreaterThan(50);
    // Inferred acceptance, not stated acceptance.
    expect(fit.kind).toBe("proxy");
  });
});

describe("affordability is judged against the vendor's own budget", () => {
  it("uses the cheapest package, not the headline one", () => {
    expect(entryPrice(EVENT)).toBe(900);
  });

  it("is direct evidence when a budget was set", () => {
    const afford = dimension(scoreEvent({ event: EVENT, vendor: VENDOR }), "boothAffordability");
    expect(afford.kind).toBe("direct");
    expect(afford.note).toMatch(/60% of your stated booth budget/);
  });

  it("says plainly when the booth is over budget", () => {
    const vendor: VendorProfile = { ...VENDOR, boothBudgetRm: 500 };
    const afford = dimension(scoreEvent({ event: EVENT, vendor }), "boothAffordability");
    expect(afford.score).toBe(0);
    expect(afford.note).toMatch(/above the RM500 budget/);
  });

  it("falls back to an inferred yardstick when no budget was given", () => {
    const vendor: VendorProfile = { ...VENDOR, boothBudgetRm: null };
    const afford = dimension(scoreEvent({ event: EVENT, vendor }), "boothAffordability");
    expect(afford.kind).toBe("proxy");
    expect(afford.note).toMatch(/Set a budget for a sharper read/);
  });

  /**
   * An unpublished price must COST the event points rather than exempt it.
   *
   * When this axis went unavailable its weight was redistributed across the
   * others, so an event hiding its price outranked one publishing an honest
   * one — a perverse incentive, and the reason "price on request" sat at the
   * top of the ranked list. Caught by looking at the rendered page.
   */
  it("scores an unpublished price as a real negative, never as an exemption", () => {
    const event: EventListing = { ...EVENT, packages: [] };
    const afford = dimension(scoreEvent({ event, vendor: VENDOR }), "boothAffordability");

    // Judgement, not measurement — so proxy, not direct, and never unavailable.
    expect(afford.kind).toBe("proxy");
    expect(afford.score).toBeLessThan(60);
    expect(afford.note).toMatch(/cannot budget for this event/);
  });

  it("never lets hiding the price beat publishing an affordable one", () => {
    // The regression this exists to prevent, stated as the property itself.
    const hidden = scoreEvent({ event: { ...EVENT, packages: [] }, vendor: VENDOR });
    const published = scoreEvent({ event: EVENT, vendor: VENDOR });
    expect(hidden.overall).toBeLessThan(published.overall);
  });
});

describe("travel is measured, not claimed", () => {
  it("goes unavailable rather than assuming a base", () => {
    const vendor: VendorProfile = { ...VENDOR, base: null };
    const travel = dimension(scoreEvent({ event: EVENT, vendor }), "travel");
    expect(travel.kind).toBe("unavailable");
  });

  it("costs the event points past a limit the vendor set", () => {
    const far: EventListing = { ...EVENT, point: { lat: 5.4141, lng: 100.3288 } };
    const travel = dimension(scoreEvent({ event: far, vendor: VENDOR }), "travel");
    expect(travel.score).toBeLessThanOrEqual(25);
    expect(travel.note).toMatch(/beyond the 60km/);
  });
});

/**
 * The organizer's turnout claim — the one number on an event listing written
 * by the party selling the booth, and the reason the weights are ordered the
 * way they are.
 */
describe("expected visitors is never treated as measurement", () => {
  it("is always a proxy, never direct", () => {
    const draw = dimension(scoreEvent({ event: EVENT, vendor: VENDOR }), "visitorDraw");
    expect(draw.kind).toBe("proxy");
    expect(draw.note).toMatch(/organizer's own estimate, not a measurement/);
  });

  it("carries the lowest weight of every available axis", () => {
    const score = scoreEvent({ event: EVENT, vendor: VENDOR, venueCatchment: 6_457 });
    const available = score.dimensions.filter((d) => d.kind !== "unavailable");
    const draw = available.find((d) => d.key === "visitorDraw");

    for (const other of available) {
      if (other.key === "visitorDraw") continue;
      expect(draw!.weight).toBeLessThanOrEqual(other.weight);
    }
  });

  it("divides the claim by the booth count rather than quoting it raw", () => {
    // 20,000 across 40 booths is 500 each; the same 20,000 across 300 booths
    // is a completely different proposition and must not score the same.
    const crowded: EventListing = { ...EVENT, totalSlots: 300 };
    const few = dimension(scoreEvent({ event: EVENT, vendor: VENDOR }), "visitorDraw");
    const many = dimension(scoreEvent({ event: crowded, vendor: VENDOR }), "visitorDraw");
    expect(many.score).toBeLessThan(few.score);
  });

  it("goes unavailable when unstated, and says so in words", () => {
    const event: EventListing = { ...EVENT, expectedVisitors: null };
    const draw = dimension(scoreEvent({ event, vendor: VENDOR }), "visitorDraw");
    expect(draw.kind).toBe("unavailable");
    expect(draw.note).toMatch(/has not stated an expected turnout/);
    // A zero would read as "nobody is coming", which is a different claim.
    expect(draw.note).not.toMatch(/\b0 visitors\b/);
  });
});

/**
 * The renormalisation guard — the same property that stopped adding rent from
 * silently repricing every published Success Score.
 */
describe("silence from the organizer does not lower the score", () => {
  it("scores an event with no turnout figure exactly as if that axis never existed", () => {
    const withClaim = scoreEvent({ event: EVENT, vendor: VENDOR });
    const withoutClaim = scoreEvent({
      event: { ...EVENT, expectedVisitors: null },
      vendor: VENDOR,
    });

    /**
     * Recomputed from the RAW weights, not the rounded ones the result
     * carries for display — otherwise this assertion would be measuring
     * rounding error rather than the property it exists to protect.
     */
    const others = withClaim.dimensions.filter(
      (d) => d.kind !== "unavailable" && d.key !== "visitorDraw",
    );
    const raw = (key: string) =>
      EVENT_SCORE_WEIGHTS[key as keyof typeof EVENT_SCORE_WEIGHTS];
    const weight = others.reduce((sum, d) => sum + raw(d.key), 0);
    const expected = others.reduce((sum, d) => sum + d.score * (raw(d.key) / weight), 0);

    expect(withoutClaim.overall).toBeCloseTo(expected, 2);
  });

  it("reports lower completeness so the reader knows less was known", () => {
    const withClaim = scoreEvent({ event: EVENT, vendor: VENDOR });
    const withoutClaim = scoreEvent({
      event: { ...EVENT, expectedVisitors: null },
      vendor: VENDOR,
    });
    expect(withoutClaim.completeness).toBeLessThan(withClaim.completeness);
  });

  it("keeps available weights summing to 1", () => {
    const score = scoreEvent({ event: EVENT, vendor: VENDOR, venueCatchment: 3_000 });
    const total = score.dimensions
      .filter((d) => d.kind !== "unavailable")
      .reduce((sum, d) => sum + d.weight, 0);
    expect(total).toBeCloseTo(1, 2);
  });

  it("zeroes the weight of every unavailable axis", () => {
    const score = scoreEvent({ event: EVENT, vendor: { ...VENDOR, base: null } });
    expect(score.dimensions.find((d) => d.key === "travel")!.weight).toBe(0);
  });
});

describe("venue catchment is supporting context only", () => {
  it("uses the same national percentile scale as the Success Score", () => {
    // 6,457 residents within 500m is the published central-KL figure, which
    // sits at the 87th percentile. One implementation, so the events page and
    // /analysis can never describe the same point differently.
    const c = dimension(
      scoreEvent({ event: EVENT, vendor: VENDOR, venueCatchment: 6_457 }),
      "catchment",
    );
    expect(c.note).toMatch(/denser than 87%/);
  });

  it("warns that events draw from beyond their doorstep", () => {
    const c = dimension(
      scoreEvent({ event: EVENT, vendor: VENDOR, venueCatchment: 6_457 }),
      "catchment",
    );
    expect(c.note).toMatch(/beyond their own doorstep/);
  });

  it("never outweighs category fit or affordability", () => {
    const score = scoreEvent({ event: EVENT, vendor: VENDOR, venueCatchment: 6_457 });
    const c = score.dimensions.find((d) => d.key === "catchment")!;
    const fit = score.dimensions.find((d) => d.key === "categoryFit")!;
    expect(c.weight).toBeLessThan(fit.weight);
  });
});

describe("eventDays", () => {
  it("counts inclusively, so a Sat-Sun run is two days", () => {
    expect(eventDays({ ...EVENT, startDate: "2026-10-03", endDate: "2026-10-04" })).toBe(2);
  });

  it("counts a single-day event as one", () => {
    expect(eventDays({ ...EVENT, startDate: "2026-10-03", endDate: "2026-10-03" })).toBe(1);
  });
});

describe("rankEvents", () => {
  it("puts the better fit first", () => {
    const mismatch: EventListing = {
      ...EVENT,
      id: "evt-2",
      wantedCategories: ["salon_barber"],
    };
    const ranked = rankEvents([mismatch, EVENT], VENDOR);
    expect(ranked[0]!.event.id).toBe("evt-1");
  });
});

function dimension(score: { dimensions: { key: string }[] }, key: string) {
  const found = score.dimensions.find((d) => d.key === key);
  if (!found) throw new Error(`no dimension ${key}`);
  return found as { key: string; score: number; kind: string; weight: number; note: string };
}
