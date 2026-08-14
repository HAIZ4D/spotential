import type { ScenarioInputs, StaffBreakdown } from "./types.js";
import { STATUTORY } from "./presets/statutory.js";
import { ramp } from "./ramp.js";

/**
 * Shared primitives. Lives below simulate/sensitivity/recovery in the import
 * graph so those three can all use it without a cycle.
 */

/** Months projected. Month 0 is the opening cash position, so 25 rows in total. */
export const HORIZON_MONTHS = 24;

/**
 * Round to 2dp, symmetric about zero, normalising -0 to 0.
 *
 * Internal maths runs at full float precision; every money field is rounded
 * once at result-construction time. That is what lets the client/server parity
 * test be a byte-for-byte deepEqual rather than an epsilon comparison.
 */
export function r2(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const s = x < 0 ? -1 : 1;
  const v = (s * Math.round(Math.abs(x) * 100)) / 100;
  return v === 0 ? 0 : v;
}

/** Round to 4dp for derived non-money values (trading days, ramp fractions, ratios). */
export function r4(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const s = x < 0 ? -1 : 1;
  const v = (s * Math.round(Math.abs(x) * 10000)) / 10000;
  return v === 0 ? 0 : v;
}

/**
 * Round up to a whole unit, or null when the answer is not a real answer.
 *
 * A contribution per transaction near zero makes fixed/contribution overflow,
 * and Math.ceil(Infinity) is Infinity — which would render in the UI as
 * "Infinity transactions/day". Anything past the safe-integer range is not a
 * number a user can act on, so it is reported as unreachable instead.
 */
export function safeCeilOrNull(x: number): number | null {
  if (!Number.isFinite(x)) return null;
  const v = Math.ceil(x);
  return Number.isSafeInteger(v) ? v : null;
}

export function tradingDaysPerMonth(inputs: ScenarioInputs): number {
  if (inputs.tradingDaysPerMonthOverride !== undefined) {
    return inputs.tradingDaysPerMonthOverride;
  }
  return (365 * (inputs.daysOpenPerWeek / 7)) / 12;
}

/** SPEC §4.3 — the pinned per-unit cost, or derived from the percentage if unpinned. */
export function cogsPerUnitOf(inputs: ScenarioInputs): number {
  return inputs.cogsPerUnitOverride ?? inputs.cogsPct * inputs.avgPricePerTransaction;
}

/**
 * Employer statutory contributions. EPF is TIERED and uncapped; SOCSO and EIS
 * are capped at a RM6,000 wage. They behave differently and must not be
 * collapsed into one blended rate.
 *
 * Employee-side EPF/SOCSO/EIS come out of the employee's own wage and are
 * already inside avgMonthlyWage — adding them here would double-count roughly
 * 11.7% of payroll.
 */
export function staffCostOf(staffCount: number, avgMonthlyWage: number): StaffBreakdown {
  const { epf, socso, eis } = STATUTORY;

  const epfRateApplied =
    avgMonthlyWage <= epf.tierWage ? epf.employerRateAtOrBelowTier : epf.employerRateAboveTier;

  const socsoBase = Math.min(avgMonthlyWage, socso.wageCeiling);
  const eisBase = Math.min(avgMonthlyWage, eis.wageCeiling);

  const baseWages = staffCount * avgMonthlyWage;
  const epfCost = staffCount * avgMonthlyWage * epfRateApplied;
  const socsoCost = staffCount * socsoBase * socso.employerRate;
  const eisCost = staffCount * eisBase * eis.employerRate;

  return {
    baseWages: r2(baseWages),
    epf: r2(epfCost),
    socso: r2(socsoCost),
    eis: r2(eisCost),
    total: r2(baseWages + epfCost + socsoCost + eisCost),
    epfRateApplied,
  };
}

/** Already rounded. simulate() renders these straight out rather than recomputing. */
export interface CoreMonth {
  ramp: number;
  transactions: number;
  revenue: number;
  cogs: number;
  serviceTax: number;
  profit: number;
  cumulative: number;
  cash: number;
}

/** Unrounded intermediates, shared by simulate(), the sensitivity sweep and recovery. */
export interface Core {
  tradingDays: number;
  monthlyTransactions: number;
  cogsPerUnit: number;
  contributionPerTransaction: number;
  /** Contribution net of the per-transaction service tax — what actually pays the fixed costs. */
  netContributionPerTransaction: number;
  revenue: number;
  annualRevenue: number;
  sstApplies: boolean;
  serviceTaxPerTransaction: number;
  staff: StaffBreakdown;
  fixedMonthlyCosts: number;
  cashOutlay0: number;
  months: CoreMonth[];
  paybackMonth: number | null;
  cashBreakEvenMonth: number | null;
}

export function core(inputs: ScenarioInputs): Core {
  const tradingDays = tradingDaysPerMonth(inputs);
  const monthlyTransactions = inputs.customersPerDay * tradingDays;
  const cogsPerUnit = cogsPerUnitOf(inputs);
  const contributionPerTransaction = inputs.avgPricePerTransaction - cogsPerUnit;

  const revenue = monthlyTransactions * inputs.avgPricePerTransaction;
  const annualRevenue = revenue * 12;

  const { serviceTax } = STATUTORY;
  const sstApplies =
    inputs.sstRegistered && annualRevenue >= serviceTax.registrationThresholdAnnual;

  // Service tax applies to the DINE-IN portion of revenue only, and is modelled
  // as absorbed rather than passed on — that answers "what does registering
  // cost me if I hold my prices?", which is the decision-relevant question.
  const serviceTaxPerTransaction = sstApplies
    ? inputs.avgPricePerTransaction * inputs.dineInSharePct * serviceTax.rate
    : 0;

  const staff = staffCostOf(inputs.staffCount, inputs.avgMonthlyWage);

  // Built from the individually rounded lines rather than rounding the sum, so
  // the cost breakdown on screen adds up to the total on screen. A financial
  // tool whose columns do not tally is a financial tool nobody trusts.
  const fixedMonthlyCosts = r2(
    staff.total +
      r2(inputs.monthlyRent) +
      r2(inputs.utilities) +
      r2(inputs.licensingFees) +
      r2(inputs.marketing) +
      r2(inputs.miscMonthly),
  );

  const cashOutlay0 = r2(inputs.initialInvestment + inputs.securityDepositMonths * inputs.monthlyRent);
  const investment = r2(inputs.initialInvestment);

  // Only COGS and service tax vary with volume. Everything else is charged in
  // full from month one — you pay the rent whether or not anyone shows up.
  const netContributionPerTransaction = contributionPerTransaction - serviceTaxPerTransaction;

  const months: CoreMonth[] = [];
  let cumulative = 0;
  let paybackMonth: number | null = null;
  let cashBreakEvenMonth: number | null = null;

  // Each month is assembled from rounded components, and the running total
  // accumulates those rounded figures. The projection table therefore adds up
  // column-wise exactly as displayed, at a cost of a few sen of drift from the
  // true value over 24 months.
  for (let m = 0; m <= HORIZON_MONTHS; m += 1) {
    const rampM = m === 0 ? 0 : ramp(m, inputs.monthsToMaturity);
    const txns = monthlyTransactions * rampM;
    const revenueM = r2(txns * inputs.avgPricePerTransaction);
    const cogsM = r2(txns * cogsPerUnit);
    const serviceTaxM = r2(txns * serviceTaxPerTransaction);
    const profit = m === 0 ? 0 : r2(revenueM - cogsM - serviceTaxM - fixedMonthlyCosts);

    cumulative = r2(cumulative + profit);
    const cash = r2(cumulative - cashOutlay0);

    months.push({
      ramp: r4(rampM),
      transactions: txns,
      revenue: revenueM,
      cogs: cogsM,
      serviceTax: serviceTaxM,
      profit,
      cumulative,
      cash,
    });

    if (paybackMonth === null && m > 0 && cumulative >= investment) {
      paybackMonth = m;
    }
    if (cashBreakEvenMonth === null && cash >= 0) {
      cashBreakEvenMonth = m;
    }
  }

  return {
    tradingDays,
    monthlyTransactions,
    cogsPerUnit,
    contributionPerTransaction,
    netContributionPerTransaction,
    revenue,
    annualRevenue,
    sstApplies,
    serviceTaxPerTransaction,
    staff,
    fixedMonthlyCosts,
    cashOutlay0,
    months,
    paybackMonth,
    cashBreakEvenMonth,
  };
}

/** Payback only — the sensitivity sweep calls this repeatedly and skips result assembly. */
export function paybackMonthOf(inputs: ScenarioInputs): number | null {
  return core(inputs).paybackMonth;
}

/**
 * Transactions per day that cover the fixed costs — the operating break-even.
 *
 * Lives here, not in simulate(), because the rent-sensitivity dimension of the
 * location score needs the same number and must not grow a second copy of the
 * formula. One implementation, per the house rule that keeps client and server
 * in agreement by construction.
 *
 * Service tax scales with revenue, so it eats into contribution per
 * transaction and therefore raises the break-even. safeCeilOrNull catches the
 * case where contribution is positive but so small that the division
 * overflows — "Infinity transactions/day" is not an answer.
 */
export function operatingBreakEvenPerDay(c: Core): number | null {
  if (c.netContributionPerTransaction <= 0 || c.tradingDays <= 0) return null;
  return safeCeilOrNull(c.fixedMonthlyCosts / (c.netContributionPerTransaction * c.tradingDays));
}
