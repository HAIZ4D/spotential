import {
  formatCurrency,
  formatCurrencyDelta,
  formatMonthBand,
  type SimulationResult,
} from "@spotential/sim-engine";
import { useCountUp } from "./useCountUp.js";


/**
 * The four figures pinned to the top of the viewport — SPEC §7.1.
 *
 * Whatever the user is dragging, the number that matters stays on screen.
 * Deltas are measured against the pinned baseline so a change reads as a
 * movement rather than just a new value.
 *
 * Money counts up rather than snapping: on a page built around dragging
 * sliders, a figure that slides carries its direction before you have read the
 * delta beneath it. Break-even does NOT animate — it is a month, and counting
 * through 6.4 to reach 7 would be inventing precision the engine never
 * produced.
 */
export function KpiStrip({
  result,
  baseline,
  showDeltas,
}: {
  result: SimulationResult;
  baseline: SimulationResult;
  showDeltas: boolean;
}) {
  const { steady, breakEven, cash } = result;

  const paybackDelta =
    breakEven.paybackMonth !== null && baseline.breakEven.paybackMonth !== null
      ? breakEven.paybackMonth - baseline.breakEven.paybackMonth
      : null;

  return (
    <div className="headline">
      <Cell
        testId="headline-revenue"
        label="Revenue / month"
        amount={steady.revenue}
        tone="navy"
        delta={showDeltas ? steady.revenue - baseline.steady.revenue : null}
        deltaGoodWhenUp
      />

      <Cell
        testId="headline-profit"
        label="Profit / month"
        amount={steady.profit}
        tone={steady.profit >= 0 ? "good" : "bad"}
        delta={showDeltas ? steady.profit - baseline.steady.profit : null}
        deltaGoodWhenUp
      />

      <Cell
        testId="headline-breakeven"
        label="Break-even"
        text={formatMonthBand(
          breakEven.paybackMonth,
          breakEven.paybackBandLow,
          breakEven.paybackBandHigh,
        )}
        tone={breakEven.neverBreaksEven ? "bad" : "navy"}
        deltaText={
          showDeltas && paybackDelta !== null && paybackDelta !== 0
            ? `${paybackDelta > 0 ? "+" : "−"}${Math.abs(paybackDelta)} month${
                Math.abs(paybackDelta) === 1 ? "" : "s"
              }`
            : null
        }
        deltaTone={paybackDelta !== null && paybackDelta > 0 ? "down" : "up"}
      />

      <Cell
        testId="headline-cash"
        label="Cash needed"
        amount={cash.peakCashRequirement}
        tone="navy"
        delta={showDeltas ? cash.peakCashRequirement - baseline.cash.peakCashRequirement : null}
        deltaGoodWhenUp={false}
        // The shape of the hole this figure is the bottom of.
        spark={result.projection.map((m) => m.cash)}
      />
    </div>
  );
}

function Cell({
  testId,
  label,
  amount,
  text,
  tone,
  delta = null,
  deltaGoodWhenUp = true,
  deltaText = null,
  deltaTone,
  spark,
}: {
  testId: string;
  label: string;
  /** Animated and currency-formatted. Use `text` instead for non-money. */
  amount?: number;
  text?: string;
  tone: "good" | "bad" | "navy";
  delta?: number | null;
  deltaGoodWhenUp?: boolean;
  deltaText?: string | null;
  deltaTone?: "up" | "down";
  spark?: number[];
}) {
  // Hooks cannot be conditional, so this runs even for text cells; passing 0
  // costs nothing and keeps the component a single shape.
  const animated = useCountUp(amount ?? 0);

  let deltaLabel = deltaText;
  let toneClass = deltaTone ?? "";

  if (deltaLabel === null && delta !== null && Math.abs(delta) >= 0.01) {
    deltaLabel = formatCurrencyDelta(delta);
    toneClass = delta > 0 === deltaGoodWhenUp ? "up" : "down";
  }

  return (
    <div className="cell">
      <div className="label">{label}</div>

      <div className={`value ${tone}`} data-testid={testId}>
        {/* Rounded before formatting so the animated frames never render a
            fractional ringgit the engine would not produce. */}
        {text ?? formatCurrency(Math.round(animated))}
      </div>

      <div className={`delta ${toneClass}`} data-testid={`${testId}-delta`}>
        {deltaLabel ?? ""}
      </div>

      {spark && <CashSpark values={spark} />}
    </div>
  );
}

/**
 * The 24-month cash curve, small.
 *
 * Not RampSparkline: that one draws the ramp fraction from a maturity number.
 * This draws real cash, which starts deep in the negative, so it needs its own
 * zero line — without it a rising line reads as good news when the whole curve
 * may still be underwater.
 */
function CashSpark({ values }: { values: number[] }) {
  if (values.length < 2) return null;

  const width = 200;
  const height = 26;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;

  const y = (v: number) => height - ((v - min) / span) * (height - 2) - 1;
  const points = values
    .map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");

  return (
    <svg
      className="kpi-spark"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <line
        x1={0}
        x2={width}
        y1={y(0)}
        y2={y(0)}
        stroke="var(--ink-3)"
        strokeWidth={0.75}
        strokeDasharray="3 3"
      />
      <polyline points={points} fill="none" stroke="var(--navy)" strokeWidth={1.5} />
    </svg>
  );
}
