import {
  formatCurrency,
  formatCurrencyDelta,
  formatMonthBand,
  type SimulationResult,
} from "@spotential/sim-engine";

/**
 * Four figures pinned to the top of the viewport at all times — SPEC §7.1.
 *
 * Whatever the user is dragging, the number that matters stays on screen.
 * Deltas are measured against the pinned baseline so a change reads as a
 * movement, not just a new value.
 */
export function HeadlineStrip({
  result,
  baseline,
  showDeltas,
}: {
  result: SimulationResult;
  baseline: SimulationResult;
  showDeltas: boolean;
}) {
  const { steady, breakEven, cash } = result;

  const profitDelta = steady.profit - baseline.steady.profit;
  const revenueDelta = steady.revenue - baseline.steady.revenue;
  const cashDelta = cash.peakCashRequirement - baseline.cash.peakCashRequirement;

  const paybackDelta =
    breakEven.paybackMonth !== null && baseline.breakEven.paybackMonth !== null
      ? breakEven.paybackMonth - baseline.breakEven.paybackMonth
      : null;

  return (
    <div className="headline">
      <Cell
        testId="headline-revenue"
        label="Revenue / month"
        value={formatCurrency(steady.revenue)}
        tone="navy"
        delta={showDeltas ? revenueDelta : null}
        deltaGoodWhenUp
      />
      <Cell
        testId="headline-profit"
        label="Profit / month"
        value={formatCurrency(steady.profit)}
        tone={steady.profit >= 0 ? "good" : "bad"}
        delta={showDeltas ? profitDelta : null}
        deltaGoodWhenUp
      />
      <Cell
        testId="headline-breakeven"
        label="Break-even"
        value={formatMonthBand(
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
        value={formatCurrency(cash.peakCashRequirement)}
        tone="navy"
        delta={showDeltas ? cashDelta : null}
        deltaGoodWhenUp={false}
      />
    </div>
  );
}

function Cell({
  testId,
  label,
  value,
  tone,
  delta = null,
  deltaGoodWhenUp = true,
  deltaText = null,
  deltaTone,
}: {
  testId: string;
  label: string;
  value: string;
  tone: "good" | "bad" | "navy";
  delta?: number | null;
  deltaGoodWhenUp?: boolean;
  deltaText?: string | null;
  deltaTone?: "up" | "down";
}) {
  let text = deltaText;
  let toneClass = deltaTone ?? "";

  if (text === null && delta !== null && Math.abs(delta) >= 0.01) {
    text = formatCurrencyDelta(delta);
    const isGood = delta > 0 === deltaGoodWhenUp;
    toneClass = isGood ? "up" : "down";
  }

  return (
    <div className="cell">
      <div className="label">{label}</div>
      <div className={`value ${tone}`} data-testid={testId}>
        {value}
      </div>
      <div className={`delta ${toneClass}`} data-testid={`${testId}-delta`}>
        {text ?? ""}
      </div>
    </div>
  );
}
