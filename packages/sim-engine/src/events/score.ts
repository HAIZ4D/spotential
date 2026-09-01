import { r2 } from "../basis.js";
import { catchmentPercentile, type ScoreDimension, type ScoreKind } from "../score.js";
import { CATEGORY_PRESETS } from "../presets/categories.js";
import { distanceMetres } from "../geo.js";
import { sectorOf } from "../presets/categories.js";
import type { EventListing, VendorProfile } from "./types.js";

/**
 * The Event Opportunity Score — how well one event suits one vendor.
 *
 * Built on the same bones as `scoreLocation()`: dimensions that each declare
 * whether they are `direct`, `proxy` or `unavailable`, weights renormalised
 * over whatever could actually be evaluated, and a plain-language note per
 * axis. Reusing `ScoreDimension` rather than inventing a parallel vocabulary
 * is deliberate — the UI components, the colour bands and the reader's mental
 * model all carry across unchanged.
 *
 * WHAT MAKES THIS DIFFERENT FROM SCORING A LOCATION, and it is the whole
 * reason this file needs care: a location analysis is assembled from parties
 * with no stake in the answer — Places, DOSM, Kontur. An event listing is
 * written BY THE PERSON SELLING THE BOOTH. Some of what they write is a
 * verifiable commitment (price, dates, slot count; get those wrong and vendors
 * turn up and complain). One thing is pure marketing: the expected visitor
 * count. Nobody audits it, and a bigger number sells more booths.
 *
 * So the weights are not a guess about what matters to a business. As in
 * `score.ts`, THEY REFLECT HOW MUCH THE SIGNAL CAN BE TRUSTED — which puts
 * the organizer's own turnout claim at the bottom of the board, beneath even
 * the supporting geography.
 *
 * And as with the Success Score: this ranks, it does not forecast. Nothing
 * here has been validated against how any vendor actually traded.
 */

/**
 * Exported so tests can verify renormalisation EXACTLY.
 *
 * `overall` is computed from these raw values and the per-dimension weights
 * are only rounded afterwards for display, so a test recomputing from the
 * rounded figures can never match to full precision. Reading the real ones
 * keeps that assertion sharp instead of loosening its tolerance.
 */
export const EVENT_SCORE_WEIGHTS = {
  /** A verifiable commitment, and the axis that can rule an event out outright. */
  categoryFit: 0.28,
  /** The booth price is a hard number the organizer is bound to. */
  boothAffordability: 0.24,
  /** Derived from stated slot counts. */
  vendorCompetition: 0.18,
  /** Measured from coordinates — nobody's claim at all. */
  travel: 0.12,
  /** Measured, but only loosely relevant here. See `catchmentScore`. */
  catchment: 0.1,
  /** The organizer's own marketing figure. Lowest weight on the board. */
  visitorDraw: 0.08,
} as const;

const WEIGHTS = EVENT_SCORE_WEIGHTS;

const clamp = (value: number): number => Math.max(0, Math.min(100, value));

export interface EventScoreInputs {
  event: EventListing;
  vendor: VendorProfile;
  /**
   * Residents around the venue, from the free 400m population grid. Optional:
   * the browse list scores without it so the page costs nothing to render.
   */
  venueCatchment?: number | null;
  catchmentRadiusMetres?: number;
}

export interface EventScore {
  overall: number;
  dimensions: ScoreDimension[];
  completeness: number;
  /** Cheapest booth, RM — what the affordability axis was judged against. */
  entryPriceRm: number | null;
}

/**
 * Does the organizer want this vendor at all?
 *
 * The one axis that can disqualify an event outright, which is why it carries
 * the most weight. An empty wanted-list is a real and common case — plenty of
 * bazaars take all comers — and is scored as genuine openness rather than as a
 * mismatch, but marked `proxy` because we are inferring acceptance rather than
 * reading it.
 */
function categoryFitScore(inputs: EventScoreInputs): {
  score: number;
  kind: ScoreKind;
  note: string;
} {
  const { event, vendor } = inputs;
  const wanted = event.wantedCategories;

  if (wanted.length === 0) {
    return {
      score: 70,
      kind: "proxy",
      note: "Open to all vendor types. No category list published, so acceptance is likely but not stated.",
    };
  }

  if (wanted.includes(vendor.category)) {
    return {
      score: 100,
      kind: "direct",
      note: `The organizer is specifically recruiting ${CATEGORY_PRESETS[vendor.category].label}.`,
    };
  }

  const vendorSector = sectorOf(vendor.category);
  const sectorWanted = wanted.some((c) => sectorOf(c) === vendorSector);

  if (sectorWanted) {
    return {
      score: 62,
      kind: "direct",
      note: `Not on the wanted list, but the organizer is recruiting other ${vendorSector === "fnb" ? "food and beverage" : vendorSector} vendors. Worth asking.`,
    };
  }

  return {
    score: 12,
    kind: "direct",
    note: "The organizer is recruiting different kinds of vendor. A booth here would be an outlier.",
  };
}

/**
 * Can the vendor afford the cheapest way in?
 *
 * Judged against a stated budget where there is one — that is the vendor's own
 * figure and the most reliable input on the page. Without it, the fallback
 * compares the booth against what the category could plausibly turn over
 * across the run, which is inference and labelled as such.
 */
function affordabilityScore(inputs: EventScoreInputs, entryPriceRm: number | null): {
  score: number;
  kind: ScoreKind;
  note: string;
} {
  const { event, vendor } = inputs;

  /**
   * An unpublished price is INFORMATION, not a gap — and treating it as a gap
   * was a real defect, caught by looking at the ranked list rather than by any
   * test.
   *
   * Renormalising over available dimensions is right when data is genuinely
   * unobtainable (nobody measured the population there). It is wrong here,
   * because the missing figure is one the organizer chose not to publish. When
   * this axis went `unavailable` its 0.24 weight was redistributed to the
   * others, so an event with no price scored HIGHER than an identical event
   * that published an honest one — putting "price on request" at the top of
   * the list and rewarding exactly the behaviour a vendor is worst served by.
   *
   * So it scores as the moderate negative it actually is for an MSME, who has
   * to budget before committing a weekend and a van. Marked `proxy`, because
   * the number is a judgement rather than a measurement, and the note says so.
   */
  if (entryPriceRm === null) {
    return {
      score: 40,
      kind: "proxy",
      note: "No booth price published. You cannot budget for this event without asking, which is a real cost of its own.",
    };
  }

  const priceText = `RM${entryPriceRm.toLocaleString("en-MY")}`;

  if (vendor.boothBudgetRm !== null && vendor.boothBudgetRm > 0) {
    const ratio = entryPriceRm / vendor.boothBudgetRm;
    // 0.3 of budget scores full marks; 1.2x budget scores zero. Sitting exactly
    // at budget is affordable but leaves nothing over, so it lands near 22.
    const score = r2(clamp(100 - ((ratio - 0.3) / 0.9) * 100));

    return {
      score,
      kind: "direct",
      note:
        ratio > 1
          ? `${priceText} is above the RM${vendor.boothBudgetRm.toLocaleString("en-MY")} budget you set.`
          : `${priceText}, ${Math.round(ratio * 100)}% of your stated booth budget.`,
    };
  }

  /**
   * No budget stated. Compare the booth against the category's own trading
   * potential over the run: a preset's daily takings times the number of days.
   * A coarse yardstick, and marked `proxy` accordingly.
   */
  const preset = CATEGORY_PRESETS[vendor.category];
  const days = eventDays(event);
  const potential = preset.avgPricePerTransaction * preset.customersPerDay * days;
  const share = potential > 0 ? entryPriceRm / potential : 1;

  // 4% of potential takings is a cheap booth; 25% is a heavy one.
  const score = r2(clamp(100 - ((share - 0.04) / 0.21) * 100));

  return {
    score,
    kind: "proxy",
    note: `${priceText} for ${days} day${days === 1 ? "" : "s"}, roughly ${Math.round(share * 100)}% of what a typical ${preset.label.toLowerCase()} might take over that run. Set a budget for a sharper read.`,
  };
}

/**
 * How many other stalls are chasing the same shoppers?
 *
 * Derived from stated totals, so `direct` — but the same-category figure is a
 * DIVISION, not a count the organizer published, and the note says so. This is
 * the event-scale version of competition density: a 40-booth bazaar gives a
 * vendor far more of the crowd than a 300-booth expo does.
 */
function competitionScore(inputs: EventScoreInputs): {
  score: number;
  kind: ScoreKind;
  note: string;
} {
  const { event } = inputs;

  if (event.totalSlots <= 0) {
    return {
      score: 0,
      kind: "unavailable",
      note: "The organizer has not published how many booths there are.",
    };
  }

  const categories = Math.max(1, event.wantedCategories.length);
  const estimatedRivals = Math.ceil(event.totalSlots / categories);

  const score =
    estimatedRivals <= 4
      ? 100
      : estimatedRivals <= 10
        ? 78
        : estimatedRivals <= 20
          ? 55
          : estimatedRivals <= 40
            ? 32
            : 15;

  const basis =
    event.wantedCategories.length > 0
      ? `roughly ${estimatedRivals} in your category if the ${event.totalSlots} booths split evenly across the ${event.wantedCategories.length} types wanted`
      : `${event.totalSlots} booths in total, with no category split published`;

  return { score, kind: "direct", note: `${basis}. Estimated, not published by the organizer.` };
}

/** Getting there and back, measured from coordinates rather than claimed. */
function travelScore(inputs: EventScoreInputs): {
  score: number;
  kind: ScoreKind;
  note: string;
} {
  const { event, vendor } = inputs;

  if (!vendor.base) {
    return {
      score: 0,
      kind: "unavailable",
      note: "Set where you are based to see how far this is.",
    };
  }

  const km = distanceMetres(vendor.base, event.point) / 1000;
  const rounded = Math.round(km);

  // 10km is a local run; 200km is a different state and an overnight stay.
  const score = r2(clamp(100 - ((km - 10) / 190) * 95));

  if (vendor.maxTravelKm !== null && km > vendor.maxTravelKm) {
    return {
      // Beyond a limit the vendor set themselves. Not zero — they may stretch
      // for the right event — but it must visibly cost the event points.
      score: r2(Math.min(score, 25)),
      kind: "direct",
      note: `${rounded}km away, beyond the ${vendor.maxTravelKm}km you said you would travel.`,
    };
  }

  return {
    score,
    kind: "direct",
    note: `${rounded}km from your base${rounded <= 25 ? ", a local run" : rounded >= 150 ? ", expect to stay over" : ""}.`,
  };
}

/**
 * Residents around the venue — and the axis most at risk of being over-read.
 *
 * For a permanent shop, the 500m catchment largely IS the market. For an
 * event it is not: people drive across a state for a good bazaar, and a
 * showground in a field can out-draw a mall. So this is kept as a supporting
 * signal on a low weight, and the note says outright what it does and does not
 * tell you. It is included because it is measured and free — the same Kontur
 * grid the heatmap and the Success Score already use, so a venue's catchment
 * here always agrees with what `/analysis` reports for the same point.
 */
function catchmentScore(inputs: EventScoreInputs): {
  score: number;
  kind: ScoreKind;
  note: string;
} {
  const catchment = inputs.venueCatchment;
  const radius = inputs.catchmentRadiusMetres ?? 500;

  if (typeof catchment !== "number" || catchment <= 0) {
    return {
      score: 0,
      kind: "unavailable",
      note: "No population data covers this venue.",
    };
  }

  const percentile = catchmentPercentile(catchment, radius);

  return {
    score: r2(clamp(percentile * 100)),
    kind: "direct",
    note: `${Math.round(catchment).toLocaleString("en-MY")} residents within ${radius}m, denser than ${Math.round(percentile * 100)}% of where Malaysians live. Supporting context only: events draw from far beyond their own doorstep.`,
  };
}

/**
 * The organizer's turnout claim, divided by their own booth count.
 *
 * Visitors per booth is the honest form of this number. Twenty thousand
 * visitors sounds decisive until you notice it is spread across three hundred
 * stalls. Even so it rests entirely on a figure supplied by the party selling
 * the booth, so it is `proxy`, carries the lowest weight, and the note names
 * its source every time it is shown.
 */
function visitorDrawScore(inputs: EventScoreInputs): {
  score: number;
  kind: ScoreKind;
  note: string;
} {
  const { event } = inputs;
  const visitors = event.expectedVisitors;

  if (visitors === null || visitors <= 0 || event.totalSlots <= 0) {
    return {
      score: 0,
      kind: "unavailable",
      // Never rendered as zero turnout: unstated and "we expect nobody" are
      // opposite claims and must not look alike.
      note: "The organizer has not stated an expected turnout.",
    };
  }

  const perBooth = visitors / event.totalSlots;

  const score =
    perBooth >= 600
      ? 100
      : perBooth >= 300
        ? 72
        : perBooth >= 150
          ? 45
          : perBooth >= 60
            ? 22
            : 8;

  return {
    score,
    kind: "proxy",
    note: `${visitors.toLocaleString("en-MY")} visitors expected across ${event.totalSlots} booths, about ${Math.round(perBooth)} per booth. The organizer's own estimate, not a measurement.`,
  };
}

/** Cheapest booth on offer — what a vendor actually has to find to get in. */
export function entryPrice(event: EventListing): number | null {
  const prices = event.packages.map((p) => p.priceRm).filter((p) => Number.isFinite(p) && p >= 0);
  return prices.length > 0 ? Math.min(...prices) : null;
}

/** Inclusive day count across the run. */
export function eventDays(event: EventListing): number {
  const start = Date.parse(event.startDate);
  const end = Date.parse(event.endDate);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1;
  return Math.round((end - start) / 86_400_000) + 1;
}

export function scoreEvent(inputs: EventScoreInputs): EventScore {
  const price = entryPrice(inputs.event);

  const fit = categoryFitScore(inputs);
  const afford = affordabilityScore(inputs, price);
  const competition = competitionScore(inputs);
  const travel = travelScore(inputs);
  const catchment = catchmentScore(inputs);
  const draw = visitorDrawScore(inputs);

  const dimensions: ScoreDimension[] = [
    {
      key: "categoryFit",
      label: "Category fit",
      score: fit.score,
      kind: fit.kind,
      weight: WEIGHTS.categoryFit,
      note: fit.note,
    },
    {
      key: "boothAffordability",
      label: "Booth affordability",
      score: afford.score,
      kind: afford.kind,
      weight: WEIGHTS.boothAffordability,
      note: afford.note,
    },
    {
      key: "vendorCompetition",
      label: "Stall competition",
      score: competition.score,
      kind: competition.kind,
      weight: WEIGHTS.vendorCompetition,
      note: competition.note,
    },
    {
      key: "travel",
      label: "Travel",
      score: travel.score,
      kind: travel.kind,
      weight: WEIGHTS.travel,
      note: travel.note,
    },
    {
      key: "catchment",
      label: "Area population",
      score: catchment.score,
      kind: catchment.kind,
      weight: WEIGHTS.catchment,
      note: catchment.note,
    },
    {
      key: "visitorDraw",
      label: "Expected draw",
      score: draw.score,
      kind: draw.kind,
      weight: WEIGHTS.visitorDraw,
      note: draw.note,
    },
  ];

  /**
   * Renormalise over what could actually be evaluated — the same rule as
   * `scoreLocation`, and it matters for the same reason: an event that has not
   * published a turnout figure must score exactly what it would have scored if
   * that axis had never existed, rather than being quietly punished for the
   * organizer's silence.
   */
  const available = dimensions.filter((d) => d.kind !== "unavailable");
  const totalWeight = available.reduce((sum, d) => sum + d.weight, 0);

  const overall =
    totalWeight > 0
      ? r2(available.reduce((sum, d) => sum + d.score * (d.weight / totalWeight), 0))
      : 0;

  for (const dimension of dimensions) {
    dimension.weight =
      totalWeight > 0 && dimension.kind !== "unavailable" ? r2(dimension.weight / totalWeight) : 0;
  }

  return {
    overall,
    dimensions,
    completeness: r2(available.length / dimensions.length),
    entryPriceRm: price,
  };
}

/** Best-first, for the browse list. Ties keep their incoming order. */
export function rankEvents(
  events: EventListing[],
  vendor: VendorProfile,
  catchments?: Map<string, number>,
): { event: EventListing; score: EventScore }[] {
  return events
    .map((event) => ({
      event,
      score: scoreEvent({
        event,
        vendor,
        venueCatchment: catchments?.get(event.id) ?? null,
      }),
    }))
    .sort((a, b) => b.score.overall - a.score.overall);
}
