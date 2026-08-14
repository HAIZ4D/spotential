import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { seedScenario, type CompetitorSummary } from "@spotential/sim-engine";
import {
  buildComparisonReport,
  buildLocationReport,
  buildScenarioReport,
  renderReport,
  type LocationReportInput,
} from "../src/report/index.js";
import { ascii } from "../src/report/template.js";

/**
 * PDF rendering — Feature 4.
 *
 * The FIGURES are pinned in report-model.test.ts, which needs no renderer.
 * These tests cover the other half: that react-pdf actually produces a valid
 * document for every shape of report, including the awkward ones — a missing
 * map, a missing dimension, a scenario that never breaks even.
 *
 * Set OUT to a directory to also write the PDFs out for eyeballing:
 *   OUT=/tmp npx vitest run services/simulator/test/report-render.test.ts
 */

const OUT = process.env["OUT"];

async function render(name: string, model: Parameters<typeof renderReport>[0]) {
  const buffer = await renderReport(model);
  if (OUT) writeFileSync(`${OUT}/report-${name}.pdf`, buffer);
  return buffer;
}

const expectPdf = (buffer: Buffer) => {
  expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  // A report with a cover, tables and a disclosures page is never tiny. Cheap
  // guard against rendering an empty document that is technically valid.
  expect(buffer.length).toBeGreaterThan(5_000);
};

const summary = (over: Partial<CompetitorSummary> = {}): CompetitorSummary => ({
  total: 20,
  averageRating: 4.23,
  ratedCount: 20,
  totalReviews: 2060,
  nearestMetres: 60,
  operational: 20,
  ...over,
});

const KL: LocationReportInput = {
  point: { lat: 3.1478, lng: 101.6953 },
  label: "Central KL",
  category: "korean_restaurant",
  radiusMetres: 500,
  competitors: summary(),
  truncated: true,
  completeToMetres: 142,
  density: [
    { upToMetres: 250, count: 20 },
    { upToMetres: 500, count: 0 },
    { upToMetres: 1000, count: 0 },
  ],
  demographics: {
    district: "W.P. Kuala Lumpur",
    state: "W.P. Kuala Lumpur",
    total: 2_074_100,
    age: {
      "15-19": 142_900, "20-24": 142_400, "25-29": 146_400, "30-34": 205_000,
      "35-39": 238_900, "40-44": 243_200, "45-49": 177_900, "50-54": 128_400,
      "55-59": 79_800, "60-64": 72_500,
    },
  },
  rentOverride: null,
};

const PJ: LocationReportInput = {
  ...KL,
  point: { lat: 3.0738, lng: 101.5183 },
  label: "Suburban PJ",
  competitors: summary({ averageRating: 4.08, totalReviews: 1740 }),
  completeToMetres: 263,
  demographics: { district: "Petaling", state: "Selangor", total: 2_370_600, age: KL.demographics!.age },
};

const scenario = seedScenario("korean_restaurant", "mont_kiara");

describe("every report kind renders", () => {
  it("scenario", async () => {
    expectPdf(await render("scenario", buildScenarioReport(scenario)));
  }, 60_000);

  it("location", async () => {
    expectPdf(await render("location", buildLocationReport(KL)));
  }, 60_000);

  it("comparison of two", async () => {
    expectPdf(await render("comparison", buildComparisonReport("korean_restaurant", 500, [KL, PJ])));
  }, 60_000);

  it("comparison of three", async () => {
    const third: LocationReportInput = { ...KL, point: { lat: 3.1578, lng: 101.7123 }, label: "KLCC" };
    expectPdf(
      await render("comparison3", buildComparisonReport("korean_restaurant", 500, [KL, PJ, third])),
    );
  }, 60_000);
});

/**
 * The built-in Helvetica silently DROPS glyphs it lacks rather than
 * substituting a visible box, so a typographic dash does not look wrong — it
 * disappears. "Working age (15–64)" rendered as "(1564)", a number that reads
 * as real and is not. Folding to ASCII is the fix; these pin it.
 */
describe("typographic characters fold to ASCII rather than vanishing", () => {
  it("keeps an en-dashed range readable", () => {
    expect(ascii("Working age (15–64)")).toBe("Working age (15-64)");
  });

  it("keeps an em dash as a visible separator", () => {
    expect(ascii("20+ competitors — extremely dense.")).toBe(
      "20+ competitors - extremely dense.",
    );
  });

  it("handles the other characters the engine emits", () => {
    expect(ascii("~316 per km²")).toBe("~316 per km2");
    expect(ascii("2× rent")).toBe("2x rent");
    expect(ascii("≤ 20 outlets")).toBe("<= 20 outlets");
    expect(ascii("Spotential · report")).toBe("Spotential - report");
    expect(ascii("the owner’s “budget”")).toBe(`the owner's "budget"`);
  });

  it("leaves plain ASCII untouched", () => {
    const plain = "RM 38,418 profit at 180 customers/day";
    expect(ascii(plain)).toBe(plain);
  });
});

describe("the awkward shapes still render", () => {
  it("with a static map embedded", async () => {
    // A 1x1 PNG stands in for the real thing; what matters is that an <Image>
    // with a data URI does not break the layout.
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    expectPdf(await renderReport(buildLocationReport(KL, { dataUri: png, note: "Map: Google" })));
  }, 60_000);

  it("with the map unavailable, carrying a note instead of a broken image", async () => {
    const model = buildLocationReport(KL, { dataUri: null, note: "Map unavailable for this report." });
    expect(model.mapDataUri).toBeNull();
    expectPdf(await renderReport(model));
  }, 60_000);

  it("with no demographics and no rent benchmark", async () => {
    // Kuantan: two of five dimensions missing, so the radar has two dents.
    expectPdf(
      await renderReport(
        buildLocationReport({
          ...KL,
          point: { lat: 3.8077, lng: 103.326 },
          label: "Kuantan",
          demographics: null,
        }),
      ),
    );
  }, 60_000);

  it("with a scenario that never breaks even", async () => {
    expectPdf(await renderReport(buildScenarioReport({ ...scenario, monthlyRent: 400_000 })));
  }, 60_000);

  it("with a very long location label", async () => {
    // Labels come from a geocoder or from a URL, so they can be long. The
    // model truncates; this checks the truncated string still lays out.
    const long = "Lot 1-2, ".repeat(40);
    expectPdf(await renderReport(buildLocationReport({ ...KL, label: long })));
  }, 60_000);
});

/**
 * Page structure.
 *
 * The report grew from three pages to six, and the point of the extra pages is
 * that they carry analysis rather than padding — so the test is that they
 * appear when their data does and VANISH when it does not. A page of dashes is
 * worse than no page.
 */
describe("the document adapts to what is known", () => {
  const rivals = Array.from({ length: 8 }, (_, i) => ({
    id: `r${i}`,
    name: `Rival ${i}`,
    rating: 4.1,
    reviewCount: 40 + i,
    lat: 3.147,
    lng: 101.695,
    distanceMetres: 25 * (i + 1),
    businessStatus: "OPERATIONAL",
    priceLevel: null,
    primaryType: null,
  }));

  /** A crude page count: react-pdf writes one /Type /Page per page. */
  const pages = (buffer: Buffer) =>
    (buffer.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

  it("renders the full six pages when everything is known", async () => {
    const buffer = await render(
      "location-full",
      buildLocationReport({ ...KL, rivals, catchment: 6_457 }),
    );
    expectPdf(buffer);
    expect(pages(buffer)).toBeGreaterThanOrEqual(5);
  }, 60_000);

  it("renders a shorter document when little is known, not empty pages", async () => {
    const sparse = await render(
      "location-sparse",
      buildLocationReport({
        ...KL,
        point: { lat: 3.8077, lng: 103.326 },
        label: "Kuantan",
        demographics: null,
        rentOverride: null,
        catchment: null,
        rivals: [],
      }),
    );

    expectPdf(sparse);
    const full = await renderReport(
      buildLocationReport({ ...KL, rivals, catchment: 6_457 }),
    );
    expect(pages(sparse)).toBeLessThan(pages(full));
  }, 90_000);

  it("still renders when the competitor list is the only extra", async () => {
    expectPdf(await render("location-rivals", buildLocationReport({ ...KL, rivals })));
  }, 60_000);
});
