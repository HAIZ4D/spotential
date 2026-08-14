import { rampCurve } from "@spotential/sim-engine";

/**
 * The derived ramp curve, drawn beside the "months to full capacity" input.
 *
 * One number controls it, but the user should be able to SEE what that number
 * means — a curve that starts at 40% and eases to full, not a step change.
 */
export function RampSparkline({ monthsToMaturity }: { monthsToMaturity: number }) {
  const curve = rampCurve(monthsToMaturity, 12);
  const width = 200;
  const height = 28;

  const points = curve
    .map((v, i) => {
      const x = (i / (curve.length - 1)) * width;
      const y = height - v * (height - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      className="sparkline"
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Demand ramps to full capacity over ${monthsToMaturity} months`}
    >
      <line x1="0" y1="1" x2={width} y2="1" stroke="var(--line)" strokeWidth="1" />
      <polyline
        points={points}
        fill="none"
        stroke="var(--navy)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
