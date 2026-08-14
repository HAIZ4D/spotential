import { formatCurrency, formatNumber, formatPercent } from "../format.js";

/**
 * Every user-facing string — SPEC §7.9.
 *
 * v1 ships English only, but nothing is hardcoded in a component. Adding
 * Bahasa Malaysia later is a second file implementing this same shape, not an
 * archaeological dig through the UI.
 */
export const en = {
  costLines: {
    cogs: "Cost of goods",
    staff: "Staff",
    rent: "Rent",
    utilities: "Utilities",
    licensing: "Licensing & permits",
    marketing: "Marketing",
    misc: "Misc & maintenance",
    serviceTax: "Service tax (SST)",
  } as Record<string, string>,

  levers: {
    avgPricePerTransaction: "Average price",
    customersPerDay: "Transactions per day",
    cogsPct: "Cost of goods %",
    monthlyRent: "Rent",
  } as Record<string, string>,

  headline: {
    revenue: "Revenue",
    profit: "Profit",
    breakEven: "Break-even",
    cashNeeded: "Cash needed",
  },

  breakEven: {
    never: "Never at these inputs",
    operating: (perDay: number) => `${formatNumber(perDay)} transactions/day to cover fixed costs`,
    headroom: (pct: number) => `${formatPercent(pct)} headroom`,
  },

  cash: {
    trough: (amount: number, month: number) =>
      `Lowest cash point ${formatCurrency(amount)} in month ${month}`,
    requirement: (amount: number, investment: number) =>
      `You need ${formatCurrency(amount)} of runway, not ${formatCurrency(investment)}`,
  },

  warnings: {
    seatTurnsImplausible: (
      customers: number,
      seats: number,
      hours: number,
      turns: number,
      bandHigh: number,
      plausibleMax: number,
    ) =>
      `${formatNumber(customers)} transactions across ${formatNumber(seats)} seats over ` +
      `${formatNumber(hours)} hours is ${formatNumber(turns, 1)} seat-turns/day. Typical for this ` +
      `category is up to ${formatNumber(bandHigh)}. Plausible max here: about ` +
      `${formatNumber(plausibleMax)}/day.`,

    seatTurnsVeryLow: (turns: number, bandLow: number) =>
      `${formatNumber(turns, 1)} seat-turns/day is well below the ${formatNumber(bandLow)} ` +
      `typical for this category — you may be paying for seats you will not fill.`,

    wageBelowMinimum: (wage: number, minimum: number) =>
      `${formatCurrency(wage)} is below the ${formatCurrency(minimum)} statutory minimum wage.`,

    rentAboveMarket: (rent: number, median: number, multiple: number) =>
      `${formatCurrency(rent)} is ${formatNumber(multiple, 1)}× the ${formatCurrency(median)} ` +
      `district median for a unit this size.`,

    rentBurdenHigh: (pct: number) =>
      `Rent is ${formatPercent(pct)} of projected revenue. Above roughly 18% leaves you very ` +
      `exposed if footfall stays soft.`,

    cogsOutOfBand: (pct: number) =>
      `A ${formatPercent(pct)} cost of goods is unusual for F&B, where 15–55% is the normal range.`,

    zeroRevenue: "No revenue at these inputs — set a price and a transaction count.",

    sstThresholdCrossed: (annual: number, threshold: number) =>
      `At ${formatCurrency(annual)} a year you cross the ${formatCurrency(threshold)} threshold ` +
      `and will need to register for service tax.`,
  },

  recovery: {
    title: "To break even you would need one of:",
    unreachable: "cannot reach break-even on its own",
    closest: "closest to reach",
  },

  ai: {
    thinking: "Working it out…",
    failed: "Could not reach the assistant. Your figures are unaffected — the sliders still work.",
    declined: "That is outside what this simulator can answer.",
    aiChanged: "changed by AI",
    keepScenario: "Keep as scenario",
    revert: "Revert to baseline",
  },

  assumptions: {
    noElasticity:
      "Raising the price does not reduce volume in this model. Treat price as the strongest " +
      "lever with that caveat in mind.",
    flatDemand:
      "Demand is flat across the year. Ramadan, Raya, school holidays and the monsoon all move " +
      "Malaysian F&B materially.",
    presetsEstimated:
      "Starting values are category-typical estimates, not verified figures for this exact unit.",
    cashSimplified:
      "The cash view excludes payment timing, supplier credit and stock float. It understates " +
      "rather than overstates what you need.",
    noOwnerDrawings:
      "Profit is business profit. It does not deduct anything you take out as personal income.",
  },
} as const;

export type Strings = typeof en;
