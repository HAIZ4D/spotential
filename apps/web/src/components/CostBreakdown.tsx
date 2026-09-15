import { useEffect, useRef } from "react";
import { en, formatCurrency, formatPercent, type SimulationResult } from "@spotential/sim-engine";
import { CostComposition } from "./sim/CostComposition.js";
import { PanelLede, costLede } from "./sim/PanelLede.js";

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
  const lede = costLede(result);

  /**
   * THE TABLE PRINTS EVEN WHEN IT IS FOLDED.
   *
   * The lines live in a `<details>` so the panel stops reading as a ledger,
   * but a closed `<details>` hides its content from paper as well as from the
   * screen — and the printed page is the copy most likely to be handed to a
   * landlord or a bank, where the tally is the entire point. So the disclosure
   * opens for the print and closes again after.
   *
   * Done with the print events rather than a CSS rule because forcing a closed
   * disclosure's content visible is not reliably styleable across browsers.
   */
  const workingRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const details = workingRef.current;
    if (!details) return;

    let wasOpen = false;
    const before = () => {
      wasOpen = details.open;
      details.open = true;
    };
    const after = () => {
      details.open = wasOpen;
    };

    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

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
        <PanelLede text={lede.text} figure={lede.figure} />

        <CostComposition result={result} />

        {/* Folded, never trimmed. Showing only the largest lines would break
            the tally: these add up to the profit figure on the last row, and a
            partial list that still looked like a total would be worse than a
            table nobody opens. */}
        <details className="cost-working" ref={workingRef}>
          <summary>Show every line</summary>
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
        </details>

        <details style={{ marginTop: 12 }}>
          <summary className="small muted" style={{ cursor: "pointer" }}>
            Staff cost detail: employer contributions
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
            already inside the figure above, so they are not an extra employer cost. Statutory rates
            reviewed 2026-08-12.
          </p>
        </details>
      </div>
    </section>
  );
}
