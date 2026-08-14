import { describe, expect, it } from "vitest";
import { csvFilename, projectionToCsv } from "../src/csv.js";
import { seedScenario } from "../src/presets/index.js";
import { simulate } from "../src/simulate.js";
import { HORIZON_MONTHS } from "../src/basis.js";

describe("CSV export", () => {
  const inputs = seedScenario("korean_restaurant", "mont_kiara");
  const result = simulate(inputs);
  const csv = projectionToCsv(inputs, result);
  const lines = csv.split("\r\n");

  it("uses CRLF so Excel on Windows opens it cleanly", () => {
    expect(csv).toContain("\r\n");
    expect(csv.split("\n").every((l) => l === "" || l.endsWith("\r") || !l.includes("\r"))).toBe(
      true,
    );
  });

  it("exports raw numbers, never formatted currency", () => {
    // "RM 97,200" would land in Excel as text and break every formula.
    expect(csv).not.toMatch(/RM\s[\d,]/);
    expect(csv).toContain("Monthly revenue (RM)");
  });

  it("includes every projected month plus the opening row", () => {
    const header = lines.findIndex((l) => l.startsWith("Month,Ramp,"));
    expect(header).toBeGreaterThan(0);
    const dataRows = lines.slice(header + 1).filter((l) => /^\d+,/.test(l));
    expect(dataRows).toHaveLength(HORIZON_MONTHS + 1);
  });

  it("carries the headline figures", () => {
    expect(csv).toContain(`Monthly profit (RM),${result.steady.profit}`);
    expect(csv).toContain(`Investment payback (month),${result.breakEven.paybackMonth}`);
    expect(csv).toContain(`Peak cash requirement (RM),${result.cash.peakCashRequirement}`);
  });

  it("stamps the versions so a stale export is identifiable", () => {
    expect(csv).toContain(`Engine version,${result.engineVersion}`);
    expect(csv).toContain(`Preset version,${result.presetVersion}`);
  });

  it("leaves unreachable figures blank rather than writing null", () => {
    const broke = simulate({ ...inputs, avgPricePerTransaction: 1, customersPerDay: 5 });
    const brokeCsv = projectionToCsv(inputs, broke);
    expect(broke.breakEven.paybackMonth).toBeNull();
    expect(brokeCsv).toContain("Investment payback (month),\r\n");
    expect(brokeCsv).not.toContain("null");
  });

  it("escapes any cell containing a comma or quote", () => {
    // The assumptions block contains commas; they must be quoted.
    const assumption = lines.find((l) => l.includes("Ramadan"));
    expect(assumption?.startsWith('"')).toBe(true);
  });

  it("names the file by category and date", () => {
    expect(csvFilename(inputs)).toMatch(/^spotential-korean_restaurant-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
