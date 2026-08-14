import type { LeverField, Recovery, ScenarioInputs } from "./types.js";
import { core, safeCeilOrNull } from "./basis.js";
import { STATUTORY } from "./presets/statutory.js";

/**
 * The recovery state — SPEC §4.11.
 *
 * When a scenario never breaks even, do not print infinity. Solve each lever
 * for the value that would reach break-even, and report null for any lever
 * that cannot get there at all — rent would have to go negative, or COGS
 * would have to be less than nothing. A loss-making scenario then becomes the
 * most useful screen in the product instead of a dead end.
 *
 * Second-order effects are deliberately ignored: raising the price enough to
 * break even could push annual revenue past the SST threshold, which would
 * change the answer slightly. Modelling that feedback loop would make the
 * suggested figure harder to explain than it is worth.
 */

/** null rather than a garbage figure whenever the arithmetic overflows. */
const finite = (x: number): number | null => (Number.isFinite(x) ? x : null);

const ceil2 = (x: number): number | null => finite(Math.ceil(x * 100 - 1e-9) / 100);
const floor2 = (x: number): number | null => finite(Math.floor(x * 100 + 1e-9) / 100);
const floor4 = (x: number): number | null => finite(Math.floor(x * 10000 + 1e-9) / 10000);

export function solveRecovery(inputs: ScenarioInputs): Recovery {
  const c = core(inputs);
  const { fixedMonthlyCosts, monthlyTransactions, tradingDays, cogsPerUnit } = c;

  // netContributionPerTransaction == price * taxFactor - cogsPerUnit
  const taxFactor = c.sstApplies
    ? 1 - inputs.dineInSharePct * STATUTORY.serviceTax.rate
    : 1;

  // 1. Volume. Needs positive contribution per transaction to be reachable,
  //    and safeCeilOrNull catches a contribution so small the division blows up.
  const customersPerDay =
    c.netContributionPerTransaction > 0 && tradingDays > 0
      ? safeCeilOrNull(fixedMonthlyCosts / (c.netContributionPerTransaction * tradingDays))
      : null;

  // 2. Price. Cost per unit is held (SPEC §4.3), so every extra ringgit of
  //    price drops straight into contribution.
  const avgPricePerTransaction =
    monthlyTransactions > 0 && taxFactor > 0
      ? ceil2((fixedMonthlyCosts / monthlyTransactions + cogsPerUnit) / taxFactor)
      : null;

  // 3. Rent. Often unreachable — the shortfall can exceed the entire rent bill,
  //    which would mean the landlord paying you to be there.
  const contribution = monthlyTransactions * c.netContributionPerTransaction;
  const rentCandidate = inputs.monthlyRent - (fixedMonthlyCosts - contribution);
  const monthlyRent = rentCandidate >= 0 ? floor2(rentCandidate) : null;

  // 4. COGS. Unreachable when the shortfall exceeds the entire cost of goods.
  const cogsPerUnitCandidate =
    monthlyTransactions > 0
      ? inputs.avgPricePerTransaction * taxFactor - fixedMonthlyCosts / monthlyTransactions
      : null;
  const cogsPct =
    cogsPerUnitCandidate !== null &&
    cogsPerUnitCandidate >= 0 &&
    inputs.avgPricePerTransaction > 0
      ? floor4(cogsPerUnitCandidate / inputs.avgPricePerTransaction)
      : null;

  const candidates: { field: LeverField; current: number; target: number | null }[] = [
    { field: "customersPerDay", current: inputs.customersPerDay, target: customersPerDay },
    {
      field: "avgPricePerTransaction",
      current: inputs.avgPricePerTransaction,
      target: avgPricePerTransaction,
    },
    { field: "monthlyRent", current: inputs.monthlyRent, target: monthlyRent },
    { field: "cogsPct", current: inputs.cogsPct, target: cogsPct },
  ];

  // "Closest" is the smallest proportional move, which is a reasonable proxy
  // for effort. It is not a claim that all levers are equally easy to pull —
  // the UI pairs this with a practicality note.
  let closestLever: LeverField | null = null;
  let smallestMove = Number.POSITIVE_INFINITY;
  for (const { field, current, target } of candidates) {
    if (target === null || current === 0) continue;
    const move = Math.abs(target - current) / Math.abs(current);
    if (move < smallestMove) {
      smallestMove = move;
      closestLever = field;
    }
  }

  return { customersPerDay, avgPricePerTransaction, monthlyRent, cogsPct, closestLever };
}
