import type { LeverField, ScenarioInputs, SensitivityEntry } from "./types.js";
import { HORIZON_MONTHS, cogsPerUnitOf, paybackMonthOf } from "./basis.js";

/**
 * Which lever actually moves the answer — SPEC §4.9.
 *
 * Nearly free once the engine is a pure function, and it produces the single
 * most actionable line in the product. It also supplies the banded headline
 * (§4.10) and, when a scenario never breaks even, the ranking that decides
 * which recovery lever is offered first.
 *
 * Ranking order is also the tie-break order, and Array#sort is stable, so a
 * tie falls back to this list.
 */
const LEVERS: readonly LeverField[] = [
  "avgPricePerTransaction",
  "customersPerDay",
  "cogsPct",
  "monthlyRent",
];

/**
 * Multiply one lever by `factor`, preserving the SPEC §4.3 invariant.
 *
 * The price case is the whole reason per-unit COGS exists: flexing price must
 * NOT drag ingredient cost along with it, or price and volume become
 * mathematically identical levers and this entire ranking says nothing.
 */
export function flex(inputs: ScenarioInputs, field: LeverField, factor: number): ScenarioInputs {
  const next: ScenarioInputs = { ...inputs };

  switch (field) {
    case "avgPricePerTransaction":
      next.cogsPerUnitOverride = cogsPerUnitOf(inputs);
      next.avgPricePerTransaction = inputs.avgPricePerTransaction * factor;
      break;
    case "customersPerDay":
      next.customersPerDay = inputs.customersPerDay * factor;
      break;
    case "cogsPct":
      // Scale the effective per-unit cost directly, so the flex behaves the
      // same whether or not the caller had already pinned an override.
      next.cogsPerUnitOverride = cogsPerUnitOf(inputs) * factor;
      next.cogsPct = inputs.cogsPct * factor;
      break;
    case "monthlyRent":
      next.monthlyRent = inputs.monthlyRent * factor;
      break;
  }

  return next;
}

/** A payback of null (never, within the horizon) ranks as just past the horizon. */
const asMonths = (payback: number | null): number => payback ?? HORIZON_MONTHS + 1;

export function sensitivity(inputs: ScenarioInputs): SensitivityEntry[] {
  return LEVERS.map((field) => {
    const paybackAtMinus20 = paybackMonthOf(flex(inputs, field, 0.8));
    const paybackAtPlus20 = paybackMonthOf(flex(inputs, field, 1.2));
    return {
      field,
      paybackAtMinus20,
      paybackAtPlus20,
      spread: Math.abs(asMonths(paybackAtMinus20) - asMonths(paybackAtPlus20)),
    };
  }).sort((a, b) => b.spread - a.spread);
}

/**
 * The banded headline — SPEC §4.10.
 *
 * Line items stay precise because they are arithmetic on inputs the user
 * supplied. The headline is banded because it is the number people repeat to
 * their spouse and their bank, and it does not deserve one-decimal confidence.
 *
 * @param ranked pass the already-computed ranking to avoid re-running the sweep.
 */
export function paybackBand(
  inputs: ScenarioInputs,
  ranked: SensitivityEntry[] = sensitivity(inputs),
): { low: number | null; high: number | null } {
  const top = ranked[0];
  if (!top) return { low: null, high: null };

  const months = [
    paybackMonthOf(flex(inputs, top.field, 0.9)),
    paybackMonthOf(flex(inputs, top.field, 1.1)),
  ].filter((m): m is number => m !== null);

  if (months.length === 0) return { low: null, high: null };
  return { low: Math.min(...months), high: Math.max(...months) };
}
