import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";
import { formatPercent, type LocationScore, type ScoreKind } from "@spotential/sim-engine";
import { bandFor } from "./analysis/ScoreRing.js";
import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

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
export function ScoreRadar({ score, height = 200 }: { score: LocationScore; height?: number }) {
  const chartData = score.dimensions.map((d) => ({
    axis: d.label,
    // Unavailable axes stay ON the chart at zero so the missing side of the
    // shape is visible rather than quietly closed up.
    value: d.kind === "unavailable" ? 0 : d.score,
  }));

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        {/* 70% left a visible band of empty space inside the container and a
            gap under the hero. 78% fills the box and enlarges the labels,
            which are what make the shape readable. */}
        <RadarChart data={chartData} outerRadius="78%">
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

  const barsRef = useRef<HTMLDivElement>(null);

  /**
   * The bars grow from nothing.
   *
   * `useGSAP` with a scope rather than a raw effect: killing a `from` tween
   * freezes its targets wherever they reached instead of putting them back,
   * and under StrictMode's double mount that leaves every bar at zero width.
   * `revertOnUpdate` re-runs it cleanly when the score changes.
   *
   * Width, not transform: these are inside a track with `overflow: hidden`,
   * so a scaled bar would still paint outside its own rail.
   */
  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.from(".dim-bar-fill", {
        width: 0,
        duration: 0.55,
        stagger: 0.05,
        ease: "power2.out",
      });
    },
    { dependencies: [score], scope: barsRef, revertOnUpdate: true },
  );

  const body = (
    <>
        {/**
          * One line, not a filled box.
          *
          * The caveat is the honesty the whole product rests on, so it stays.
          * But it had been sitting in the best space on the page, above the
          * data, in a coloured panel, every single visit — which is how a
          * warning stops being read. The hero carries the short form; this is
          * for a caller rendering the card on its own.
          */}
        {!bare && (
          <p className="score-caveat">
            A <strong>comparison aid, not a forecast</strong>. Nothing in it has been checked
            against real business outcomes. It blends measured competition against inferred demand,
            and it earns its keep when you score two sites and compare them.
          </p>
        )}

        {/* The radar lives in the hero on the location page, beside the ring.
            Kept here for any caller rendering the full card on its own. */}
        {!bare && <ScoreRadar score={score} height={280} />}

        {/* The ranking, before the table.

            Five numbers in a column make you compare them yourself; a bar
            shows which axis is carrying the score and which is dragging it
            down at a glance. Same device as the PDF and /compare, so all
            three surfaces read alike. The table below still holds every
            figure, weight and basis. */}
        <div className="dim-bars" ref={barsRef}>
          {score.dimensions.map((d) => {
            const measured = d.kind !== "unavailable";
            return (
              <div className="dim-bar" key={d.key}>
                <span className="dim-bar-label">{d.label}</span>
                <span className="dim-bar-track">
                  {measured && (
                    <i
                      className={`dim-bar-fill ${bandFor(Math.round(d.score)).cls}`}
                      style={{ width: `${Math.max(1.5, Math.min(100, d.score))}%` }}
                    />
                  )}
                </span>
                <span className={`dim-bar-value ${measured ? "" : "muted"}`}>
                  {measured ? `${d.isFloor ? "≤" : ""}${Math.round(d.score)}` : "not scored"}
                </span>
              </div>
            );
          })}
        </div>

        {/**
          * The working, folded away.
          *
          * This table is the FOURTH statement of the same five numbers: ring,
          * bars, then every figure again with its weight and basis. All of it
          * is worth having and none of it is worth reading first, which is
          * exactly what a disclosure is for.
          */}
        <details className="score-working">
          <summary>How this was scored</summary>
          <div className="table-scroll">
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
                      <div className="dim-note">{d.note}</div>
                    </td>
                    <td>
                      {d.kind === "unavailable" ? (
                        "not scored"
                      ) : (
                        <>
                          {/* A capped competitor search means the true score
                              can only be lower, so it is shown as a bound. */}
                          {d.isFloor ? "≤ " : ""}
                          {Math.round(d.score)}
                        </>
                      )}
                    </td>
                    <td>{d.weight > 0 ? formatPercent(d.weight, 0) : "excluded"}</td>
                    <td>
                      <span className={`pill ${kind.cls}`}>{kind.text}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>

          <div className="stack tiny muted" style={{ marginTop: 8 }}>
            <span>
              Weights reflect <strong>how much each signal can be trusted</strong>, not how much
              each factor matters to a business. We have no evidence for the latter, and inventing
              a ranking would be the least defensible part of this feature.
            </span>
            <span>
              <strong>Competitor count peaks rather than slopes.</strong> Fewer rivals is better
              only up to a point. Zero competitors is an unproven pitch, not an open one.
            </span>
            <span>
              <strong>Competitor quality scores inversely:</strong> well-rated incumbents are
              harder to displace. It is genuinely ambiguous, because it also signals a market that pays
              for quality, which is why it carries the lowest weight.
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
                  <strong>Rent is a researched benchmark</strong>, not a transacted figure.
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
