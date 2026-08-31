import { useEffect, useRef } from "react";
import gsap from "gsap";
import type { ScoreDimension } from "@spotential/sim-engine";
import { bandFor } from "../analysis/ScoreRing.js";

/**
 * A fittability ring.
 *
 * The reference design puts a row of small progress circles on the right of
 * each row, and that device works here for a reason it did not there: every
 * ring is one dimension of the Event Opportunity Score, so the row is a
 * miniature of the same breakdown the detail page expands. Colour comes from
 * `bandFor`, the same three bands used by the score ring on /analysis and the
 * bars on /compare — a green ring means the same thing everywhere in the app.
 *
 * AN UNSCORED DIMENSION DRAWS NO ARC. A zero-length arc and a genuine zero look
 * identical and mean opposite things, so an unavailable axis renders an empty
 * track with a dash, and the label underneath still names what is missing.
 */

const SIZE = 44;
const STROKE = 3.5;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

export function MetricRing({
  dimension,
  label,
  delay = 0,
}: {
  dimension: ScoreDimension;
  label: string;
  delay?: number;
}) {
  const arcRef = useRef<SVGCircleElement>(null);
  const measured = dimension.kind !== "unavailable";
  const band = bandFor(Math.round(dimension.score));

  useEffect(() => {
    const arc = arcRef.current;
    if (!arc || !measured) return;

    const target = C * (1 - Math.min(100, Math.max(0, dimension.score)) / 100);

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      gsap.set(arc, { strokeDashoffset: target });
      return;
    }

    // Sweeps from empty so the ring reads as a value being filled rather than
    // as a shape that was always there.
    const tween = gsap.fromTo(
      arc,
      { strokeDashoffset: C },
      { strokeDashoffset: target, duration: 0.7, delay, ease: "power2.out" },
    );
    return () => {
      tween.kill();
    };
  }, [dimension.score, measured, delay]);

  return (
    <div className="metric" title={dimension.note}>
      <svg width={SIZE} height={SIZE} role="img" aria-label={`${label}: ${measured ? Math.round(dimension.score) + " out of 100" : "not scored"}`}>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--line)" strokeWidth={STROKE} />
        {measured && (
          <circle
            ref={arcRef}
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke={band.colour}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        )}
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          className="metric-value"
          fill={measured ? "var(--ink)" : "var(--ink-3)"}
        >
          {measured ? Math.round(dimension.score) : "–"}
        </text>
      </svg>
      <span className="metric-label">{label}</span>
    </div>
  );
}

/** The three axes most useful for choosing between events, in decision order. */
export const RING_KEYS: { key: string; label: string }[] = [
  { key: "categoryFit", label: "Fit" },
  { key: "boothAffordability", label: "Cost" },
  { key: "vendorCompetition", label: "Crowd" },
];
