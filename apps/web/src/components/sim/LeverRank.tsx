import type { LeverField, SensitivityEntry } from "@spotential/sim-engine";

/**
 * How much this input actually moves the answer.
 *
 * The page already computed this — the sensitivity panel at the bottom ranks
 * all four levers by how far a ±20% move shifts payback. It just never told
 * the form, so "Misc & maintenance" looked exactly as important as the price.
 * This puts the ranking on the control itself.
 *
 * The ORDER of the fields never changes, only this badge: a form that
 * reshuffled itself while you typed would be unusable.
 */
export function LeverRank({
  field,
  sensitivity,
}: {
  field: LeverField;
  sensitivity: SensitivityEntry[];
}) {
  const index = sensitivity.findIndex((entry) => entry.field === field);
  if (index < 0) return null;

  const entry = sensitivity[index]!;

  // A lever that moves payback by under a month is not worth ranking; saying
  // "#3 strongest" of four near-identical levers implies a precision the
  // sweep does not support.
  if (entry.spread < 1) {
    return <span className="lever-rank flat">barely moves it</span>;
  }

  const months = Math.round(entry.spread);
  const label = index === 0 ? "strongest lever" : `#${index + 1}`;

  return (
    <span className={`lever-rank ${index === 0 ? "top" : ""}`}>
      {label} · ±20% swings payback {months} month{months === 1 ? "" : "s"}
    </span>
  );
}
