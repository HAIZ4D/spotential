import { en, HORIZON_MONTHS, type SimulationResult } from "@spotential/sim-engine";
import { PanelLede, sensitivityLede } from "./sim/PanelLede.js";

/**
 * Which lever actually moves the answer — SPEC §4.9.
 *
 * The most actionable output in the product: it tells an SME which single
 * thing to work on. Paired with a practicality note, because a 20% price rise
 * and a 20% footfall rise are not equally easy to achieve even when the maths
 * says they move the payback by the same amount.
 */
export function SensitivityPanel({ result }: { result: SimulationResult }) {
  const { sensitivity } = result;
  const widest = Math.max(...sensitivity.map((s) => s.spread), 1);

  const label = (m: number | null) => (m === null ? `>${HORIZON_MONTHS}` : `${m}`);

  return (
    <section className="card">
      <header>
        <h2>What moves the answer</h2>
        <span className="tiny muted">payback at ±20%</span>
      </header>
      <div className="body">
        {(() => {
          const lede = sensitivityLede(result);
          return lede ? <PanelLede text={lede.text} figure={lede.figure} /> : null;
        })()}

        {sensitivity.map((entry) => (
          <div className="sens-row" key={entry.field}>
            <span>{en.levers[entry.field] ?? entry.field}</span>
            <span className="sens-bar">
              <span style={{ width: `${(entry.spread / widest) * 100}%` }} />
            </span>
            <span className="months">
              {label(entry.paybackAtPlus20)} to {label(entry.paybackAtMinus20)} mo
            </span>
          </div>
        ))}

        {sensitivity[0] && (
          <p className="small muted" style={{ margin: "12px 0 0" }}>
            <strong>{en.levers[sensitivity[0].field]}</strong> is the strongest lever here. A 20%
            move swings break-even by {sensitivity[0].spread} month
            {sensitivity[0].spread === 1 ? "" : "s"}. Levers are ranked by impact, not by how easy
            they are to pull.
          </p>
        )}
      </div>
    </section>
  );
}
