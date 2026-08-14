import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { applyPatch, changedFields, validateOperations, MAX_OPERATIONS } from "../src/patch.js";
import { cogsPerUnitOf } from "../src/basis.js";
import { seedScenario } from "../src/presets/index.js";
import { simulate } from "../src/simulate.js";

const inputs = seedScenario("korean_restaurant", "mont_kiara");

describe("patch validation", () => {
  it("accepts a well-formed single operation", () => {
    const result = validateOperations([{ field: "customersPerDay", op: "mul", value: 0.8 }]);
    expect(result.ok).toBe(true);
  });

  it("accepts a compound patch", () => {
    const result = validateOperations([
      { field: "monthlyRent", op: "pct_delta", value: 10 },
      { field: "avgPricePerTransaction", op: "pct_delta", value: 10 },
    ]);
    expect(result.ok && result.operations).toHaveLength(2);
  });

  it("rejects a field outside the allow-list", () => {
    // The prompt-injection defence: a jailbroken model still cannot reach a
    // field the engine was never meant to expose.
    const result = validateOperations([{ field: "engineVersion", op: "set", value: 9 }]);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors[0]).toContain("not a patchable field");
  });

  it("rejects unknown operations and non-finite values", () => {
    expect(validateOperations([{ field: "monthlyRent", op: "obliterate", value: 1 }]).ok).toBe(false);
    expect(validateOperations([{ field: "monthlyRent", op: "set", value: Number.NaN }]).ok).toBe(false);
    expect(validateOperations([{ field: "monthlyRent", op: "set", value: "1000" }]).ok).toBe(false);
  });

  it("rejects an empty patch and a runaway one", () => {
    expect(validateOperations([]).ok).toBe(false);
    const runaway = Array.from({ length: MAX_OPERATIONS + 1 }, () => ({
      field: "monthlyRent",
      op: "add",
      value: 1,
    }));
    expect(validateOperations(runaway).ok).toBe(false);
  });

  it("rejects non-arrays", () => {
    for (const junk of [null, undefined, {}, "operations", 42]) {
      expect(validateOperations(junk).ok).toBe(false);
    }
  });
});

describe("patch application", () => {
  it("applies a -20% demand patch the way the spec describes", () => {
    const next = applyPatch(inputs, [{ field: "customersPerDay", op: "mul", value: 0.8 }]);
    expect(next.customersPerDay).toBe(144);
    expect(changedFields(inputs, next)).toEqual(["customersPerDay"]);
  });

  it("treats pct_delta as a percentage", () => {
    const next = applyPatch(inputs, [{ field: "monthlyRent", op: "pct_delta", value: 10 }]);
    expect(next.monthlyRent).toBe(13200);
  });

  it("applies compound operations atomically", () => {
    const next = applyPatch(inputs, [
      { field: "monthlyRent", op: "pct_delta", value: 10 },
      { field: "avgPricePerTransaction", op: "pct_delta", value: 10 },
    ]);
    expect(next.monthlyRent).toBe(13200);
    expect(next.avgPricePerTransaction).toBeCloseTo(19.8, 10);
    expect(changedFields(inputs, next).sort()).toEqual([
      "avgPricePerTransaction",
      "cogsPct",
      "monthlyRent",
    ]);
  });

  it("HOLDS cost per unit when price moves (SPEC §4.3)", () => {
    const before = cogsPerUnitOf(inputs);
    const next = applyPatch(inputs, [
      { field: "avgPricePerTransaction", op: "pct_delta", value: 20 },
    ]);
    expect(cogsPerUnitOf(next)).toBeCloseTo(before, 10);
    // Same cost over a bigger denominator, so the percentage falls.
    expect(next.cogsPct).toBeLessThan(inputs.cogsPct);
  });

  it("re-derives cost per unit when the percentage is edited", () => {
    const next = applyPatch(inputs, [{ field: "cogsPct", op: "set", value: 0.4 }]);
    expect(cogsPerUnitOf(next)).toBeCloseTo(0.4 * inputs.avgPricePerTransaction, 10);
  });

  it("clamps to sane bounds rather than producing nonsense", () => {
    const negative = applyPatch(inputs, [{ field: "monthlyRent", op: "set", value: -50000 }]);
    expect(negative.monthlyRent).toBe(0);
    const absurd = applyPatch(inputs, [{ field: "cogsPct", op: "set", value: 5 }]);
    expect(absurd.cogsPct).toBe(1);
  });

  it("keeps integer fields whole", () => {
    const next = applyPatch(inputs, [{ field: "staffCount", op: "mul", value: 1.5 }]);
    expect(Number.isInteger(next.staffCount)).toBe(true);
    expect(next.staffCount).toBe(6);
  });

  it("never produces a scenario the engine chokes on", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            field: fc.constantFrom("avgPricePerTransaction", "customersPerDay", "cogsPct", "monthlyRent", "staffCount"),
            op: fc.constantFrom("set", "mul", "add", "pct_delta"),
            value: fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
          }),
          { minLength: 1, maxLength: MAX_OPERATIONS },
        ),
        (ops) => {
          const validated = validateOperations(ops);
          expect(validated.ok).toBe(true);
          if (!validated.ok) return;
          const result = simulate(applyPatch(inputs, validated.operations));
          expect(Number.isFinite(result.steady.profit)).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });
});
