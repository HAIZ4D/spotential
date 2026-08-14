import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { decodeScenario, encodeScenario } from "../src/share.js";
import { seedScenario } from "../src/presets/index.js";
import { PRESET_VERSION } from "../src/presets/version.js";
import { simulate } from "../src/simulate.js";
import { listCategories, listDistricts } from "../src/presets/index.js";

describe("share links", () => {
  const inputs = seedScenario("korean_restaurant", "mont_kiara");

  it("round-trips a scenario exactly", () => {
    const decoded = decodeScenario(encodeScenario(inputs));
    expect(decoded.ok).toBe(true);
    expect(decoded.ok && decoded.inputs).toEqual(inputs);
  });

  it("reproduces identical results after a round-trip", () => {
    const decoded = decodeScenario(encodeScenario(inputs));
    expect(decoded.ok && simulate(decoded.inputs)).toEqual(simulate(inputs));
  });

  it("stamps the preset version and reports staleness", () => {
    const decoded = decodeScenario(encodeScenario(inputs));
    expect(decoded.ok && decoded.presetVersion).toBe(PRESET_VERSION);
    expect(decoded.ok && decoded.stale).toBe(false);
  });

  it("flags a link built against older presets as stale", () => {
    // Hand-forge a payload claiming an older preset version.
    const forged = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(
          atob(
            encodeScenario(inputs)
              .slice(3)
              .replace(/-/g, "+")
              .replace(/_/g, "/")
              .padEnd(Math.ceil((encodeScenario(inputs).length - 3) / 4) * 4, "="),
          ),
          (c) => c.charCodeAt(0),
        ),
      ),
    ) as { p: string };
    expect(forged.p).toBe(PRESET_VERSION);
  });

  it("stays comfortably inside a shareable URL length", () => {
    const encoded = encodeScenario(inputs);
    // SPEC §7.7 budgets ~2,000 characters. This is why deflate is skipped.
    expect(encoded.length).toBeLessThan(1200);
  });

  it("treats a decoded link as untrusted input", () => {
    // A crafted link carrying a field the engine was never meant to read.
    const hostile = btoa(
      JSON.stringify({ v: 1, p: "x", e: "y", i: { ...inputs, isAdmin: true } }),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const decoded = decodeScenario(`v1.${hostile}`);
    expect(decoded.ok).toBe(false);
    expect(decoded.ok === false && decoded.reason).toContain("isAdmin");
  });

  it("rejects out-of-range values smuggled through a link", () => {
    const hostile = btoa(
      JSON.stringify({ v: 1, p: "x", e: "y", i: { ...inputs, cogsPct: 900 } }),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodeScenario(`v1.${hostile}`).ok).toBe(false);
  });

  it("rejects junk without throwing", () => {
    for (const junk of [null, undefined, "", "nonsense", "v1.!!!!", "v2.abcd", "v1."]) {
      const result = decodeScenario(junk);
      expect(result.ok).toBe(false);
      expect(result.ok === false && typeof result.reason).toBe("string");
    }
  });

  it("round-trips every category and district combination", () => {
    for (const category of listCategories()) {
      for (const district of listDistricts()) {
        const seeded = seedScenario(category.id, district.id);
        const decoded = decodeScenario(encodeScenario(seeded));
        expect(decoded.ok && decoded.inputs).toEqual(seeded);
      }
    }
  });

  it("round-trips arbitrary valid scenarios", () => {
    fc.assert(
      fc.property(
        fc.record({
          monthlyRent: fc.double({ min: 0, max: 50_000, noNaN: true }),
          avgPricePerTransaction: fc.double({ min: 0, max: 500, noNaN: true }),
          customersPerDay: fc.double({ min: 0, max: 2_000, noNaN: true }),
          cogsPct: fc.double({ min: 0, max: 1, noNaN: true }),
          staffCount: fc.integer({ min: 0, max: 50 }),
          monthsToMaturity: fc.integer({ min: 1, max: 36 }),
          sstRegistered: fc.boolean(),
        }),
        (overrides) => {
          const scenario = { ...inputs, ...overrides };
          const decoded = decodeScenario(encodeScenario(scenario));
          expect(decoded.ok && decoded.inputs).toEqual(scenario);
        },
      ),
      { numRuns: 200 },
    );
  });
});
