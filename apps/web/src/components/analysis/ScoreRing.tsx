import { useEffect, useState } from "react";
import { useCountUp } from "../sim/useCountUp.js";

/**
 * The Success Score, as the first thing the eye lands on.
 *
 * The old page buried this below the map in a panel styled exactly like the
 * six around it, which meant the page had no focal point at all — everything
 * carried the same weight, so nothing did.
 *
 * Bands match the score's own language elsewhere in the app, and the colours
 * are the state colours from CLAUDE.md rather than a decorative ramp: red is
 * risk, gold is caution, green is good.
 */

export interface Band {
  label: string;
  colour: string;
  cls: "red" | "amber" | "green";
}

export function bandFor(score: number): Band {
  if (score >= 70) return { label: "Strong", colour: "var(--green)", cls: "green" };
  if (score >= 40) return { label: "Mixed", colour: "var(--gold)", cls: "amber" };
  return { label: "Weak", colour: "var(--red)", cls: "red" };
}

const SIZE = 132;
const STROKE = 11;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ScoreRing({ score }: { score: number }) {
  // 700ms: this happens once on arrival and nothing is waiting on it, unlike
  // the simulator's sliders where 200ms is right because they fire on drag.
  const counted = useCountUp(score, 700);

  // Banded on the ROUNDED value. Scoring 39.6 renders as "40" but bands as
  // weak, so the ring would read "40 · WEAK" with the boundary sitting at 40 —
  // a contradiction the reader has no way to resolve.
  const band = bandFor(Math.round(score));

  // Sweeps from zero on mount. Held in state rather than animated in CSS from
  // a hardcoded start so the arc always begins empty, whatever the score.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(score));
    return () => cancelAnimationFrame(frame);
  }, [score]);

  const clamped = Math.max(0, Math.min(100, shown));

  return (
    <div className="ring-wrap">
      <svg width={SIZE} height={SIZE} role="img" aria-label={`Success score ${Math.round(score)} out of 100`}>
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="var(--line)"
          strokeWidth={STROKE}
        />
        <circle
          className="ring-arc"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={band.colour}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - clamped / 100)}
        />
      </svg>

      <div className="ring-centre">
        {/* Counts up as the arc sweeps, so the two read as one movement
            rather than a number that snaps while a ring travels. Banding
            still uses the FINAL score: a ring that changed colour on its way
            past 40 and 70 would flash a verdict it does not hold. */}
        <span className="ring-score">{Math.round(counted)}</span>
        <span className="ring-out-of">out of 100</span>
        <span className="ring-band" style={{ color: band.colour }}>
          {band.label.toUpperCase()}
        </span>
      </div>
    </div>
  );
}
