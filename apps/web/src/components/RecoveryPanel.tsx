import {
  en,
  formatCurrency,
  formatCurrencyPrecise,
  formatNumber,
  formatPercent,
  type LeverField,
  type SimulationResult,
} from "@spotential/sim-engine";
import type { NumericField } from "../state/useScenario.js";

/**
 * The recovery state — SPEC §4.11.
 *
 * Never print infinity. Name the failure, then solve each lever for what would
 * actually fix it, and say plainly when a lever cannot: rent that would have
 * to go negative is not a suggestion. A loss-making scenario becomes the most
 * useful screen in the product rather than a dead end.
 */
export function RecoveryPanel({
  result,
  onApply,
}: {
  result: SimulationResult;
  onApply: (field: NumericField, value: number) => void;
}) {
  const { recovery, steady } = result;
  if (!recovery) return null;

  const levers: {
    field: LeverField;
    target: number | null;
    render: (v: number) => string;
  }[] = [
    {
      field: "customersPerDay",
      target: recovery.customersPerDay,
      render: (v) => `${formatNumber(v)} / day`,
    },
    {
      field: "avgPricePerTransaction",
      target: recovery.avgPricePerTransaction,
      render: (v) => formatCurrencyPrecise(v),
    },
    { field: "monthlyRent", target: recovery.monthlyRent, render: (v) => formatCurrency(v) },
    { field: "cogsPct", target: recovery.cogsPct, render: (v) => formatPercent(v) },
  ];

  return (
    <section className="card" style={{ borderColor: "var(--red)" }}>
      <header style={{ background: "var(--red-soft)" }}>
        <h2 style={{ color: "#a81c1c" }}>Never breaks even at these inputs</h2>
        <span className="pill red">losing {formatCurrency(Math.abs(steady.profit))} / month</span>
      </header>

      <div className="body">
        <p className="small muted" style={{ marginTop: 0 }}>
          {en.recovery.title}
        </p>

        {levers.map(({ field, target, render }) => {
          const isClosest = recovery.closestLever === field;
          return (
            <div className="recovery-lever" key={field}>
              <span className="name">{en.levers[field]}</span>
              {target === null ? (
                <span className="unreachable">{en.recovery.unreachable}</span>
              ) : (
                <>
                  <span className="arrow">→</span>
                  <strong>{render(target)}</strong>
                  {isClosest && <span className="pill amber">{en.recovery.closest}</span>}
                  <button
                    type="button"
                    className={isClosest ? "cta tiny" : "tiny"}
                    onClick={() => onApply(field as NumericField, target)}
                  >
                    apply
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
