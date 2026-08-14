import type {
  BreakEven,
  CashPosition,
  CostLine,
  DerivedValues,
  ProjectionMonth,
  ScenarioInputs,
  SimulationResult,
  SteadyState,
} from "./types.js";
import { core, operatingBreakEvenPerDay, r2, r4, staffCostOf } from "./basis.js";
import { ENGINE_VERSION, PRESET_VERSION } from "./presets/version.js";
import { paybackBand, sensitivity } from "./sensitivity.js";
import { solveRecovery } from "./recovery.js";
import { validate } from "./validate.js";

/**
 * The single implementation of the What-if Simulator maths.
 *
 * Pure. Same input, same output, in the browser and on Cloud Run — which is
 * what makes the parity test (SPEC §12) meaningful and what stops a saved
 * scenario disagreeing with the panel that produced it.
 */
export function simulate(inputs: ScenarioInputs): SimulationResult {
  const c = core(inputs);

  const derived: DerivedValues = {
    tradingDaysPerMonth: r4(c.tradingDays),
    monthlyTransactions: r2(c.monthlyTransactions),
    cogsPerUnit: r2(c.cogsPerUnit),
    contributionPerTransaction: r2(c.contributionPerTransaction),
  };

  const staffBreakdown = staffCostOf(inputs.staffCount, inputs.avgMonthlyWage);

  // Service charge is collected from the customer and passed straight through
  // to staff. It inflates gross revenue and must never reach profit.
  const serviceChargeCollected = c.revenue * inputs.serviceChargePct;

  // Every figure below is built from already-rounded components so the panel
  // tallies exactly: revenue minus total expenses IS the profit on screen.
  const steadyRevenue = r2(c.revenue);
  const steadyCogs = r2(c.cogsPerUnit * c.monthlyTransactions);
  const steadyServiceTax = r2(c.serviceTaxPerTransaction * c.monthlyTransactions);
  const totalExpenses = r2(steadyCogs + c.fixedMonthlyCosts + steadyServiceTax);
  const steadyProfit = r2(steadyRevenue - totalExpenses);

  const steady: SteadyState = {
    revenue: steadyRevenue,
    grossRevenue: r2(steadyRevenue + r2(serviceChargeCollected)),
    serviceChargeCollected: r2(serviceChargeCollected),
    serviceChargePayout: r2(serviceChargeCollected),
    annualRevenue: r2(c.annualRevenue),
    sstApplies: c.sstApplies,
    serviceTax: steadyServiceTax,
    cogs: steadyCogs,
    staffCost: staffBreakdown.total,
    staffBreakdown,
    fixedMonthlyCosts: c.fixedMonthlyCosts,
    totalExpenses,
    profit: steadyProfit,
  };

  const pctOf = (amount: number): number => (steadyRevenue > 0 ? r4(amount / steadyRevenue) : 0);
  const costBreakdown: CostLine[] = [
    { key: "cogs", amount: r2(steadyCogs), pctOfRevenue: pctOf(steadyCogs) },
    { key: "staff", amount: staffBreakdown.total, pctOfRevenue: pctOf(staffBreakdown.total) },
    { key: "rent", amount: r2(inputs.monthlyRent), pctOfRevenue: pctOf(inputs.monthlyRent) },
    { key: "utilities", amount: r2(inputs.utilities), pctOfRevenue: pctOf(inputs.utilities) },
    {
      key: "licensing",
      amount: r2(inputs.licensingFees),
      pctOfRevenue: pctOf(inputs.licensingFees),
    },
    { key: "marketing", amount: r2(inputs.marketing), pctOfRevenue: pctOf(inputs.marketing) },
    { key: "misc", amount: r2(inputs.miscMonthly), pctOfRevenue: pctOf(inputs.miscMonthly) },
  ];
  if (steadyServiceTax > 0) {
    costBreakdown.push({
      key: "serviceTax",
      amount: r2(steadyServiceTax),
      pctOfRevenue: pctOf(steadyServiceTax),
    });
  }

  const projection: ProjectionMonth[] = c.months.map((row, m) => ({
    month: m,
    ramp: row.ramp,
    transactionsPerDay: r2(inputs.customersPerDay * row.ramp),
    revenue: row.revenue,
    grossRevenue: r2(row.revenue + r2(row.revenue * inputs.serviceChargePct)),
    cogs: row.cogs,
    contribution: r2(row.revenue - row.cogs),
    serviceTax: row.serviceTax,
    profit: row.profit,
    cumulativeProfit: row.cumulative,
    cash: row.cash,
  }));

  // Shared with the location score's rent dimension — see basis.ts.
  const operatingTransactionsPerDay = operatingBreakEvenPerDay(c);

  const ranked = sensitivity(inputs);
  const band =
    c.paybackMonth === null
      ? { low: null, high: null }
      : paybackBand(inputs, ranked);

  const breakEven: BreakEven = {
    operatingTransactionsPerDay,
    paybackMonth: c.paybackMonth,
    paybackBandLow: band.low,
    paybackBandHigh: band.high,
    cashBreakEvenMonth: c.cashBreakEvenMonth,
    neverBreaksEven: c.paybackMonth === null,
  };

  let troughMonth = 0;
  let troughAmount = c.months[0]?.cash ?? -c.cashOutlay0;
  c.months.forEach((row, m) => {
    if (row.cash < troughAmount) {
      troughAmount = row.cash;
      troughMonth = m;
    }
  });

  const cash: CashPosition = {
    outlayAtMonth0: c.cashOutlay0,
    troughMonth,
    troughAmount,
    // The runway an owner must actually have, which is usually well above the
    // initial investment once the deposit and the ramp-period losses land.
    peakCashRequirement: r2(Math.max(0, -troughAmount)),
  };

  return {
    engineVersion: ENGINE_VERSION,
    presetVersion: PRESET_VERSION,
    derived,
    steady,
    costBreakdown,
    projection,
    breakEven,
    cash,
    sensitivity: ranked,
    recovery: breakEven.neverBreaksEven ? solveRecovery(inputs) : null,
    warnings: validate(inputs, c),
  };
}
