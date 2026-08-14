import type { Operation, PatchOp, ScenarioInputs } from "./types.js";
import { cogsPerUnitOf, r2, r4 } from "./basis.js";

/**
 * Scenario patches — SPEC §8.2 and §8.4.
 *
 * The grammar an AI question is compiled down to, and the single place the
 * SPEC §4.3 price/cost invariant is enforced. The UI's own field edits go
 * through the same function, so a slider drag and an AI patch cannot diverge.
 *
 * Everything here treats its input as hostile: the operations may have come
 * from a language model, or from a share URL someone was sent.
 */

/**
 * The allow-list. An operation naming anything else is rejected outright —
 * this is what stops a jailbroken model, or a crafted link, reaching a field
 * the engine was never meant to expose.
 */
export const PATCHABLE_FIELDS = [
  "avgPricePerTransaction",
  "customersPerDay",
  "cogsPct",
  "monthlyRent",
  "staffCount",
  "avgMonthlyWage",
  "utilities",
  "marketing",
  "miscMonthly",
  "licensingFees",
  "initialInvestment",
  "securityDepositMonths",
  "monthsToMaturity",
  "daysOpenPerWeek",
  "openHoursPerDay",
  "seats",
  "serviceChargePct",
  "dineInSharePct",
] as const;

export type PatchableField = (typeof PATCHABLE_FIELDS)[number];

const PATCH_OPS: readonly PatchOp[] = ["set", "mul", "add", "pct_delta"];

/** Absolute sanity bounds, applied AFTER the operation resolves. */
const FIELD_BOUNDS: Record<PatchableField, { min: number; max: number }> = {
  avgPricePerTransaction: { min: 0, max: 100_000 },
  customersPerDay: { min: 0, max: 100_000 },
  cogsPct: { min: 0, max: 1 },
  monthlyRent: { min: 0, max: 10_000_000 },
  staffCount: { min: 0, max: 1_000 },
  avgMonthlyWage: { min: 0, max: 1_000_000 },
  utilities: { min: 0, max: 10_000_000 },
  marketing: { min: 0, max: 10_000_000 },
  miscMonthly: { min: 0, max: 10_000_000 },
  licensingFees: { min: 0, max: 10_000_000 },
  initialInvestment: { min: 0, max: 100_000_000 },
  securityDepositMonths: { min: 0, max: 24 },
  monthsToMaturity: { min: 1, max: 36 },
  daysOpenPerWeek: { min: 1, max: 7 },
  openHoursPerDay: { min: 1, max: 24 },
  seats: { min: 0, max: 10_000 },
  serviceChargePct: { min: 0, max: 0.5 },
  dineInSharePct: { min: 0, max: 1 },
};

/** A runaway patch is a bug or an attack, never a legitimate question. */
export const MAX_OPERATIONS = 8;

const INTEGER_FIELDS = new Set<PatchableField>([
  "staffCount",
  "seats",
  "daysOpenPerWeek",
  "monthsToMaturity",
]);

/** Fields that are fractions of 1 rather than money, so 4dp not 2dp. */
const FRACTION_FIELDS = new Set<PatchableField>([
  "cogsPct",
  "serviceChargePct",
  "dineInSharePct",
]);

/**
 * Round a patched value to something a human would type.
 *
 * A 10% rent rise on RM12,000 is 13200.000000000002 in binary floating point.
 * The currency formatter hides that, but the INPUT FIELD does not — the user
 * would watch the AI set their rent to RM13,200.000000000002. Round at the
 * point of assignment so the scenario itself stays clean.
 */
function tidy(field: PatchableField, value: number): number {
  if (INTEGER_FIELDS.has(field)) return Math.round(value);
  if (FRACTION_FIELDS.has(field)) return r4(value);
  return r2(value);
}

export type OperationsResult =
  | { ok: true; operations: Operation[] }
  | { ok: false; errors: string[] };

export function validateOperations(raw: unknown): OperationsResult {
  if (!Array.isArray(raw)) return { ok: false, errors: ["operations must be an array"] };
  if (raw.length === 0) return { ok: false, errors: ["operations must not be empty"] };
  if (raw.length > MAX_OPERATIONS) {
    return { ok: false, errors: [`too many operations (max ${MAX_OPERATIONS})`] };
  }

  const errors: string[] = [];
  const operations: Operation[] = [];

  raw.forEach((entry, index) => {
    if (entry === null || typeof entry !== "object") {
      errors.push(`operation ${index}: expected an object`);
      return;
    }
    const { field, op, value } = entry as Record<string, unknown>;

    if (typeof field !== "string" || !(PATCHABLE_FIELDS as readonly string[]).includes(field)) {
      errors.push(`operation ${index}: "${String(field)}" is not a patchable field`);
      return;
    }
    if (typeof op !== "string" || !PATCH_OPS.includes(op as PatchOp)) {
      errors.push(`operation ${index}: "${String(op)}" is not a valid operation`);
      return;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push(`operation ${index}: value must be a finite number`);
      return;
    }

    operations.push({ field: field as PatchableField, op: op as PatchOp, value });
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true, operations };
}

function resolve(current: number, op: PatchOp, value: number): number {
  switch (op) {
    case "set":
      return value;
    case "mul":
      return current * value;
    case "add":
      return current + value;
    case "pct_delta":
      return current * (1 + value / 100);
  }
}

/**
 * Apply one field change, preserving the SPEC §4.3 invariant.
 *
 * Cost per unit is pinned when price moves — charging RM20 for the same bowl
 * of jjigae does not make the ingredients more expensive. Without this, price
 * and volume collapse into mathematically identical levers and the whole
 * sensitivity ranking stops meaning anything.
 *
 * The UI calls this for slider edits and the AI path calls it for patches, so
 * the two can never drift.
 */
export function applyFieldValue(
  inputs: ScenarioInputs,
  field: PatchableField,
  rawValue: number,
): ScenarioInputs {
  const bounds = FIELD_BOUNDS[field];
  const value = tidy(field, Math.min(bounds.max, Math.max(bounds.min, rawValue)));

  const next: ScenarioInputs = { ...inputs, [field]: value };

  if (field === "avgPricePerTransaction") {
    // The per-unit cost is held at full precision — it feeds the maths, not an
    // input box, and rounding it would drift the golden vectors.
    const heldUnitCost = cogsPerUnitOf(inputs);
    next.cogsPerUnitOverride = heldUnitCost;
    // Same cost over a bigger denominator: the displayed percentage falls.
    if (value > 0) next.cogsPct = r4(Math.min(1, heldUnitCost / value));
  }

  if (field === "cogsPct") {
    // Editing the percentage re-derives the per-unit cost from it.
    next.cogsPerUnitOverride = value * next.avgPricePerTransaction;
  }

  return next;
}

export function applyPatch(inputs: ScenarioInputs, operations: Operation[]): ScenarioInputs {
  return operations.reduce((acc, { field, op, value }) => {
    const current = acc[field as PatchableField] as number;
    return applyFieldValue(acc, field as PatchableField, resolve(current, op, value));
  }, inputs);
}

/** Which fields a patch actually moved — drives the "AI changed this" markers. */
export function changedFields(before: ScenarioInputs, after: ScenarioInputs): string[] {
  return PATCHABLE_FIELDS.filter((f) => before[f] !== after[f]);
}
