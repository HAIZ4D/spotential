import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { simulate } from "../src/simulate.js";
import { HORIZON_MONTHS } from "../src/basis.js";
import type { ScenarioInputs } from "../src/types.js";

/**
 * Invariants that must hold for EVERY scenario, not just the ones we thought
 * to write down. Golden vectors catch a formula changing; these catch a
 * formula being wrong in a way nobody anticipated.
 */

const money = (max: number) => fc.double({ min: 0, max, noNaN: true, noDefaultInfinity: true });

const scenario = (overrides: Partial<ScenarioInputs> = {}): fc.Arbitrary<ScenarioInputs> =>
  fc
    .record({
      initialInvestment: money(500_000),
      monthlyRent: money(50_000),
      securityDepositMonths: fc.integer({ min: 0, max: 12 }),
      avgPricePerTransaction: money(200),
      customersPerDay: money(600),
      seats: fc.integer({ min: 0, max: 200 }),
      openHoursPerDay: fc.integer({ min: 1, max: 24 }),
      daysOpenPerWeek: fc.integer({ min: 1, max: 7 }),
      cogsPct: fc.double({ min: 0, max: 0.95, noNaN: true, noDefaultInfinity: true }),
      staffCount: fc.integer({ min: 0, max: 40 }),
      avgMonthlyWage: money(12_000),
      utilities: money(20_000),
      licensingFees: money(5_000),
      marketing: money(20_000),
      miscMonthly: money(20_000),
      monthsToMaturity: fc.integer({ min: 1, max: 24 }),
      serviceChargePct: fc.constantFrom(0, 0.1),
      sstRegistered: fc.boolean(),
      dineInSharePct: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
    })
    .map((r) => ({
      businessCategory: "other_fnb" as const,
      district: "mont_kiara" as const,
      ...r,
      ...overrides,
    }));

function collectNumbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === "number") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectNumbers(v, out));
  else if (value && typeof value === "object") {
    Object.values(value).forEach((v) => collectNumbers(v, out));
  }
  return out;
}

describe("engine invariants", () => {
  it("never emits NaN or Infinity, for any scenario", () => {
    fc.assert(
      fc.property(scenario(), (inputs) => {
        const numbers = collectNumbers(simulate(inputs));
        expect(numbers.every(Number.isFinite)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it("profit always equals revenue minus total expenses", () => {
    fc.assert(
      fc.property(scenario(), (inputs) => {
        const { steady } = simulate(inputs);
        // Both sides are independently rounded to 2dp, so allow one cent.
        expect(Math.abs(steady.revenue - steady.totalExpenses - steady.profit)).toBeLessThanOrEqual(
          0.01,
        );
      }),
      { numRuns: 300 },
    );
  });

  it("the cost breakdown sums to total expenses, to the cent", () => {
    fc.assert(
      fc.property(scenario(), (inputs) => {
        const { steady, costBreakdown } = simulate(inputs);
        const sum = costBreakdown.reduce((acc, line) => acc + line.amount, 0);
        // Exact by construction: totalExpenses is assembled from these same
        // rounded lines. Only float addition noise is tolerated.
        expect(Math.abs(sum - steady.totalExpenses)).toBeLessThanOrEqual(0.01);
      }),
      { numRuns: 300 },
    );
  });

  /**
   * Regression guard. A contribution per transaction near zero used to make
   * fixed/contribution overflow, and Math.ceil(Infinity) is Infinity — the UI
   * would have rendered "Infinity transactions/day". Unreachable must be null.
   */
  it("break-even figures are always a usable number or null, never Infinity", () => {
    fc.assert(
      fc.property(scenario(), (inputs) => {
        const { breakEven, recovery } = simulate(inputs);

        const usable = (v: number | null) => v === null || Number.isSafeInteger(v);
        expect(usable(breakEven.operatingTransactionsPerDay)).toBe(true);
        expect(usable(breakEven.paybackMonth)).toBe(true);
        expect(usable(breakEven.cashBreakEvenMonth)).toBe(true);

        if (recovery) {
          for (const v of [
            recovery.customersPerDay,
            recovery.avgPricePerTransaction,
            recovery.monthlyRent,
            recovery.cogsPct,
          ]) {
            expect(v === null || Number.isFinite(v)).toBe(true);
          }
        }
      }),
      { numRuns: 400 },
    );
  });

  it("a tiny price against real fixed costs reports unreachable, not Infinity", () => {
    const result = simulate({
      businessCategory: "other_fnb",
      district: "mont_kiara",
      initialInvestment: 0,
      monthlyRent: 0,
      securityDepositMonths: 0,
      avgPricePerTransaction: 5e-324,
      customersPerDay: 1,
      seats: 0,
      openHoursPerDay: 1,
      daysOpenPerWeek: 1,
      cogsPct: 0,
      staffCount: 0,
      avgMonthlyWage: 0,
      utilities: 0,
      licensingFees: 0,
      marketing: 1000,
      miscMonthly: 0,
      monthsToMaturity: 1,
      serviceChargePct: 0,
      sstRegistered: false,
      dineInSharePct: 0,
    });

    expect(result.breakEven.operatingTransactionsPerDay).toBeNull();
    expect(result.breakEven.neverBreaksEven).toBe(true);
  });

  it("cash always equals cumulative profit minus the month-0 outlay", () => {
    fc.assert(
      fc.property(scenario(), (inputs) => {
        const { projection, cash } = simulate(inputs);
        for (const month of projection) {
          expect(
            Math.abs(month.cash - (month.cumulativeProfit - cash.outlayAtMonth0)),
          ).toBeLessThanOrEqual(0.01);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("service charge never changes profit", () => {
    fc.assert(
      fc.property(scenario({ serviceChargePct: 0 }), (inputs) => {
        const without = simulate(inputs).steady.profit;
        const with10 = simulate({ ...inputs, serviceChargePct: 0.1 }).steady.profit;
        expect(with10).toBe(without);
      }),
      { numRuns: 200 },
    );
  });

  it("more transactions never lowers revenue", () => {
    fc.assert(
      fc.property(scenario(), fc.double({ min: 0, max: 200, noNaN: true }), (inputs, extra) => {
        const base = simulate(inputs).steady.revenue;
        const more = simulate({
          ...inputs,
          customersPerDay: inputs.customersPerDay + extra,
        }).steady.revenue;
        expect(more).toBeGreaterThanOrEqual(base);
      }),
      { numRuns: 200 },
    );
  });

  it("payback never gets sooner as the investment grows", () => {
    fc.assert(
      fc.property(scenario(), fc.double({ min: 0, max: 200_000, noNaN: true }), (inputs, extra) => {
        const cheap = simulate(inputs).breakEven.paybackMonth;
        const dear = simulate({
          ...inputs,
          initialInvestment: inputs.initialInvestment + extra,
        }).breakEven.paybackMonth;

        // null means "not within the horizon", which is the worst outcome.
        const asMonths = (m: number | null) => m ?? HORIZON_MONTHS + 1;
        expect(asMonths(dear)).toBeGreaterThanOrEqual(asMonths(cheap));
      }),
      { numRuns: 200 },
    );
  });

  it("a scenario that never breaks even always carries a recovery block", () => {
    fc.assert(
      fc.property(scenario(), (inputs) => {
        const result = simulate(inputs);
        if (result.breakEven.neverBreaksEven) {
          expect(result.recovery).not.toBeNull();
          expect(result.breakEven.paybackMonth).toBeNull();
        } else {
          expect(result.recovery).toBeNull();
          expect(result.breakEven.paybackMonth).not.toBeNull();
        }
      }),
      { numRuns: 300 },
    );
  });

  it("the projection always covers months 0 through 24", () => {
    fc.assert(
      fc.property(scenario(), (inputs) => {
        const { projection } = simulate(inputs);
        expect(projection).toHaveLength(HORIZON_MONTHS + 1);
        expect(projection[0]?.month).toBe(0);
        expect(projection[HORIZON_MONTHS]?.month).toBe(HORIZON_MONTHS);
      }),
      { numRuns: 50 },
    );
  });
});
