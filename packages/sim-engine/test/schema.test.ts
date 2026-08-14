import { describe, expect, it } from "vitest";
import { parseScenarioInputs } from "../src/schema.js";
import { seedScenario } from "../src/presets/index.js";

/**
 * The schema guard is the boundary between the engine and anything untrusted:
 * a request body off the internet, a share URL from WhatsApp, an AI patch.
 */
describe("parseScenarioInputs", () => {
  const valid = seedScenario("korean_restaurant", "mont_kiara");

  it("accepts a freshly seeded scenario", () => {
    const parsed = parseScenarioInputs(valid);
    expect(parsed.ok).toBe(true);
  });

  it("round-trips through JSON unchanged", () => {
    const parsed = parseScenarioInputs(JSON.parse(JSON.stringify(valid)));
    expect(parsed.ok && parsed.value).toEqual(valid);
  });

  it("rejects unknown fields rather than ignoring them", () => {
    const parsed = parseScenarioInputs({ ...valid, __proto__polluted: 1, secretFlag: true });
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.errors.some((e) => e.includes("secretFlag"))).toBe(true);
  });

  it("rejects out-of-range values", () => {
    const parsed = parseScenarioInputs({ ...valid, cogsPct: 4 });
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.errors[0]).toContain("cogsPct");
  });

  it("rejects NaN and Infinity", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const parsed = parseScenarioInputs({ ...valid, monthlyRent: bad });
      expect(parsed.ok).toBe(false);
    }
  });

  it("rejects an unknown business category", () => {
    const parsed = parseScenarioInputs({ ...valid, businessCategory: "nuclear_reactor" });
    expect(parsed.ok).toBe(false);
  });

  it("rejects non-objects", () => {
    for (const bad of [null, undefined, 42, "scenario", []]) {
      expect(parseScenarioInputs(bad).ok).toBe(false);
    }
  });

  it("accepts optional overrides but still bounds them", () => {
    expect(parseScenarioInputs({ ...valid, tradingDaysPerMonthOverride: 30 }).ok).toBe(true);
    expect(parseScenarioInputs({ ...valid, tradingDaysPerMonthOverride: 400 }).ok).toBe(false);
  });

  it("reports every problem at once, not just the first", () => {
    const parsed = parseScenarioInputs({ ...valid, cogsPct: 9, monthlyRent: -5, seats: "many" });
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.errors.length).toBeGreaterThanOrEqual(3);
  });
});
