import { catchmentPercentile } from "@spotential/sim-engine";

/**
 * The heatmap's colour scale.
 *
 * NOT a green-to-red "good to bad" ramp, and that is a deliberate refusal.
 * Green would read as "open here", and this map knows nothing about
 * competition — it maps where people live, which is a different claim. So it
 * looks like what it is: a density scale, running cool to hot.
 *
 * CALIBRATED NATIONALLY, not to the view. Colouring against the densest cell
 * on screen would make suburban Petaling Jaya's busiest hexagon glow exactly
 * as hot as central KL's, which is the same relative-normalisation trap that
 * twice inverted the opportunity scores. Instead a cell's colour comes from
 * its percentile against the population-weighted distribution of where
 * Malaysians actually live — the same scale the Success Score uses, via the
 * engine's `catchmentPercentile`.
 *
 * That makes the legend interpretable: "hotter than 90% of where Malaysians
 * live" is a claim a reader can check, and it means the same thing in every
 * city.
 */

/**
 * A resolution-8 hexagon covers ~0.86 km²; a 500m circle covers 0.785 km².
 * Close enough to read a hexagon's population on the 500m catchment scale, and
 * the 9% difference is far inside the "estimate" this data supports anyway.
 */
const EQUIVALENT_RADIUS_M = 500;

export function percentileFor(population: number): number {
  return catchmentPercentile(population, EQUIVALENT_RADIUS_M);
}

/** Stops on the ramp, cool to hot. The app's navy and gold, then red for risk. */
const STOPS: { at: number; rgb: [number, number, number] }[] = [
  { at: 0, rgb: [232, 237, 247] },
  { at: 0.35, rgb: [145, 170, 216] },
  { at: 0.6, rgb: [0, 48, 135] },
  { at: 0.8, rgb: [242, 169, 0] },
  { at: 0.92, rgb: [224, 123, 0] },
  { at: 1, rgb: [220, 38, 38] },
];

const mix = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

/** Continuous colour for a percentile in 0–1. */
export function colourAt(percentile: number): string {
  const p = Math.min(1, Math.max(0, percentile));

  for (let i = 0; i < STOPS.length - 1; i += 1) {
    const low = STOPS[i]!;
    const high = STOPS[i + 1]!;
    if (p <= high.at) {
      const span = high.at - low.at;
      const t = span > 0 ? (p - low.at) / span : 0;
      const [r, g, b] = [0, 1, 2].map((c) => mix(low.rgb[c]!, high.rgb[c]!, t));
      return `rgb(${r}, ${g}, ${b})`;
    }
  }

  const last = STOPS[STOPS.length - 1]!;
  return `rgb(${last.rgb[0]}, ${last.rgb[1]}, ${last.rgb[2]})`;
}

export const colourForPopulation = (population: number) => colourAt(percentileFor(population));

/**
 * Legend rows, labelled by what the percentile MEANS rather than by a raw
 * population range — the whole point of calibrating nationally.
 */
export const LEGEND = [
  { percentile: 0.95, label: "Top 5% nationally" },
  { percentile: 0.85, label: "Top 15%" },
  { percentile: 0.7, label: "Top 30%" },
  { percentile: 0.5, label: "Median" },
  { percentile: 0.25, label: "Bottom 25%" },
  { percentile: 0.05, label: "Sparse" },
].map((row) => ({ ...row, colour: colourAt(row.percentile) }));
