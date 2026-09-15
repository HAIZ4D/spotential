import { formatCurrency, formatNumber, type SimulationResult } from "@spotential/sim-engine";
import { RunwayTimeline } from "./sim/RunwayTimeline.js";
import { PanelLede, breakEvenLede } from "./sim/PanelLede.js";

/**
 * The three break-even numbers — SPEC §4.8.
 *
 * They answer different questions and all three matter: "am I underwater?",
 * "when am I whole?", and "when do I actually have money again?".
 */
export function BreakEvenPanel({ result }: { result: SimulationResult }) {
  const { breakEven, cash, derived } = result;

  const headroom =
    breakEven.operatingTransactionsPerDay !== null && breakEven.operatingTransactionsPerDay > 0
      ? result.projection[result.projection.length - 1]!.transactionsPerDay /
          breakEven.operatingTransactionsPerDay -
        1
      : null;

  return (
    <section className="card">
      <header>
        <h2>Break-even</h2>
      </header>
      <div className="body stack">
        {(() => {
          const lede = breakEvenLede(result);
          return <PanelLede text={lede.text} figure={lede.figure} />;
        })()}

        <RunwayTimeline result={result} />

        <Row
          label="Operating break-even"
          hint="transactions/day just to cover fixed costs"
          value={
            breakEven.operatingTransactionsPerDay === null
              ? "Unreachable at this price"
              : `${formatNumber(breakEven.operatingTransactionsPerDay)} / day`
          }
          extra={
            headroom !== null && headroom > 0
              ? `${formatNumber(headroom * 100)}% headroom`
              : undefined
          }
        />
        {/* Payback, cash break-even and the day-one outlay live on the runway
            above. A scenario that never breaks even has no runway, so those
            three still need saying here. */}
        {breakEven.neverBreaksEven && (
          <>
            <Row
              label="Investment payback"
              hint="cumulative profit clears the initial investment"
              value="Never within 24 months"
            />
            <Row
              label="Upfront cash out"
              hint="investment plus rent deposit"
              value={formatCurrency(cash.outlayAtMonth0)}
            />
          </>
        )}
        <Row
          label="Contribution per transaction"
          hint={`price less RM${derived.cogsPerUnit.toFixed(2)} cost of goods`}
          value={formatCurrency(derived.contributionPerTransaction)}
        />
      </div>
    </section>
  );
}

function Row({
  label,
  hint,
  value,
  extra,
}: {
  label: string;
  hint: string;
  value: string;
  extra?: string | undefined;
}) {
  return (
    <div className="spread">
      <div>
        <div style={{ fontSize: 13, fontWeight: 550 }}>{label}</div>
        <div className="tiny muted">{hint}</div>
      </div>
      <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        <div style={{ fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>{value}</div>
        {extra && <div className="tiny" style={{ color: "var(--green)" }}>{extra}</div>}
      </div>
    </div>
  );
}
