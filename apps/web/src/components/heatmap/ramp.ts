import { catchmentPercentile } from "@spotential/sim-engine";

/**
 * The heatmap's colour scale.
 *
 * GREEN THROUGH YELLOW TO RED, the familiar heat ramp, chosen by the product
 * owner over the earlier navy-to-red scale after the trade-off was put to
 * them. It is worth being precise about what that trade-off is, because the
 * legend copy is what pays for it:
 *
 *   Red is the HOTTEST end, so red means the MOST residents and green the
 *   fewest. The hazard is not that anyone reads red as "crowded with rivals"
 *   — it is that a green area looks like room to open, when it actually means
 *   almost nobody lives there. This map still knows nothing about
 *   competition. The legend therefore runs hottest-first and says so in
 *   words, rather than leaving swatches to speak.
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

/**
 * Stops on the ramp, coldest to hottest.
 *
 * Order is load-bearing and a test pins it: reversing these would silently
 * invert what the whole map claims, and nothing else in the code would
 * complain.
 */
const STOPS: { at: number; rgb: [number, number, number] }[] = [
  { at: 0, rgb: [ 34, 139,  84] },
  { at: 0.35, rgb: [124, 190,  75] },
  { at: 0.55, rgb: [214, 222,  62] },
  { at: 0.72, rgb: [250, 204,  21] },
  { at: 0.86, rgb: [244, 133,  25] },
  { at: 1, rgb: [214,  35,  35] },
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
 * Legend rows, HOTTEST FIRST and labelled in plain words.
 *
 * Order and wording are the safety mechanism for the green-to-red ramp. Read
 * top-down, the first thing anyone sees is that red means the most people; the
 * green row says explicitly that it means few residents, not room to trade.
 * Percentiles stay because they are checkable and mean the same in every city.
 */
export const LEGEND = [
  { percentile: 0.95, label: "Most people", note: "top 5% nationally" },
  { percentile: 0.86, label: "Busy", note: "top 15%" },
  { percentile: 0.72, label: "Above average", note: "top 30%" },
  { percentile: 0.5, label: "Typical", note: "national median" },
  { percentile: 0.25, label: "Quiet", note: "bottom 25%" },
  { percentile: 0.03, label: "Few people", note: "almost nobody lives here" },
].map((row) => ({ ...row, colour: colourAt(row.percentile) }));

/**
 * How much weight one cell contributes before the surface saturates.
 *
 * THE NATIONAL CALIBRATION, and the single most important constant here.
 * A heat surface normalises to the busiest thing in view unless you stop it,
 * which would paint suburban Petaling Jaya's densest patch exactly as red as
 * central Kuala Lumpur's and make the two cities incomparable. That is the
 * relative-normalisation trap that has already inverted this project's
 * scoring twice.
 *
 * Fixed instead to the 90th percentile of the national distribution — 7,213
 * residents in a 500m catchment, straight out of the engine's measured
 * deciles. A cell at that density contributes full weight on its own;
 * anything denser, or several dense cells overlapping, saturates to red.
 */
export const SATURATION_POPULATION = 7_213;

/** A cell's contribution to the surface, 0..1, on the national scale. */
export function weightFor(population: number): number {
  return Math.max(0, Math.min(1, population / SATURATION_POPULATION));
}
