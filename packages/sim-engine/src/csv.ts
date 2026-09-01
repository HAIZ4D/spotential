import type { ScenarioInputs, SimulationResult } from "./types.js";
import { CATEGORY_PRESETS } from "./presets/categories.js";
import { DISTRICT_PRESETS } from "./presets/districts.js";
import { en } from "./i18n/en.js";

/**
 * CSV export — SPEC §7.8.
 *
 * A spreadsheet is the SME's native tool. Respect that rather than pretending
 * to replace it: hand over the numbers and let them keep working.
 *
 * Values are RAW NUMBERS, never "RM 97,200" — a formatted currency string
 * lands in Excel as text and every downstream formula breaks. Currency lives
 * in the column headers instead.
 */

function escapeCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const row = (cells: (string | number | null)[]): string => cells.map(escapeCell).join(",");

export function projectionToCsv(inputs: ScenarioInputs, result: SimulationResult): string {
  const { steady, breakEven, cash, derived, projection, costBreakdown } = result;
  const category = CATEGORY_PRESETS[inputs.businessCategory];
  const district = DISTRICT_PRESETS[inputs.district];

  const lines: string[] = [];

  lines.push(row(["Spotential What-if Simulator"]));
  lines.push(row(["Business type", category.label]));
  lines.push(row(["District", district.label]));
  lines.push(row(["Generated", new Date().toISOString().slice(0, 10)]));
  lines.push(row(["Engine version", result.engineVersion]));
  lines.push(row(["Preset version", result.presetVersion]));
  lines.push("");

  lines.push(row(["Summary", "Value"]));
  lines.push(row(["Monthly revenue (RM)", steady.revenue]));
  lines.push(row(["Monthly expenses (RM)", steady.totalExpenses]));
  lines.push(row(["Monthly profit (RM)", steady.profit]));
  lines.push(row(["Contribution per transaction (RM)", derived.contributionPerTransaction]));
  lines.push(row(["Cost of goods per transaction (RM)", derived.cogsPerUnit]));
  lines.push(row(["Trading days per month", derived.tradingDaysPerMonth]));
  lines.push(
    row(["Operating break-even (transactions/day)", breakEven.operatingTransactionsPerDay]),
  );
  lines.push(row(["Investment payback (month)", breakEven.paybackMonth]));
  lines.push(row(["Payback band low (month)", breakEven.paybackBandLow]));
  lines.push(row(["Payback band high (month)", breakEven.paybackBandHigh]));
  lines.push(row(["Cash break-even (month)", breakEven.cashBreakEvenMonth]));
  lines.push(row(["Upfront cash out (RM)", cash.outlayAtMonth0]));
  lines.push(row(["Peak cash requirement (RM)", cash.peakCashRequirement]));
  lines.push(row(["Cash trough month", cash.troughMonth]));
  lines.push("");

  lines.push(row(["Monthly cost line", "Amount (RM)", "% of revenue"]));
  for (const line of costBreakdown) {
    lines.push(row([en.costLines[line.key] ?? line.key, line.amount, line.pctOfRevenue]));
  }
  lines.push("");

  lines.push(
    row([
      "Month",
      "Ramp",
      "Transactions/day",
      "Revenue (RM)",
      "Cost of goods (RM)",
      "Service tax (RM)",
      "Profit (RM)",
      "Cumulative profit (RM)",
      "Cash in bank (RM)",
    ]),
  );
  for (const m of projection) {
    lines.push(
      row([
        m.month,
        m.ramp,
        m.transactionsPerDay,
        m.revenue,
        m.cogs,
        m.serviceTax,
        m.profit,
        m.cumulativeProfit,
        m.cash,
      ]),
    );
  }
  lines.push("");

  lines.push(row(["Assumptions"]));
  for (const note of Object.values(en.assumptions)) lines.push(row([note]));

  return lines.join("\r\n");
}

export function csvFilename(inputs: ScenarioInputs): string {
  const category = CATEGORY_PRESETS[inputs.businessCategory].id;
  const date = new Date().toISOString().slice(0, 10);
  return `spotential-${category}-${date}.csv`;
}
