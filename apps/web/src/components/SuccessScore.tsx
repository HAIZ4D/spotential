import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";
import { formatPercent, type LocationScore, type ScoreKind } from "@spotential/sim-engine";

/**
 * The Overall Success Score — Feature 1d.
 *
 * The spider graph is the output; the number is a way to rank. A score out of
 * 100 beside a break-even calculator will be read as a forecast whatever the
 * caption says, so the framing has to be structural: the shape is the hero,
 * every component states whether it is measured or inferred, and the panel
 * says outright that the figure is for comparing sites rather than predicting
 * one.
 */

const KIND_LABEL: Record<ScoreKind, { text: string; cls: string }> = {
  direct: { text: "measured", cls: "green" },
  proxy: { text: "inferred", cls: "amber" },
  unavailable: { text: "no data", cls: "muted" },
};

function band(score: number): { cls: string; label: string } {
  if (score >= 70) return { cls: "green", label: "strong" };
  if (score >= 45) return { cls: "amber", label: "mixed" };
  return { cls: "red", label: "weak" };
}

/**
 * The shape, on its own, for the location page's hero.
 *
 * Split out so the ring (how good) and the radar (why) can sit side by side
 * as one figure. The dimension table below stays with the panel — the chart is
 * the headline, the table is the evidence.
 */
export function ScoreRadar({ score, height = 210 }: { score: LocationScore; height?: number }) {
  const chartData = score.dimensions.map((d) => ({
    axis: d.label,
    // Unavailable axes stay ON the chart at zero so the missing side of the
    // shape is visible rather than quietly closed up.
    value: d.kind === "unavailable" ? 0 : d.score,
  }));

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <RadarChart data={chartData} outerRadius="70%">
          <PolarGrid stroke="var(--line)" />
          <PolarAngleAxis dataKey="axis" tick={{ fontSize: 10, fill: "var(--ink-2)" }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Radar
            dataKey="value"
            stroke="var(--navy)"
            fill="var(--navy)"
            fillOpacity={0.22}
            isAnimationActive={false}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * The evidence behind the score: the honesty notice, then every dimension with
 * its basis and weight.
 *
 * `bare` drops the card chrome for the location page, where this is the body
 * of the Overview tab rather than one panel among seven.
 */
export function SuccessScore({ score, bare = false }: { score: LocationScore; bare?: boolean }) {
  const available = score.dimensions.filter((d) => d.kind !== "unavailable");
  const rentDimension = score.dimensions.find((d) => d.key === "rent");
  const overall = band(score.overall);

  const body = (
    <>
        <div className="notice info" style={{ marginBottom: 12 }}>
          <span>
            This is a <strong>comparison score, not a forecast</strong>. Nothing here has been
            validated against real business outcomes — it blends measured competition against
            inferred demand. A score means little alone; it earns its keep when you score two sites
            and compare the shapes below.
          </span>
        </div>

        {/* The radar lives in the hero on the location page, beside the ring.
            Kept here for any caller rendering the full card on its own. */}
        {!bare && <ScoreRadar score={score} height={280} />}

        <div className="table-scroll" style={{ marginTop: 8 }}>
          <table>
            <thead>
              <tr>
                <th>Dimension</th>
                <th>Score</th>
                <th>Weight</th>
                <th>Basis</th>
              </tr>
            </thead>
            <tbody>
              {score.dimensions.map((d) => {
                const kind = KIND_LABEL[d.kind];
                return (
                  <tr key={d.key}>
                    <td>
                      <div>{d.label}</div>
                      <div className="tiny muted" style={{ whiteSpace: "normal", maxWidth: 340 }}>
                        {d.note}
                      </div>
                    </td>
                    <td>
                      {d.kind === "unavailable" ? (
                        "—"
                      ) : (
                        <>
                          {/* A capped competitor search means the true score
                              can only be lower, so it is shown as a bound. */}
                          {d.isFloor ? "≤ " : ""}
                          {Math.round(d.score)}
                        </>
                      )}
                    </td>
                    <td>{d.weight > 0 ? formatPercent(d.weight, 0) : "—"}</td>
                    <td>
                      <span className={`pill ${kind.cls}`}>{kind.text}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <details style={{ marginTop: 12 }}>
          <summary className="small muted" style={{ cursor: "pointer" }}>
            How the score is weighted, and what it cannot tell you
          </summary>
          <div className="stack tiny muted" style={{ marginTop: 8 }}>
            <span>
              Weights reflect <strong>how much each signal can be trusted</strong>, not how much
              each factor matters to a business. We have no evidence for the latter, and inventing
              a ranking would be the least defensible part of this feature.
            </span>
            <span>
              <strong>Competitor count peaks rather than slopes.</strong> Fewer rivals is better
              only up to a point — zero competitors is an unproven pitch, not an open one.
            </span>
            <span>
              <strong>Competitor quality scores inversely:</strong> well-rated incumbents are
              harder to displace. It is genuinely ambiguous — it also signals a market that pays
              for quality — which is why it carries the lowest weight.
            </span>
            <span>
              {/* Feature 1e filled this axis in, but only where a benchmark
                  reaches. The caveat has to track what is actually on screen —
                  a panel that disclaims data it is showing teaches the reader
                  to ignore its disclaimers. */}
              {rentDimension?.kind === "direct" ? (
                <>
                  <strong>Rent is the figure you entered</strong>, so it carries more weight than
                  the inferred dimensions around it.
                </>
              ) : rentDimension?.kind === "proxy" ? (
                <>
                  <strong>Rent is a researched benchmark</strong>, not a transacted figure —
                  Malaysia does not publish those in machine-readable form. It carries the smallest
                  weight of the five; enter a real quote to firm it up.
                </>
              ) : (
                <>
                  Rent sensitivity has no benchmark covering this spot. It is excluded rather than
                  guessed.
                </>
              )}{" "}
              Weights renormalise over what is available, so {formatPercent(score.completeness, 0)}{" "}
              of the intended profile is measured here.
            </span>
            <span>
              {available.length} of {score.dimensions.length} dimensions available at this point.
            </span>
          </div>
        </details>
    </>
  );

  if (bare) return body;

  return (
    <section className="card">
      <header>
        <h2>Location profile</h2>
        <span className={`pill ${overall.cls}`}>
          {Math.round(score.overall)} / 100 · {overall.label}
        </span>
      </header>
      <div className="body">{body}</div>
    </section>
  );
}
