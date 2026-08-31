import { useMemo, useState } from "react";
import {
  CATEGORY_PRESETS,
  eventRoi,
  formatNumber,
  roiSweep,
  type BusinessCategory,
  type EventListing,
  type EventRoiInputs,
} from "@spotential/sim-engine";

/**
 * Will this booth pay for itself?
 *
 * The What-If Simulator, aimed at a weekend. Same engine discipline as every
 * other panel: the browser computes it, the numbers are deterministic, and
 * nothing here is a forecast.
 *
 * THE HEADLINE IS A RATIO, NOT A PROFIT. Projected profit would be the least
 * defensible number in the product — a visitor figure invented by the party
 * selling the booth, multiplied by a capture rate nobody can know. So the
 * panel leads with the share of the claimed crowd that must buy just to cover
 * costs, which a stallholder can judge against their own experience without
 * ever having to believe the turnout figure.
 */

const VERDICT_CLASS: Record<string, string> = {
  comfortable: "green",
  workable: "green",
  demanding: "amber",
  impossible: "red",
  unknown: "muted",
};

export function RoiPanel({
  event,
  category,
  boothCostRm,
  days,
}: {
  event: EventListing;
  category: BusinessCategory;
  boothCostRm: number | null;
  days: number;
}) {
  const preset = CATEGORY_PRESETS[category];

  const [staffCount, setStaffCount] = useState(2);
  const [dailyWagePerStaff, setDailyWage] = useState(120);
  const [otherFixedRm, setOtherFixed] = useState(400);
  const [avgPrice, setAvgPrice] = useState(preset.avgPricePerTransaction);

  const inputs: EventRoiInputs | null = useMemo(
    () =>
      boothCostRm === null
        ? null
        : {
            boothCostRm,
            days,
            expectedVisitors: event.expectedVisitors,
            avgPricePerTransaction: avgPrice,
            cogsPct: preset.cogsPct,
            staffCount,
            dailyWagePerStaff,
            otherFixedRm,
          },
    [
      boothCostRm,
      days,
      event.expectedVisitors,
      avgPrice,
      preset.cogsPct,
      staffCount,
      dailyWagePerStaff,
      otherFixedRm,
    ],
  );

  const roi = useMemo(() => (inputs ? eventRoi(inputs) : null), [inputs]);
  const sweep = useMemo(() => (inputs ? roiSweep(inputs) : []), [inputs]);

  if (!roi || !inputs) {
    return (
      <section className="card">
        <header>
          <h2>Will this pay for itself?</h2>
        </header>
        <div className="body">
          <div className="notice info">
            <span>
              The organizer has not published a booth price, so this cannot be worked out yet.
              Ask them what a stall costs and the whole calculation follows from it.
            </span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="card">
      <header>
        <h2>Will this pay for itself?</h2>
        <span className={`pill ${VERDICT_CLASS[roi.verdict] ?? "muted"}`}>{roi.verdict}</span>
      </header>

      <div className="body stack">
        {/* The headline. A ratio, deliberately — see the note at the top. */}
        <div className="roi-headline">
          {roi.breakEvenCaptureRatePct !== null ? (
            <>
              <span className="roi-figure">{roi.breakEvenCaptureRatePct}%</span>
              <span className="roi-caption">
                of the {formatNumber(event.expectedVisitors ?? 0)} visitors the organizer
                expects must buy from you, just to cover your costs
              </span>
            </>
          ) : (
            <>
              <span className="roi-figure">{formatNumber(roi.breakEvenTransactions ?? 0)}</span>
              <span className="roi-caption">
                sales needed to cover your costs. The organizer has not stated an expected
                turnout, so this cannot be shown as a share of the crowd.
              </span>
            </>
          )}
        </div>

        <p className="tiny muted">{roi.note}</p>

        <div className="chips">
          <span className="chip navy">
            <b>RM{formatNumber(roi.fixedCost)}</b> total cost for the run
          </span>
          <span className="chip navy">
            <b>RM{formatNumber(roi.contributionPerTransaction)}</b> margin per sale
          </span>
          {roi.breakEvenPerDay !== null && (
            <span className="chip amber">
              <b>{formatNumber(roi.breakEvenPerDay)}</b> sales a day to break even
            </span>
          )}
        </div>

        {/* A sweep, never a single projection: one number invites belief, a row
            of them makes the sensitivity to an unknowable input obvious. */}
        {sweep.length > 0 && (
          <div className="table-scroll">
            <table>
              <caption className="tiny muted">
                What happens at different conversion rates. These are scenarios, not
                predictions — pick the row that matches how your stall usually performs.
              </caption>
              <thead>
                <tr>
                  <th>If this share buys</th>
                  <th>Sales</th>
                  <th>Revenue</th>
                  <th>Profit after all costs</th>
                </tr>
              </thead>
              <tbody>
                {sweep.map((row) => (
                  <tr key={row.captureRatePct}>
                    <td>{row.captureRatePct}%</td>
                    <td>{formatNumber(row.transactions)}</td>
                    <td>RM{formatNumber(row.revenue)}</td>
                    <td className={row.profit >= 0 ? "pos" : "neg"}>
                      {row.profit < 0 ? "-" : ""}RM{formatNumber(Math.abs(row.profit))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <details className="roi-assumptions">
          <summary>Your costs and prices</summary>
          <div className="stack">
            <div className="field">
              <label htmlFor="roi-price">Average sale, RM</label>
              <input
                id="roi-price"
                type="number"
                min={1}
                value={avgPrice}
                onChange={(e) => setAvgPrice(Math.max(1, Number(e.target.value) || 1))}
              />
              <span className="hint">
                Seeded from the {preset.label.toLowerCase()} preset. Your own figure is better.
              </span>
            </div>
            <div className="field">
              <label htmlFor="roi-staff">People working the stall</label>
              <input
                id="roi-staff"
                type="number"
                min={0}
                value={staffCount}
                onChange={(e) => setStaffCount(Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
            <div className="field">
              <label htmlFor="roi-wage">Pay per person per day, RM</label>
              <input
                id="roi-wage"
                type="number"
                min={0}
                value={dailyWagePerStaff}
                onChange={(e) => setDailyWage(Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
            <div className="field">
              <label htmlFor="roi-other">Transport, setup and everything else, RM</label>
              <input
                id="roi-other"
                type="number"
                min={0}
                value={otherFixedRm}
                onChange={(e) => setOtherFixed(Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
            <p className="tiny muted">
              Cost of goods is taken from the {preset.label.toLowerCase()} preset at{" "}
              {Math.round(preset.cogsPct * 100)}%, the same figure the simulator uses.
            </p>
          </div>
        </details>

        <div className="notice warn">
          <span>
            <strong>The turnout figure is the organizer's own.</strong> Nobody audits it, and a
            larger number sells more booths. That is why this panel asks what share of the crowd
            you need rather than telling you what you would earn.
          </span>
        </div>
      </div>
    </section>
  );
}
