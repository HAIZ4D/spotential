import { describe, expect, it } from "vitest";
import goldenFile from "./golden.json";
import { simulate } from "../src/simulate.js";
import type { ScenarioInputs, SimulationResult } from "../src/types.js";

/**
 * The golden vectors are the arithmetic contract. Every expected value in
 * golden.json was computed by hand from SPEC.md before the engine existed.
 *
 * RULE (SPEC §12): when one of these fails, verify the new number BY HAND
 * before touching golden.json. Updating vectors to match new output is exactly
 * how a financial engine silently becomes wrong.
 */

interface Vector {
  name: string;
  description: string;
  inputs: ScenarioInputs;
  expect: Record<string, number | string | boolean | null>;
}

const vectors = (goldenFile as unknown as { vectors: Vector[] }).vectors;

/** Walk a dotted path, with `length` supported on arrays. */
function at(root: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    if (Array.isArray(acc) && key === "length") return acc.length;
    return (acc as Record<string, unknown>)[key];
  }, root);
}

/** Every number the UI could render must be finite. Catches NaN and Infinity leaks. */
function findNonFinite(value: unknown, path = ""): string[] {
  if (typeof value === "number") {
    return Number.isFinite(value) ? [] : [`${path} = ${value}`];
  }
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => findNonFinite(v, `${path}[${i}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) =>
      findNonFinite(v, path ? `${path}.${k}` : k),
    );
  }
  return [];
}

describe("golden vectors", () => {
  it("the file actually contains vectors", () => {
    expect(vectors.length).toBeGreaterThan(0);
  });

  for (const vector of vectors) {
    describe(vector.name, () => {
      const result: SimulationResult = simulate(vector.inputs);

      it(vector.description, () => {
        const mismatches: string[] = [];

        for (const [path, expected] of Object.entries(vector.expect)) {
          const actual = at(result, path);
          if (actual !== expected) {
            mismatches.push(`  ${path}\n    expected: ${expected}\n    actual:   ${actual}`);
          }
        }

        if (mismatches.length > 0) {
          throw new Error(
            `${mismatches.length} value(s) disagree with the hand-computed vector.\n` +
              `Verify the new numbers BY HAND before editing golden.json.\n\n` +
              mismatches.join("\n"),
          );
        }
      });

      it("emits no NaN or Infinity", () => {
        expect(findNonFinite(result)).toEqual([]);
      });
    });
  }
});
