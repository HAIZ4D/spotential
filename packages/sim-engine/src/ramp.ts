/**
 * The ramp curve — SPEC §4.6.
 *
 * New outlets do not hit full covers in month one, and modelling them as if
 * they do is what produced the spec's original 4.1-month payback. Exposed to
 * the user as a single control ("months to full capacity"); the curve itself
 * is derived, with an ease-out shape so growth is fastest early then tapers.
 */

/** Month-one fraction of steady-state demand. */
export const RAMP_START = 0.4;

/**
 * @param month 1-indexed. Month 0 is the opening cash position and has no demand.
 * @param monthsToMaturity months until full capacity.
 */
export function ramp(month: number, monthsToMaturity: number): number {
  if (month <= 0) return 0;
  // M <= 1 means instant maturity. Guards the (m-1)/(M-1) division.
  if (monthsToMaturity <= 1) return 1;
  if (month >= monthsToMaturity) return 1;

  const p = (month - 1) / (monthsToMaturity - 1);
  return RAMP_START + (1 - RAMP_START) * (1 - (1 - p) ** 2);
}

/** The whole curve, for the sparkline beside the input. */
export function rampCurve(monthsToMaturity: number, months = 12): number[] {
  return Array.from({ length: months }, (_, i) => ramp(i + 1, monthsToMaturity));
}
