import { en, formatCurrency, formatPercent, type SimulationResult } from "@spotential/sim-engine";
import { CostComposition } from "./sim/CostComposition.js";

/** Rent burden traffic light — SPEC §7.4. */
function rentTone(pct: number): { cls: "green" | "amber" | "red"; label: string } {
  if (pct < 0.12) return { cls: "green", label: "healthy" };
  if (pct <= 0.18) return { cls: "amber", label: "watch" };
  return { cls: "red", label: "exposed" };
}

export function CostBreakdown({ result }: { result: SimulationResult }) {
  const { steady, costBreakdown } = result;
  const rentLine = costBreakdown.find((l) => l.key === "rent");
  const rent = rentLine ? rentTone(rentLine.pctOfRevenue) : null;

  return (
    <section className="card">
      <header>
        <h2>Monthly cost breakdown</h2>
        {rent && (
          <span className={`pill ${rent.cls}`}>
            <span className={`dot ${rent.cls}`} />
            rent {formatPercent(rentLine!.pctOfRevenue)} · {rent.label}
          </span>
        )}
      </header>

      <div className="body">
        <CostComposition result={result} />

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Line</th>
                <th>Amount</th>
                <th>% of revenue</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Revenue</td>
                <td>{formatCurrency(steady.revenue)}</td>
                <td>100.0%</td>
              </tr>
              {costBreakdown.map((line) => (
                <tr key={line.key}>
                  <td>{en.costLines[line.key] ?? line.key}</td>
                  <td className="neg">−{formatCurrency(line.amount)}</td>
                  <td>{formatPercent(line.pctOfRevenue)}</td>
                </tr>
              ))}
              <tr className="total">
                <td>Profit</td>
                <td className={steady.profit < 0 ? "neg" : undefined}>
                  {formatCurrency(steady.profit)}
                </td>
                <td>
                  {steady.revenue > 0 ? formatPercent(steady.profit / steady.revenue) : "not available"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <details style={{ marginTop: 12 }}>
          <summary className="small muted" style={{ cursor: "pointer" }}>
            Staff cost detail — employer contributions
          </summary>
          <div className="table-scroll" style={{ marginTop: 8 }}>
            <table>
              <tbody>
                <tr>
                  <td>Base wages</td>
                  <td>{formatCurrency(steady.staffBreakdown.baseWages)}</td>
                </tr>
                <tr>
                  <td>EPF (employer, {formatPercent(steady.staffBreakdown.epfRateApplied, 0)})</td>
                  <td>{formatCurrency(steady.staffBreakdown.epf)}</td>
                </tr>
                <tr>
                  <td>SOCSO (employer)</td>
                  <td>{formatCurrency(steady.staffBreakdown.socso)}</td>
                </tr>
                <tr>
                  <td>EIS (employer)</td>
                  <td>{formatCurrency(steady.staffBreakdown.eis)}</td>
                </tr>
                <tr className="total">
                  <td>Total staff cost</td>
                  <td>{formatCurrency(steady.staffBreakdown.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="tiny muted" style={{ marginTop: 6 }}>
            Employee-side EPF, SOCSO and EIS come out of the employee&rsquo;s own wage and are
            already inside the figure above — they are not an extra employer cost. Statutory rates
            reviewed 2026-08-12.
          </p>
        </details>
      </div>
    </section>
  );
}
