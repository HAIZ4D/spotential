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

/**
 * An optional smaller ring, and the reason it is a PROP rather than a CSS
 * transform on the caller's side.
 *
 * The compare page wanted a ring beside two lines of text and scaled it with
 * `transform: scale(0.62)`. A transform does not change layout: the 132px box
 * kept its 132px column while the paint shrank, so the ring visually spilled
 * ~15px into the text next to it and the reading ran underneath it. Sizing the
 * SVG itself is the only version where the layout box and the drawing agree.
 *
 * Everything inside scales with it, including the type, or a 82px ring gets
 * 38px digits and the number overflows its own circle.
 */
export function ScoreRing({ score, size = SIZE }: { score: number; size?: number }) {
  const stroke = Math.max(6, Math.round((STROKE * size) / SIZE));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const scale = size / SIZE;
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
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={`Success score ${Math.round(score)} out of 100`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--line)"
          strokeWidth={stroke}
        />
        <circle
          className="ring-arc"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={band.colour}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
        />
      </svg>

      <div className="ring-centre" style={{ fontSize: `${scale}em` }}>
        {/* Counts up as the arc sweeps, so the two read as one movement
            rather than a number that snaps while a ring travels. Banding
            still uses the FINAL score: a ring that changed colour on its way
            past 40 and 70 would flash a verdict it does not hold. */}
        <span className="ring-score">{Math.round(counted)}</span>
        {/* Dropped on a small ring. Three stacked lines inside 86px crowd the
            arc, and "out of 100" is the one a reader can infer: the number and
            the band cannot be. */}
        {size >= 110 && <span className="ring-out-of">out of 100</span>}
        <span className="ring-band" style={{ color: band.colour }}>
          {band.label.toUpperCase()}
        </span>
      </div>
    </div>
  );
}
