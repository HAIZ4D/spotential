import {
  en,
  formatCurrency,
  formatNumber,
  type SimulationResult,
} from "@spotential/sim-engine";

/**
 * The sentence each panel opens with.
 *
 * WHY THESE EXIST. Every panel on this page showed a chart or a table and then
 * left the reader to work out what it meant, on a page whose whole promise is
 * that it does that for them. Five identical `.card` shells with a grey header
 * bar and an uppercase heading is also most of what made the simulator read as
 * an analysis tool rather than a product.
 *
 * DERIVED, NEVER GENERATED — the same rule as the ledes on `/analysis` and the
 * PDF cover, and for the same reason: this sits directly on top of the figure
 * it describes, so a model-written sentence could contradict the chart an inch
 * below it. Reading the result object costs nothing and cannot fail, which is
 * what lets it render on every panel rather than behind a spend limit.
 */

export function PanelLede({ text, figure }: { text: string; figure?: string }) {
  return (
    <p className="panel-lede">
      {figure && <span className="panel-lede-figure">{figure}</span>}
      <span>{text}</span>
    </p>
  );
}

/** When the cash is deepest, and what that means for the money you need. */
export function projectionLede(result: SimulationResult): { text: string; figure: string } {
  const { troughMonth, troughAmount } = result.cash;
  return {
    figure: formatCurrency(Math.abs(troughAmount)),
    text: `is the most you are ever out of pocket, in month ${troughMonth}. That is the runway you need, not the initial investment, because the rent deposit and the ramp-period losses land before any of it comes back.`,
  };
}

/** The one number that decides whether the doors can stay open. */
export function breakEvenLede(result: SimulationResult): { text: string; figure: string } {
  const { operatingTransactionsPerDay, paybackMonth, neverBreaksEven } = result.breakEven;

  if (operatingTransactionsPerDay === null) {
    return {
      figure: "No volume",
      text: "covers the fixed costs at this price, because each transaction loses money before rent is even counted. Raise the price or cut the cost of goods.",
    };
  }

  return {
    figure: `${formatNumber(operatingTransactionsPerDay)} a day`,
    text: neverBreaksEven || paybackMonth === null
      ? "just covers the fixed costs. The initial investment is never recovered inside the modelled horizon at this volume."
      : `just covers the fixed costs. Above that you are into profit, and the investment comes back around month ${paybackMonth}.`,
  };
}

/** Where the money actually goes, named rather than tabulated. */
export function costLede(result: SimulationResult): { text: string; figure: string } {
  // The largest cost line, which is almost never the one an owner expects.
  const biggest = [...result.costBreakdown].sort((a, b) => b.amount - a.amount)[0];
  const revenue = result.steady.revenue;

  if (!biggest || revenue <= 0) {
    return { figure: "No costs", text: "are modelled at this scenario." };
  }

  const share = Math.round((biggest.amount / revenue) * 100);
  return {
    figure: en.costLines[biggest.key] ?? biggest.key,
    // "below" was wrong once the table folded: it is behind a disclosure now.
    text: `is the largest line, at ${share}% of revenue. Open the lines to see every one, and they tally to the profit row, because the percentages are of turnover rather than of costs.`,
  };
}

/** Which lever is worth pulling, from the engine's own sweep. */
export function sensitivityLede(result: SimulationResult): { text: string; figure: string } | null {
  const strongest = result.sensitivity[0];
  if (!strongest) return null;

  return {
    figure: en.levers[strongest.field] ?? strongest.field,
    text: "moves the answer more than anything else here. A 20% swing either way changes the payback month more than a 20% swing in any other input, which is where to spend your attention first.",
  };
}
