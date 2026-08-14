/**
 * Number and currency formatting — SPEC §7.5.
 *
 * Lives in the engine, not the UI, so the panel, the CSV export, the print
 * stylesheet and anything the server renders all agree. ms-MY conventions are
 * used from the start: RM formatting is a locale concern, not a translation
 * one, and stays correct even after the UI is translated.
 */

const LOCALE = "ms-MY";

/** Money over RM1,000 loses the cents — nobody budgets a lease to the sen. */
const CENTS_THRESHOLD = 1000;

function nf(minimumFractionDigits: number, maximumFractionDigits: number): Intl.NumberFormat {
  return new Intl.NumberFormat(LOCALE, { minimumFractionDigits, maximumFractionDigits });
}

export function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const digits = Math.abs(value) >= CENTS_THRESHOLD ? 0 : 2;
  return `RM ${nf(digits, digits).format(value)}`;
}

/** Always two decimals. For per-unit figures like a RM5.76 cost of goods. */
export function formatCurrencyPrecise(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `RM ${nf(2, 2).format(value)}`;
}

/** Signed, for delta chips against the pinned baseline. */
export function formatCurrencyDelta(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "no change";
  const sign = value > 0 ? "+" : "−";
  return `${sign}${formatCurrency(Math.abs(value))}`;
}

/** @param value a fraction, e.g. 0.123 renders as "12.3%". */
export function formatPercent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return `${nf(digits, digits).format(value * 100)}%`;
}

export function formatNumber(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "—";
  return nf(digits, digits).format(value);
}

/** The banded headline. Falls back to the point estimate when there is no band. */
export function formatMonthBand(
  point: number | null,
  low: number | null,
  high: number | null,
): string {
  if (point === null) return "Never at these inputs";
  if (low === null || high === null || low === high) {
    return `${point} ${point === 1 ? "month" : "months"}`;
  }
  return `${low}–${high} months`;
}
