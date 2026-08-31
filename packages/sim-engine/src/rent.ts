import type { BusinessCategory, DistrictId, ScenarioInputs } from "./types.js";
import { core, operatingBreakEvenPerDay, r2, r4 } from "./basis.js";
import { CATEGORY_PRESETS, categoryDefaults } from "./presets/categories.js";
import { listDistricts, nearestDistrict, type DistrictPreset } from "./presets/districts.js";
import { distanceMetres, type LatLng } from "./geo.js";

/**
 * Rent sensitivity — Feature 1e, the fifth score dimension.
 *
 * Pure. No import from score.ts, so that score.ts can import this without a
 * cycle.
 *
 * THREE TIERS, EACH DECLARING WHAT IT IS:
 *
 *   1. The user types the rent they were actually quoted -> "direct".
 *      The most reliable number on the page.
 *   2. Nearest curated benchmark, if the pin falls inside its applicable
 *      radius -> "proxy". A researched estimate, and labelled as one.
 *   3. Neither -> null, and the dimension goes unavailable.
 *
 * Tier 3 is the one that matters. Coverage is 22 trading areas out of a whole
 * country, and a pin in Kuantan gets an empty axis rather than a national
 * average borrowed from data that does not describe it.
 */

/** What the user was actually quoted. Beats any benchmark. */
export interface RentOverride {
  /** RM per month. */
  monthlyRent: number;
  /** Optional, for the per-square-foot readout. */
  unitSqft?: number;
}

export interface ResolvedRent {
  monthlyRent: number;
  /** Null when the user gave a monthly figure without a unit size. */
  psf: number | null;
  unitSqft: number | null;
  kind: "direct" | "proxy";
  /** The benchmark used, or the nearest one for context when overridden. */
  district: DistrictPreset | null;
  /** Metres from the pin to that benchmark's centre. */
  distanceMetres: number | null;
  source: string;
  reviewed: string;
}

/**
 * The benchmark nearest a point regardless of whether it applies.
 *
 * Only ever used to fill ScenarioInputs.district, which the break-even maths
 * does not read — it feeds the simulator's "rent above market" warning. When
 * the user has supplied their own rent from outside every covered area, the
 * geographically nearest benchmark is still the most defensible reference,
 * and it is never presented to the user as though it applied.
 */
function nearestDistrictUnbounded(point: LatLng): DistrictPreset {
  let best = listDistricts()[0] as DistrictPreset;
  let bestMetres = distanceMetres(point, best.centre);

  for (const district of listDistricts()) {
    const metres = distanceMetres(point, district.centre);
    if (metres < bestMetres) {
      best = district;
      bestMetres = metres;
    }
  }

  return best;
}

export function resolveRent(
  point: LatLng,
  category: BusinessCategory,
  override?: RentOverride,
): ResolvedRent | null {
  const nearby = nearestDistrict(point);

  if (override && override.monthlyRent > 0) {
    // A unit size the user did not give is NOT assumed from the category — a
    // psf figure derived from a guessed area would be a made-up number
    // presented next to a real one.
    const unitSqft = override.unitSqft && override.unitSqft > 0 ? override.unitSqft : null;
    return {
      monthlyRent: r2(override.monthlyRent),
      psf: unitSqft ? r2(override.monthlyRent / unitSqft) : null,
      unitSqft,
      kind: "direct",
      district: nearby?.district ?? null,
      distanceMetres: nearby ? Math.round(nearby.distanceMetres) : null,
      source: "Rent quoted for this unit",
      reviewed: "",
    };
  }

  if (!nearby) return null;

  // Unit size comes from the CATEGORY, not the district: the question is what
  // a business of this kind would take here, and floor area is driven by the
  // format. The district's typicalUnitSqft stays for the simulator's own
  // seeding, which answers a different question.
  const unitSqft = CATEGORY_PRESETS[category].typicalUnitSqft;
  const psf = nearby.district.rentMedianPsf;

  return {
    monthlyRent: r2(psf * unitSqft),
    psf,
    unitSqft,
    kind: "proxy",
    district: nearby.district,
    distanceMetres: Math.round(nearby.distanceMetres),
    source: nearby.district.source,
    reviewed: nearby.district.reviewed,
  };
}

export type RentLight = "green" | "amber" | "red";

export interface RentSensitivity {
  score: number;
  kind: "direct" | "proxy";
  note: string;
  /** Transactions per day needed to cover fixed costs at this rent. */
  breakEvenPerDay: number | null;
  /** That figure as a share of the category's typical daily trade. */
  shareOfTypicalTrade: number | null;
  light: RentLight;
}

/**
 * SCORE ANCHORS — the share of typical trade consumed by break-even.
 *
 * 0.25: you cover your fixed costs on a quarter of what this format normally
 *       does. Comfortable.
 * 1.00: you need every bit of typical trade just to break even. No margin at
 *       all, and no room for a bad month.
 *
 * Both anchors are self-explanatory rather than tuned, which matters for a
 * figure nobody has validated against real outcomes.
 */
const COMFORTABLE_SHARE = 0.25;
const NO_MARGIN_SHARE = 1.0;

const GREEN_AT = 70;
const AMBER_AT = 40;

const clamp = (value: number): number => Math.max(0, Math.min(100, value));

/**
 * How much traffic this rent obliges you to win before you make a sen.
 *
 * NOT "cheaper is better" in isolation — a dead cheap area is not a good one.
 * But the upside of a location is already scored by competition, footfall and
 * catchment, so rent is left to answer one question on its own terms.
 *
 * The break-even covers ALL fixed costs, not rent alone, and that is
 * deliberate: nobody breaks even on rent by itself, so a rent-only figure
 * would be meaningless. Every other fixed cost is a category constant, so
 * BETWEEN TWO LOCATIONS the entire difference is rent — which is exactly the
 * comparison this score exists to serve.
 */
export function rentSensitivity(
  rent: ResolvedRent,
  category: BusinessCategory,
  point: LatLng,
): RentSensitivity {
  const preset = CATEGORY_PRESETS[category];
  const district: DistrictId = (rent.district?.id ??
    nearestDistrictUnbounded(point).id) as DistrictId;

  const inputs: ScenarioInputs = {
    ...categoryDefaults(category),
    district,
    monthlyRent: rent.monthlyRent,
  };

  const breakEvenPerDay = operatingBreakEvenPerDay(core(inputs));

  // Contribution per transaction is zero or negative, so no amount of trade
  // covers the fixed costs. That is a MEASUREMENT, not missing data — the
  // dimension keeps its kind and scores zero rather than going unavailable.
  if (breakEvenPerDay === null) {
    return {
      score: 0,
      kind: rent.kind,
      note: "Each sale loses money before rent is even counted. No volume fixes this.",
      breakEvenPerDay: null,
      shareOfTypicalTrade: null,
      light: "red",
    };
  }

  const share = breakEvenPerDay / preset.customersPerDay;
  const score = r2(
    clamp(100 * (1 - (share - COMFORTABLE_SHARE) / (NO_MARGIN_SHARE - COMFORTABLE_SHARE))),
  );

  const light: RentLight = score >= GREEN_AT ? "green" : score >= AMBER_AT ? "amber" : "red";

  const pct = Math.round(share * 100);
  const note =
    share >= NO_MARGIN_SHARE
      ? `Break-even needs ${breakEvenPerDay}/day, at or beyond the ${preset.customersPerDay}/day this format typically does.`
      : `Break-even needs ${breakEvenPerDay}/day, ${pct}% of the ${preset.customersPerDay}/day typical for this format.`;

  return {
    score,
    kind: rent.kind,
    note,
    breakEvenPerDay,
    shareOfTypicalTrade: r4(share),
    light,
  };
}
