import { formatNumber, type CategoryGap } from "@spotential/sim-engine";
import type { GapsResponse } from "../lib/api.js";

/**
 * Opportunity Gap Detection — the panel.
 *
 * Its job is as much about what it refuses to claim as what it shows. The
 * limitations are on screen, not in a tooltip: an SME could sign a lease on
 * this, and the demand signal here is a proxy built from review counts.
 */

const VERDICT_STYLE: Record<string, { cls: string; label: string }> = {
  underserved: { cls: "green", label: "underserved" },
  balanced: { cls: "muted", label: "balanced" },
  saturated: { cls: "red", label: "saturated" },
  "no-presence": { cls: "muted", label: "no presence" },
};

export function OpportunityGaps({ data }: { data: GapsResponse }) {
  const { ranked, noPresence, topOpportunity, narrative } = data;

  if (!data.placesConfigured) return null;

  if (ranked.length === 0) {
    return (
      <section className="card">
        <header>
          <h2>Opportunity gaps</h2>
        </header>
        <div className="body">
          <div className="notice info">
            No F&amp;B outlets of any tracked category were found within{" "}
            {formatNumber(data.radiusMetres)}m. With nothing trading here there is no signal to
            compare against — that is not the same as an opportunity.
          </div>
        </div>
      </section>
    );
  }

  const best = Math.max(...ranked.map((r) => r.gapScore), 0.0001);

  return (
    <section className="card">
      <header>
        <h2>Opportunity gaps</h2>
        {topOpportunity && <span className="pill green">best: {topOpportunity.label}</span>}
      </header>

      <div className="body">
        {/* No winner is a real answer. In a dense city centre every category
            comes back saturated, and naming the least crowded of six crowded
            categories would contradict the "saturated" label beside it. */}
        {!topOpportunity && (
          <div className="notice warn" style={{ marginBottom: 12 }}>
            {ranked.every((r) => r.verdict === "saturated")
              ? "Every tracked category is already crowded here. There is no clear gap at this spot — which is itself a finding worth taking seriously."
              : "Nothing stands out at this spot. No category shows meaningfully more demand per outlet than the others."}
          </div>
        )}

        {narrative && (
          <p style={{ margin: "0 0 12px", fontSize: 13 }}>
            {narrative}
          </p>
        )}

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Outlets</th>
                <th>Reviews / outlet</th>
                <th>Rating</th>
                <th>Opportunity</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((row) => (
                <tr key={row.category}>
                  <td>{row.label}</td>
                  <td>
                    {/* A capped search is a floor, never an exact count. */}
                    {row.outletsAreMinimum ? `${row.outlets}+` : row.outlets}
                  </td>
                  <td>{row.reviewsPerOutlet === null ? "no data" : formatNumber(row.reviewsPerOutlet)}</td>
                  <td>{row.averageRating ?? "unrated"}</td>
                  <td>
                    <GapBar row={row} best={best} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {noPresence.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div className="tiny muted" style={{ fontWeight: 600, marginBottom: 4 }}>
              NOT FOUND NEARBY — no signal either way
            </div>
            <div className="small muted">
              {noPresence.map((r) => r.label).join(" · ")}
            </div>
            <p className="tiny muted" style={{ margin: "6px 0 0" }}>
              Zero outlets is <strong>not</strong> evidence of an opportunity. It may mean untapped
              demand, or that there is no appetite for it here — this data cannot tell the two
              apart, so these are deliberately left out of the ranking.
            </p>
          </div>
        )}

        <details style={{ marginTop: 14 }}>
          <summary className="small muted" style={{ cursor: "pointer" }}>
            How this is calculated, and what it cannot tell you
          </summary>
          <div className="stack tiny muted" style={{ marginTop: 8 }}>
            <span>
              <strong>Reviews per outlet</strong> stands in for how busy existing operators are.
              Many outlets each with few reviews suggests the trade is thinly spread; few outlets
              carrying heavy review counts suggests they are busy. It is a proxy, not a measure of
              demand.
            </span>
            <span>
              Scores are <strong>relative to the other categories at this spot</strong>, not to
              Malaysia as a whole. The claim is "underserved compared with what else trades on this
              street".
            </span>
            <span>
              Review counts are lifetime totals, so they favour long-established businesses over
              busy new ones.
            </span>
            <span>
              Google&rsquo;s category labels are approximate — a Korean restaurant tagged simply as
              &ldquo;restaurant&rdquo; lands in the wrong bucket.
            </span>
            <span>
              Real demographic demand data arrives with the next slice and will replace this proxy.
            </span>
          </div>
        </details>
      </div>
    </section>
  );
}

function GapBar({ row, best }: { row: CategoryGap; best: number }) {
  const style = VERDICT_STYLE[row.verdict] ?? VERDICT_STYLE["balanced"]!;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 170 }}>
      <span className="sens-bar" style={{ flex: 1, minWidth: 70 }}>
        <span
          style={{
            width: `${Math.round((row.gapScore / best) * 100)}%`,
            background: row.verdict === "saturated" ? "var(--red)" : "var(--navy)",
          }}
        />
      </span>
      <span className={`pill ${style.cls}`}>{style.label}</span>
    </span>
  );
}
