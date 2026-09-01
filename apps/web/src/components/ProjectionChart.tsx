import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency, type SimulationResult } from "@spotential/sim-engine";

/**
 * Profit and cash on one chart — SPEC §4.7 and the §7.1 layout.
 *
 * The cash series is the point. Profit turning positive is not the same as
 * having money in the bank, and the gap between those two moments is where
 * Malaysian SMEs actually fail.
 */
export function ProjectionChart({ result }: { result: SimulationResult }) {
  const { projection, cash, breakEven } = result;

  const data = projection.slice(0, 13).map((m) => ({
    month: m.month,
    profit: m.profit,
    cash: m.cash,
  }));

  const trough = data.find((d) => d.month === cash.troughMonth);

  return (
    <section className="card">
      <header>
        <h2>First 12 months</h2>
        <div className="stack" style={{ alignItems: "flex-end", gap: 2 }}>
          <span className="tiny muted">
            <span style={{ color: "var(--navy)" }}>&#9679;</span> monthly profit &nbsp;
            <span style={{ color: "var(--gold)" }}>&#9679;</span> cash in bank
          </span>
        </div>
      </header>

      <div className="body">
        <div style={{ width: "100%", height: 340 }}>
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 6, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid stroke="var(--line)" vertical={false} />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 11, fill: "var(--ink-2)" }}
                tickLine={false}
                axisLine={{ stroke: "var(--line)" }}
                label={{
                  value: "month",
                  position: "insideBottomRight",
                  offset: -2,
                  fontSize: 10,
                  fill: "var(--ink-3)",
                }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--ink-2)" }}
                tickLine={false}
                axisLine={false}
                width={64}
                tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
              />
              <Tooltip
                formatter={(value: number, name) => [
                  formatCurrency(value),
                  name === "profit" ? "Monthly profit" : "Cash in bank",
                ]}
                labelFormatter={(m: number) => (m === 0 ? "Opening" : `Month ${m}`)}
                contentStyle={{
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  fontSize: 12,
                  boxShadow: "var(--shadow)",
                }}
              />
              {/* Payback is a RANGE. The engine computes the band from a ±20%
                  sweep and, until now, nothing drew it — so a single dashed
                  line implied the month was known precisely. */}
              {result.breakEven.paybackBandLow !== null &&
                result.breakEven.paybackBandHigh !== null && (
                  <ReferenceArea
                    x1={result.breakEven.paybackBandLow}
                    x2={result.breakEven.paybackBandHigh}
                    fill="var(--green)"
                    fillOpacity={0.09}
                    stroke="none"
                  />
                )}

              <ReferenceLine y={0} stroke="var(--ink-3)" strokeDasharray="3 3" />

              {breakEven.paybackMonth !== null && breakEven.paybackMonth <= 12 && (
                <ReferenceLine
                  x={breakEven.paybackMonth}
                  stroke="var(--green)"
                  strokeDasharray="4 3"
                  label={{
                    value: "payback",
                    position: "top",
                    fontSize: 10,
                    fill: "var(--green)",
                  }}
                />
              )}

              <Line
                type="monotone"
                dataKey="profit"
                stroke="var(--navy)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="cash"
                stroke="var(--gold)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />

              {trough && (
                <ReferenceDot
                  x={trough.month}
                  y={trough.cash}
                  r={4}
                  fill="var(--red)"
                  stroke="none"
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <p className="small muted" style={{ margin: "10px 0 0" }}>
          Lowest cash point <strong>{formatCurrency(cash.troughAmount)}</strong> in month{" "}
          {cash.troughMonth}. You need{" "}
          <strong>{formatCurrency(cash.peakCashRequirement)}</strong> of runway, not just the
          initial investment. The rent deposit and the ramp-period losses land before any of it
          comes back.
        </p>
      </div>
    </section>
  );
}
