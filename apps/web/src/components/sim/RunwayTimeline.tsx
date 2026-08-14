import { formatCurrency, type SimulationResult } from "@spotential/sim-engine";

/**
 * The three break-even moments, on a line.
 *
 * They were five rows of a table, which made the reader parse each label and
 * hold the ordering in their head. But these are events in TIME, and the whole
 * story is their sequence: money leaves, the hole deepens, the investment
 * comes back, and only later is there cash in the account again.
 *
 * A timeline says that in one glance. The figures are unchanged — the table
 * below still carries every one of them.
 */
export function RunwayTimeline({ result }: { result: SimulationResult }) {
  const { breakEven, cash } = result;
  const horizon = result.projection.length - 1;

  // Never breaking even has no sequence to draw, and a timeline running off
  // the end would imply one exists just past the edge.
  if (breakEven.neverBreaksEven || breakEven.paybackMonth === null) return null;

  const at = (month: number) => `${(month / horizon) * 100}%`;

  const marks = [
    {
      month: cash.troughMonth,
      label: "Deepest point",
      value: formatCurrency(cash.troughAmount),
      tone: "red" as const,
    },
    {
      month: breakEven.paybackMonth,
      label: "Investment back",
      value: `Month ${breakEven.paybackMonth}`,
      tone: "amber" as const,
    },
    ...(breakEven.cashBreakEvenMonth !== null
      ? [
          {
            month: breakEven.cashBreakEvenMonth,
            label: "Cash positive",
            value: `Month ${breakEven.cashBreakEvenMonth}`,
            tone: "green" as const,
          },
        ]
      : []),
  ];

  return (
    <div className="runway">
      <div className="runway-track">
        {/* The stretch still underwater — the part an owner has to fund. */}
        <div
          className="runway-underwater"
          style={{ width: at(breakEven.cashBreakEvenMonth ?? horizon) }}
        />

        {breakEven.paybackBandLow !== null && breakEven.paybackBandHigh !== null && (
          /* Payback is a range, not a date. Drawing only the point estimate
             would overstate what a ±20% sweep can actually tell you. */
          <div
            className="runway-band"
            style={{
              left: at(breakEven.paybackBandLow),
              width: at(breakEven.paybackBandHigh - breakEven.paybackBandLow),
            }}
            title={`Payback lands between month ${breakEven.paybackBandLow} and ${breakEven.paybackBandHigh}`}
          />
        )}

        {marks.map((mark) => (
          <div key={mark.label} className={`runway-mark ${mark.tone}`} style={{ left: at(mark.month) }}>
            <span className="runway-dot" />
          </div>
        ))}
      </div>

      <div className="runway-legend">
        <div className="runway-item">
          <span className="runway-dot navy" />
          <div>
            <div className="runway-label">Day one</div>
            <div className="runway-value">{formatCurrency(cash.outlayAtMonth0)} out</div>
          </div>
        </div>

        {marks.map((mark) => (
          <div className="runway-item" key={mark.label}>
            <span className={`runway-dot ${mark.tone}`} />
            <div>
              <div className="runway-label">{mark.label}</div>
              <div className="runway-value">{mark.value}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
