import type { SimulationResult, Warning } from "@spotential/sim-engine";
import type { NumericField } from "../state/useScenario.js";

/**
 * Plausibility warnings — SPEC §6. Advisory, specific, never blocking.
 *
 * Nothing stops a user entering 500 transactions/day into a 20-seat shop, and
 * the tool would otherwise report a two-month payback with a straight face.
 * But a hard cap would break the ghost kitchen with no seats, so every one of
 * these can be ignored.
 */
export function WarningsPanel({
  result,
  onApply,
}: {
  result: SimulationResult;
  onApply: (field: NumericField, value: number) => void;
}) {
  if (result.warnings.length === 0) return null;

  const rank: Record<Warning["severity"], number> = { danger: 0, warn: 1, info: 2 };
  const sorted = [...result.warnings].sort((a, b) => rank[a.severity] - rank[b.severity]);

  return (
    <section className="no-print">
      {sorted.map((w) => (
        <div className={`notice ${w.severity === "warn" ? "warn" : w.severity}`} key={w.code}>
          <span>{w.message}</span>
          {w.suggestedValue !== null && w.field && (
            <button
              type="button"
              className="tiny fix"
              onClick={() => onApply(w.field as NumericField, w.suggestedValue as number)}
            >
              use {w.suggestedValue}
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
