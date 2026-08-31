import { r2 } from "../basis.js";
import { CATEGORY_PRESETS } from "../presets/categories.js";
import type { BusinessCategory } from "../types.js";

/**
 * Event ROI — the What-If Simulator aimed at a weekend instead of a year.
 *
 * WHY THIS IS NOT `simulate()`. That function models a permanent business:
 * monthly steady state, a ramp to maturity, rent, statutory payroll, a
 * multi-month payback. An event is two to eleven days with one fixed booth fee
 * and no ramp at all — you get the traffic the weekend gives you. Reshaping a
 * monthly scenario to fit would have meant inventing a rent, a ramp and a
 * staffing structure that do not exist, so this is its own small engine that
 * REUSES the same contribution-margin arithmetic and the same category
 * presets. One vocabulary, one set of cost ratios, two horizons.
 *
 * THE HEADLINE IS A RATIO, DELIBERATELY.
 *
 * The tempting output is projected profit: "you will make RM1,976". It would
 * be the least defensible number in the product. Profit here is the product of
 * a visitor figure invented by the party selling the booth and a capture rate
 * nobody can know in advance — two guesses multiplied together and printed to
 * the ringgit.
 *
 * So the headline is instead BREAK-EVEN CAPTURE RATE:
 *
 *     "1.2% of the 20,000 visitors the organizer claims must buy from you
 *      before you make a sen."
 *
 * That reframes an unverifiable claim into a judgement the vendor can actually
 * make. A stallholder knows from experience whether one in eighty passers-by
 * stopping is easy or fantasy, and they never have to believe the 20,000. It
 * is the same move the rent panel makes by expressing rent as customers per
 * day rather than as a percentage of revenue.
 *
 * And when the organizer states no visitor figure at all, the break-even
 * TRANSACTION count still stands on its own — "239 sales across three days" is
 * checkable against a vendor's own record of any previous weekend.
 */

export interface EventRoiInputs {
  /** Booth fee for the whole run, RM. */
  boothCostRm: number;
  days: number;
  /** The organizer's claim. Null when unstated — never treat as zero. */
  expectedVisitors: number | null;
  avgPricePerTransaction: number;
  /** Per-unit cost ratio, 0..1. */
  cogsPct: number;
  staffCount: number;
  /** Per person per day, RM. Event staff are paid by the day, not salaried. */
  dailyWagePerStaff: number;
  /** Transport, setup, decor, licences — everything else fixed for the run. */
  otherFixedRm: number;
}

export type RoiVerdict = "impossible" | "demanding" | "workable" | "comfortable" | "unknown";

export interface EventRoiAtCapture {
  captureRatePct: number;
  transactions: number;
  revenue: number;
  profit: number;
}

export interface EventRoi {
  /** Booth + staff + everything else owed whether or not anyone buys. */
  fixedCost: number;
  contributionPerTransaction: number;

  /**
   * Sales needed to cover `fixedCost`. Null only when each sale loses money,
   * which no amount of volume repairs.
   */
  breakEvenTransactions: number | null;
  /** Per trading day, which is how a stallholder actually thinks. */
  breakEvenPerDay: number | null;

  /**
   * THE HEADLINE. Share of the organizer's claimed visitors who must buy.
   * Null when no visitor figure was stated — the transaction count still is.
   */
  breakEvenCaptureRatePct: number | null;

  verdict: RoiVerdict;
  /** Plain-language reading, safe to print next to the figures. */
  note: string;
}

/** Seeds ROI inputs from the category preset, so ratios match the rest of the app. */
export function roiDefaults(category: BusinessCategory): {
  avgPricePerTransaction: number;
  cogsPct: number;
} {
  const preset = CATEGORY_PRESETS[category];
  return {
    avgPricePerTransaction: preset.avgPricePerTransaction,
    cogsPct: preset.cogsPct,
  };
}

/**
 * Capture rates a vendor can be asked to judge.
 *
 * A sweep rather than one number, for the same reason the simulator sweeps its
 * levers: a single projection invites belief, while a row of them makes the
 * sensitivity to an unknowable input impossible to miss.
 */
export const CAPTURE_RATE_SWEEP = [0.5, 1, 2, 3, 5] as const;

export function eventRoi(inputs: EventRoiInputs): EventRoi {
  const staffCost = inputs.staffCount * inputs.dailyWagePerStaff * inputs.days;
  const fixedCost = r2(inputs.boothCostRm + staffCost + inputs.otherFixedRm);

  const contributionPerTransaction = r2(inputs.avgPricePerTransaction * (1 - inputs.cogsPct));

  /**
   * Each sale loses money before the booth is even counted. That is a
   * MEASUREMENT rather than missing data, so it reports a verdict instead of
   * going quiet — the same call `rentSensitivity` makes in the same situation.
   */
  if (contributionPerTransaction <= 0) {
    return {
      fixedCost,
      contributionPerTransaction,
      breakEvenTransactions: null,
      breakEvenPerDay: null,
      breakEvenCaptureRatePct: null,
      verdict: "impossible",
      note: "Each sale loses money before the booth fee is counted. No amount of footfall fixes this.",
    };
  }

  const breakEvenTransactions = Math.ceil(fixedCost / contributionPerTransaction);
  const breakEvenPerDay = inputs.days > 0 ? Math.ceil(breakEvenTransactions / inputs.days) : null;

  const visitors = inputs.expectedVisitors;
  const breakEvenCaptureRatePct =
    visitors !== null && visitors > 0 ? r2((breakEvenTransactions / visitors) * 100) : null;

  return {
    fixedCost,
    contributionPerTransaction,
    breakEvenTransactions,
    breakEvenPerDay,
    breakEvenCaptureRatePct,
    ...verdictFor(breakEvenCaptureRatePct, breakEvenTransactions, breakEvenPerDay),
  };
}

/**
 * Bands on the capture rate, not on profit.
 *
 * The thresholds are judgement, not measurement, and are deliberately
 * conservative: retail conversion at a busy bazaar is single-digit percent, so
 * anything needing more than one visitor in twenty to buy JUST TO BREAK EVEN
 * is called demanding rather than promising.
 */
function verdictFor(
  capturePct: number | null,
  breakEvenTransactions: number,
  breakEvenPerDay: number | null,
): { verdict: RoiVerdict; note: string } {
  const volume =
    breakEvenPerDay !== null
      ? `${breakEvenTransactions} sales to break even, about ${breakEvenPerDay} a day`
      : `${breakEvenTransactions} sales to break even`;

  if (capturePct === null) {
    // No visitor claim to divide by — so say what IS known rather than
    // padding the sentence with a figure nobody supplied.
    return {
      verdict: "unknown",
      note: `${volume}. The organizer has not stated an expected turnout, so this cannot be expressed as a share of visitors.`,
    };
  }

  const share = `${capturePct}% of the visitors the organizer expects`;

  if (capturePct <= 1) {
    return {
      verdict: "comfortable",
      note: `${volume} — ${share}. Achievable for most stalls if the turnout holds.`,
    };
  }
  if (capturePct <= 3) {
    return {
      verdict: "workable",
      note: `${volume} — ${share}. Realistic, but the booth is not cheap relative to the crowd.`,
    };
  }
  if (capturePct <= 8) {
    return {
      verdict: "demanding",
      note: `${volume} — ${share}. That is a high conversion rate to merely break even.`,
    };
  }
  return {
    verdict: "impossible",
    note: `${volume} — ${share}. Well beyond normal event conversion; this booth is unlikely to pay for itself.`,
  };
}

/** Profit across a range of capture rates — never a single projection. */
export function roiSweep(inputs: EventRoiInputs): EventRoiAtCapture[] {
  const visitors = inputs.expectedVisitors;
  if (visitors === null || visitors <= 0) return [];

  const roi = eventRoi(inputs);

  return CAPTURE_RATE_SWEEP.map((captureRatePct) => {
    const transactions = Math.round((visitors * captureRatePct) / 100);
    const revenue = r2(transactions * inputs.avgPricePerTransaction);
    const profit = r2(transactions * roi.contributionPerTransaction - roi.fixedCost);
    return { captureRatePct, transactions, revenue, profit };
  });
}
