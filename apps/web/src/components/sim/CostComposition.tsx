import { en, formatCurrency, formatPercent, type SimulationResult } from "@spotential/sim-engine";

/**
 * Where each ringgit of revenue goes, as one bar.
 *
 * The table below is the record and has to tally to the last sen; this is the
 * shape. A reader can see that cost of goods is a third of revenue without
 * comparing seven numbers in a column — and profit sits at the end of the bar
 * as what is actually left, which is the question the table answers last.
 *
 * Colours are the state colours, not a categorical palette: costs are graded
 * navy by size, profit is green, and a loss turns the remainder red.
 */

/** Navy, stepping lighter down the cost lines so the biggest reads heaviest. */
const COST_SHADES = ["#003087", "#1a4696", "#345ca5", "#4e72b4", "#6888c3", "#829ed2", "#9cb4e1"];

export function CostComposition({ result }: { result: SimulationResult }) {
  const { steady, costBreakdown } = result;
  if (steady.revenue <= 0) return null;

  const segments = costBreakdown
    .filter((line) => line.amount > 0)
    .map((line, index) => ({
      key: line.key,
      label: en.costLines[line.key] ?? line.key,
      pct: line.amount / steady.revenue,
      amount: line.amount,
      colour: COST_SHADES[index % COST_SHADES.length] as string,
    }));

  const profitShare = steady.profit / steady.revenue;
  const loss = steady.profit < 0;

  return (
    <div className="composition">
      <div className="composition-bar">
        {segments.map((segment) => (
          <div
            key={segment.key}
            className="composition-seg"
            style={{ width: `${Math.max(0, segment.pct) * 100}%`, background: segment.colour }}
            title={`${segment.label} — ${formatCurrency(segment.amount)} (${formatPercent(segment.pct, 1)})`}
          />
        ))}

        {!loss && profitShare > 0 && (
          <div
            className="composition-seg profit"
            style={{ width: `${profitShare * 100}%` }}
            title={`Profit — ${formatCurrency(steady.profit)}`}
          />
        )}
      </div>

      {loss && (
        <div className="composition-loss">
          Costs exceed revenue by {formatCurrency(Math.abs(steady.profit))} a month.
        </div>
      )}

      <div className="composition-key">
        {segments.map((segment) => (
          <span className="composition-item" key={segment.key}>
            <span className="composition-swatch" style={{ background: segment.colour }} />
            {segment.label} {formatPercent(segment.pct, 0)}
          </span>
        ))}
        {!loss && profitShare > 0 && (
          <span className="composition-item">
            <span className="composition-swatch profit" />
            Profit {formatPercent(profitShare, 0)}
          </span>
        )}
      </div>
    </div>
  );
}
