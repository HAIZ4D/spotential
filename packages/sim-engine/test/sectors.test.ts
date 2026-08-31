import { describe, expect, it } from "vitest";
import {
  CATEGORY_PLACE_TYPES,
  CATEGORY_PRESETS,
  SECTORS,
  SECTOR_LABELS,
  categoryDefaults,
  listCategories,
  listCategoriesBySector,
  sectorOf,
  seedScenario,
  simulate,
  type BusinessCategory,
} from "../src/index.js";

/**
 * Sectors — retail and services alongside F&B.
 *
 * The preset file used to say one sector only, "so the cost structures are
 * genuinely comparable and the numbers are defensible". Opening it up does not
 * make that concern go away, so these tests are mostly about the two places
 * where the F&B-shaped machinery must NOT silently apply to a shop.
 */

const ALL = Object.keys(CATEGORY_PRESETS) as BusinessCategory[];

describe("every category is fully declared", () => {
  /**
   * Table-driven over the union, so a tenth category cannot be half-added:
   * TypeScript already forces a preset and a Places entry to exist, and this
   * forces them to be meaningful rather than placeholders.
   */
  it.each(ALL)("%s carries a complete, sourced preset", (id) => {
    const preset = CATEGORY_PRESETS[id];

    expect(preset.id).toBe(id);
    expect(preset.label.length).toBeGreaterThan(2);
    expect(SECTORS).toContain(preset.sector);

    // The house rule: a reference value carries a source and a review date.
    expect(preset.source.length).toBeGreaterThan(10);
    expect(preset.reviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Nothing may be zero that would make the economics nonsense.
    expect(preset.avgPricePerTransaction).toBeGreaterThan(0);
    expect(preset.customersPerDay).toBeGreaterThan(0);
    expect(preset.cogsPct).toBeGreaterThan(0);
    expect(preset.cogsPct).toBeLessThan(1);
    expect(preset.typicalUnitSqft).toBeGreaterThan(0);
  });

  it.each(ALL)("%s maps to real Places types", (id) => {
    const types = CATEGORY_PLACE_TYPES[id];
    expect(types.length).toBeGreaterThan(0);
    // Places API (New) Table A names are lower_snake_case; an unrecognised
    // one is rejected by the API rather than ignored.
    for (const type of types) expect(type).toMatch(/^[a-z][a-z_]+$/);
  });

  it("covers all three sectors, and every sector has categories", () => {
    for (const sector of SECTORS) {
      expect(listCategoriesBySector(sector).length).toBeGreaterThan(0);
      expect(SECTOR_LABELS[sector].length).toBeGreaterThan(2);
    }
    // Every category belongs to exactly one sector, and the split is total.
    const grouped = SECTORS.flatMap((s) => listCategoriesBySector(s));
    expect(grouped).toHaveLength(listCategories().length);
  });
});

/**
 * The tax guard, and the reason non-F&B could not simply reuse the F&B model.
 *
 * `dineInSharePct` drives service tax and STATUTORY.serviceTax is declared
 * `dineInOnly`. Malaysian sales tax on goods is levied at manufacture or
 * import, not at the retail till, so a shop must never be charged the F&B
 * service tax — however large its turnover gets.
 */
describe("service tax never reaches a non-F&B sector", () => {
  const nonFnb = ALL.filter((id) => CATEGORY_PRESETS[id].sector !== "fnb");

  it.each(nonFnb)("%s has a zero dine-in share", (id) => {
    expect(CATEGORY_PRESETS[id].dineInSharePct).toBe(0);
  });

  it.each(nonFnb)("%s pays no service tax even above the threshold", (id) => {
    // Forced well past the RM1.5m registration threshold and registered, so
    // the only thing that can zero the tax is the sector treatment itself.
    const inputs = {
      ...seedScenario(id, "klcc"),
      sstRegistered: true,
      customersPerDay: 400,
      avgPricePerTransaction: 500,
    };

    const result = simulate(inputs);
    const serviceTax = result.costBreakdown.find((line) => line.key === "serviceTax");

    expect(result.steady.revenue).toBeGreaterThan(1_500_000 / 12);
    expect(serviceTax?.amount ?? 0).toBe(0);
  });

  it("still charges it where it belongs", () => {
    /**
     * The control, and it needs the SAME turnover as the cases above.
     *
     * A Korean restaurant at its seeded defaults turns over about RM1.18m a
     * year, which is under the RM1.5m registration threshold — so zero tax
     * there is correct and proves nothing. Pushed over the threshold on
     * identical figures, the only remaining difference is the sector.
     */
    const inputs = {
      ...seedScenario("korean_restaurant", "klcc"),
      sstRegistered: true,
      customersPerDay: 400,
      avgPricePerTransaction: 500,
    };

    const result = simulate(inputs);
    const serviceTax = result.costBreakdown.find((line) => line.key === "serviceTax");

    expect(result.steady.revenue).toBeGreaterThan(1_500_000 / 12);
    expect(serviceTax?.amount ?? 0).toBeGreaterThan(0);
  });
});

/**
 * Capacity warnings are tuned to F&B seat turns. A shop has no seats, and the
 * validator already treats that as "a takeaway counter, not a mistake" — this
 * pins that the same reasoning covers a clothing rail.
 */
describe("plausibility warnings do not misfire on a shop", () => {
  const seatless = ALL.filter((id) => CATEGORY_PRESETS[id].seats === 0);

  it("has seatless categories to check", () => {
    expect(seatless.length).toBeGreaterThan(0);
  });

  it.each(seatless)("%s raises no seat-turn warning at its own defaults", (id) => {
    const result = simulate(seedScenario(id, "klcc"));
    const seatWarnings = result.warnings.filter((w) => w.code === "seat_turns_implausible");
    expect(seatWarnings).toEqual([]);
  });

  it.each(ALL)("%s produces a positive revenue at its own defaults", (id) => {
    // A preset that cannot make money at its own seeded figures is a typo,
    // not a business.
    expect(simulate(seedScenario(id, "klcc")).steady.revenue).toBeGreaterThan(0);
  });
});

describe("sectorOf", () => {
  it("agrees with the preset table", () => {
    for (const id of ALL) expect(sectorOf(id)).toBe(CATEGORY_PRESETS[id].sector);
  });

  it("keeps the original six in F&B", () => {
    for (const id of [
      "korean_restaurant",
      "cafe_coffee_shop",
      "casual_dining",
      "bubble_tea_dessert",
      "fast_casual_takeaway",
      "other_fnb",
    ] as BusinessCategory[]) {
      expect(sectorOf(id)).toBe("fnb");
    }
  });
});

describe("categoryDefaults", () => {
  it.each(ALL)("%s seeds a scenario the schema would accept", (id) => {
    const defaults = categoryDefaults(id);
    expect(defaults.businessCategory).toBe(id);
    expect(Number.isFinite(defaults.monthsToMaturity)).toBe(true);
    expect(defaults.dineInSharePct).toBeGreaterThanOrEqual(0);
    expect(defaults.dineInSharePct).toBeLessThanOrEqual(1);
  });
});
