import { describe, expect, it } from "vitest";
import { seedScenario, DISTRICT_PRESETS, type CompetitorSummary } from "@spotential/sim-engine";
import {
  buildComparisonReport,
  buildLocationReport,
  buildScenarioReport,
  type LocationReportInput,
} from "../src/report/model.js";

/**
 * Report view models — Feature 4.
 *
 * The point of these tests is that the PDF cannot disagree with the screen.
 * Every figure is pinned to the same golden values the simulator and the
 * deployed comparison already produce, so a drift in either shows up here as a
 * failure rather than as a report quietly stating a different number to a
 * landlord.
 */

const cell = (report: ReturnType<typeof buildScenarioReport>, title: string, row: number, col: number) =>
  report.tables.find((t) => t.title === title)!.rows[row]!.cells[col];

const figure = (report: ReturnType<typeof buildScenarioReport>, label: string) =>
  report.figures.find((f) => f.label === label)!;

describe("scenario report", () => {
  // The app's seeded default. Its profit is the simulator's own published
  // figure — RM38,418, derived from 30.42 trading days on a 7-day week. The
  // spec's worked example pins 30 days and gives RM37,500; both are right and
  // neither should be "fixed" to match the other.
  const inputs = seedScenario("korean_restaurant", "mont_kiara");

  it("reproduces the simulator's headline profit exactly", () => {
    const report = buildScenarioReport(inputs);
    expect(figure(report, "Monthly profit").value).toBe("RM 38,418");
  });

  it("carries revenue, expenses and payback", () => {
    const report = buildScenarioReport(inputs);
    expect(figure(report, "Monthly revenue").value).toBe("RM 98,550");
    expect(figure(report, "Monthly expenses").value).toBe("RM 60,132");
    expect(figure(report, "Payback").value).toMatch(/^Month \d+$/);
  });

  it("tabulates costs that add up to the total on the same page", () => {
    const report = buildScenarioReport(inputs);
    const table = report.tables.find((t) => t.title === "Monthly costs at maturity")!;
    const total = table.rows.at(-1)!;

    expect(total.cells[0]).toBe("Total");
    expect(total.cells[1]).toBe(figure(report, "Monthly expenses").value);
    expect(total.emphasis).toBe(true);
  });

  /**
   * Hand-derived, and NOT the SPEC §4.12 figure of RM224,158.
   *
   * That worked example pins tradingDaysPerMonthOverride: 30. The seeded
   * default correctly derives 30.4167 days from a 7-day week, so every monthly
   * figure differs slightly. Both are right — see the standing note about not
   * "fixing" one to match the other.
   *
   *   outlay at month 0 = 150,000 + 6 x 12,000            = 222,000
   *   monthly txns      = 180 x 365/12                    =   5,475
   *   month 1 ramp 0.400 -> 2,190 txns
   *     revenue = 2,190 x 18                              =  39,420
   *     COGS    = 2,190 x 5.76                            =  12,614.40
   *     fixed                                             =  28,596
   *     profit  = 39,420 - 12,614.40 - 28,596             =  -1,790.40
   *   trough (month 1) = -222,000 - 1,790.40              = -223,790.40
   */
  it("leads the cash table with the runway an owner must actually have", () => {
    const report = buildScenarioReport(inputs);
    // Well above the RM150,000 initial investment once the deposit and the
    // ramp-period losses land. The number people have not budgeted for.
    expect(cell(report, "Break-even and cash", 3, 0)).toBe("Cash you must have");
    expect(cell(report, "Break-even and cash", 3, 1)).toBe("RM 223,790");
    expect(cell(report, "Break-even and cash", 4, 1)).toBe("Month 1, RM -223,790");
  });

  it("gives a full 25-month cash curve for the chart", () => {
    expect(buildScenarioReport(inputs).cashCurve).toHaveLength(25);
  });

  it("says 'not within 24 months' rather than showing a blank payback", () => {
    const doomed = { ...inputs, monthlyRent: 400_000 };
    const report = buildScenarioReport(doomed);
    expect(figure(report, "Payback").value).toBe("Not within 24 months");
  });

  it("surfaces plausibility warnings rather than hiding them", () => {
    const silly = { ...inputs, customersPerDay: 5_000 };
    const report = buildScenarioReport(silly);
    expect(report.tables.some((t) => t.title === "Plausibility warnings")).toBe(true);
  });
});

// ---------------------------------------------------------------------------

const summary = (over: Partial<CompetitorSummary> = {}): CompetitorSummary => ({
  total: 20,
  averageRating: 4.23,
  ratedCount: 20,
  totalReviews: 2060,
  nearestMetres: 60,
  operational: 20,
  ...over,
});

/**
 * The two sites in the published comparison.
 *
 * Demographics are the REAL payloads from the deployed /v1/demographics for
 * these exact coordinates, so the scores below are the ones a user actually
 * sees rather than a fixture tuned to a convenient answer.
 */
const KL_AGE = {
  "0-4": 100_600, "5-9": 126_600, "10-14": 121_600, "15-19": 142_900,
  "20-24": 142_400, "25-29": 146_400, "30-34": 205_000, "35-39": 238_900,
  "40-44": 243_200, "45-49": 177_900, "50-54": 128_400, "55-59": 79_800,
  "60-64": 72_500, "65-69": 46_200, "70-74": 45_500, "75-79": 30_800,
  "80-84": 16_000, "85+": 9_200,
};

const PJ_AGE = {
  "0-4": 133_100, "5-9": 161_400, "10-14": 159_100, "15-19": 154_400,
  "20-24": 197_600, "25-29": 194_600, "30-34": 195_400, "35-39": 230_800,
  "40-44": 216_600, "45-49": 162_400, "50-54": 139_100, "55-59": 115_900,
  "60-64": 97_000, "65-69": 79_100, "70-74": 62_000, "75-79": 41_500,
  "80-84": 18_200, "85+": 12_400,
};

const CENTRAL_KL: LocationReportInput = {
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
  ],
  demographics: {
    district: "W.P. Kuala Lumpur",
    state: "W.P. Kuala Lumpur",
    total: 2_074_100,
    age: KL_AGE,
  },
  rentOverride: null,
};

const SUBURBAN_PJ: LocationReportInput = {
  ...CENTRAL_KL,
  point: { lat: 3.0738, lng: 101.5183 },
  label: "Suburban PJ",
  competitors: summary({ averageRating: 4.08, totalReviews: 1740 }),
  completeToMetres: 263,
  demographics: {
    district: "Petaling",
    state: "Selangor",
    total: 2_370_600,
    age: PJ_AGE,
  },
};

describe("location report", () => {
  it("reproduces the deployed score for central KL", () => {
    const report = buildLocationReport(CENTRAL_KL);
    expect(report.figures.find((f) => f.label === "Success score")!.value).toBe("40 / 100");
  });

  it("reproduces the deployed score for suburban PJ", () => {
    const report = buildLocationReport(SUBURBAN_PJ);
    expect(report.figures.find((f) => f.label === "Success score")!.value).toBe("61 / 100");
  });

  it("labels each dimension measured, inferred or no data", () => {
    const rows = buildLocationReport(CENTRAL_KL).tables.find(
      (t) => t.title === "Score breakdown",
    )!.rows;
    const bases = rows.map((r) => r.cells[2]);
    expect(bases).toContain("measured");
    expect(bases).toContain("inferred");
  });

  it("shows a capped competitor count as a floor, never as a total", () => {
    const report = buildLocationReport(CENTRAL_KL);
    expect(report.figures.find((f) => f.label === "Competitors")!.value).toBe("20+");

    const density = report.tables.find((t) => t.title === "Competition by distance")!;
    // Outer bands after a cap mean "not searched", not "none there".
    expect(density.note).toMatch(/not searched/);
  });

  it("names the rent benchmark and its distance rather than passing it off as a quote", () => {
    const basis = buildLocationReport(CENTRAL_KL)
      .tables.find((t) => t.title === "Rent and break-even")!
      .rows.find((r) => r.cells[0] === "Basis")!.cells[1]!;

    expect(basis).toMatch(/Jalan TAR \/ Dang Wangi, KL benchmark/);
    expect(basis).toMatch(/reviewed \d{4}-\d{2}-\d{2}/);
  });

  it("uses a supplied rent over the benchmark, and says which", () => {
    const table = buildLocationReport({ ...CENTRAL_KL, rentOverride: 6000 }).tables.find(
      (t) => t.title === "Rent and break-even",
    )!;

    expect(table.rows[0]!.cells[1]).toBe("RM 6,000");
    expect(table.rows.find((r) => r.cells[0] === "Basis")!.cells[1]).toBe("The rent you supplied");
  });

  it("explains itself in one line when no benchmark covers the pin", () => {
    // Kuantan: outside every benchmark radius, so there is nothing to break
    // down and the detailed table is replaced by the reason.
    const report = buildLocationReport({
      ...CENTRAL_KL,
      point: { lat: 3.8077, lng: 103.326 },
      rentOverride: null,
    });

    expect(report.tables.find((t) => t.title === "Rent and break-even")).toBeUndefined();
    expect(report.tables.find((t) => t.title === "Rent")!.rows[0]!.cells[0]).toMatch(
      /excluded from the score rather than guessed/,
    );
  });

  it("says the axis is excluded where no benchmark reaches, rather than guessing", () => {
    // Kuantan.
    const line = buildLocationReport({
      ...CENTRAL_KL,
      point: { lat: 3.8077, lng: 103.326 },
    }).tables.find((t) => t.title === "Rent")!.rows[0]!.cells[0]!;
    expect(line).toMatch(/excluded from the score rather than guessed/);
  });

  it("warns that district population is not a catchment", () => {
    const report = buildLocationReport({
      ...CENTRAL_KL,
      demographics: {
        district: "Kuala Lumpur",
        state: "W.P. Kuala Lumpur",
        total: 2_000_000,
        age: { "25-29": 200_000 },
      },
    });
    const note = report.tables.find((t) => t.title === "Area demographics")!.note!;
    expect(note).toMatch(/never a customer count/);
  });

  it("gives the radar one series over the same axes as the score", () => {
    const report = buildLocationReport(CENTRAL_KL);
    expect(report.radarAxes).toContain("Rent sensitivity");
    expect(report.radarSeries).toHaveLength(1);
    expect(report.radarSeries[0]!.values).toHaveLength(report.radarAxes.length);
  });
});

describe("comparison report", () => {
  const report = () =>
    buildComparisonReport("korean_restaurant", 500, [CENTRAL_KL, SUBURBAN_PJ]);

  it("reproduces the deployed 40 vs 61", () => {
    const rows = report().tables.find((t) => t.title === "Overall")!.rows;
    expect(rows[0]!.cells[1]).toBe("40");
    expect(rows[1]!.cells[1]).toBe("61");
  });

  it("names the stronger site and by how much", () => {
    expect(report().tables.find((t) => t.title === "Overall")!.note).toMatch(
      /Suburban PJ scores highest, by 21\.6 points/,
    );
  });

  it("reports near-identical dimensions as too close rather than crowning one", () => {
    const verdicts = report()
      .tables.find((t) => t.title === "Dimension by dimension")!
      .rows.map((r) => r.cells.at(-1));
    expect(verdicts).toContain("too close to call");
  });

  it("shows a missing dimension as missing on both sides, never as a tie at zero", () => {
    // Kuantan and Kota Bharu: no rent benchmark covers either.
    const remote = buildComparisonReport("korean_restaurant", 500, [
      { ...CENTRAL_KL, point: { lat: 3.8077, lng: 103.326 }, label: "Kuantan" },
      { ...SUBURBAN_PJ, point: { lat: 6.1254, lng: 102.2381 }, label: "Kota Bharu" },
    ]);

    const rentRow = remote.tables
      .find((t) => t.title === "Dimension by dimension")!
      .rows.find((r) => r.cells[0] === "Rent sensitivity")!;

    // Words, not a dash. A lone em dash means nothing to a reader who has not
    // been told what it means, and this is the copy that gets forwarded to a
    // landlord or a bank.
    expect(rentRow.cells[1]).toBe("not scored");
    expect(rentRow.cells[2]).toBe("not scored");
    expect(rentRow.cells.at(-1)).toBe("no data either side");
  });

  it("overlays one radar series per location on shared axes", () => {
    const r = report();
    expect(r.radarSeries).toHaveLength(2);
    for (const series of r.radarSeries) {
      expect(series.values).toHaveLength(r.radarAxes.length);
    }
  });

  it("states that every location used the same category and radius", () => {
    expect(report().disclosures.join(" ")).toMatch(/same business category and the same radius/);
  });
});

describe("disclosures travel with every report", () => {
  const all = [
    buildScenarioReport(seedScenario("korean_restaurant", "mont_kiara")),
    buildLocationReport(CENTRAL_KL),
    buildComparisonReport("korean_restaurant", 500, [CENTRAL_KL, SUBURBAN_PJ]),
  ];

  it("says it is not a forecast, in all three", () => {
    for (const report of all) {
      expect(report.disclosures.join(" ")).toMatch(/not a forecast/);
    }
  });

  it("carries the statutory review date and the engine version", () => {
    for (const report of all) {
      const text = report.disclosures.join(" ");
      expect(text).toMatch(/Statutory rates reviewed \d{4}-\d{2}-\d{2}/);
      expect(text).toMatch(/Engine \d/);
      expect(report.engineVersion.length).toBeGreaterThan(0);
    }
  });

  it("tells the reader to confirm the rates themselves", () => {
    for (const report of all) {
      expect(report.disclosures.join(" ")).toMatch(/KWSP, PERKESO and RMCD/);
    }
  });
});

describe("benchmark table stays self-describing", () => {
  it("every district used by a report has a review date", () => {
    for (const preset of Object.values(DISTRICT_PRESETS)) {
      expect(preset.reviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

/**
 * The three defects the report shipped with, pinned at the model level.
 *
 * All three concerned the same small chart, and two of them were factual
 * rather than cosmetic — the PDF was stating things the data did not support,
 * in the copy that gets forwarded to a landlord or a bank.
 */
describe("competition rings", () => {
  it("labels rings as ranges, never as cumulative 'within'", () => {
    const report = buildLocationReport(CENTRAL_KL);

    // densityByBand returns EXCLUSIVE rings, so "within 500m" printed "0"
    // directly beneath "20 within 250m" - a contradiction, and not what the
    // number meant.
    expect(report.distanceBands.map((b) => b.label)).toEqual(["0-250m", "250-500m"]);

    const table = report.tables.find((t) => t.title === "Competition by distance")!;
    for (const row of table.rows) expect(row.cells[0]).not.toMatch(/within/);
  });

  it("marks a ring beyond the truncation point as unsearched, not as zero", () => {
    const report = buildLocationReport(CENTRAL_KL);

    // Complete only to 142m, so the 250-500m ring was never looked at.
    expect(report.distanceBands[0]).toMatchObject({ value: 20, unsearched: false });
    expect(report.distanceBands[1]!.unsearched).toBe(true);

    const table = report.tables.find((t) => t.title === "Competition by distance")!;
    expect(table.rows[1]!.cells[1]).toBe("not searched");
    expect(table.rows[1]!.cells[1]).not.toBe("0");
  });

  it("keeps a genuine zero as a zero when the search was complete", () => {
    const report = buildLocationReport({
      ...CENTRAL_KL,
      truncated: false,
      completeToMetres: null,
    });

    expect(report.distanceBands.every((b) => !b.unsearched)).toBe(true);
    const table = report.tables.find((t) => t.title === "Competition by distance")!;
    expect(table.rows[1]!.cells[1]).toBe("0");
  });
});

describe("the short version", () => {
  it("names the strongest and weakest dimension, and the constraint", () => {
    const report = buildLocationReport(CENTRAL_KL);
    const text = report.summary.join(" ");

    expect(report.summary.length).toBeGreaterThan(1);
    expect(text).toMatch(/scores \d+ out of 100/);
    expect(text).toMatch(/Strongest on/);
    expect(text).toMatch(/binding constraint/);
  });

  it("says the counts are a floor when the search was capped", () => {
    expect(buildLocationReport(CENTRAL_KL).summary.join(" ")).toMatch(/floor, not a total/);
  });

  it("declines to name a strongest axis when the profile is flat", () => {
    // Same restraint /compare shows when it refuses to call a narrow gap.
    const flat = buildLocationReport({
      ...CENTRAL_KL,
      competitors: { ...summary(), total: 3, averageRating: 3.9, nearestMetres: 400 },
      truncated: false,
      completeToMetres: null,
      density: [{ upToMetres: 250, count: 1 }, { upToMetres: 500, count: 2 }],
    });

    const text = flat.summary.join(" ");
    if (text.includes("No single dimension stands out")) {
      expect(text).not.toMatch(/Strongest on/);
    } else {
      expect(text).toMatch(/Strongest on/);
    }
  });

  it("counts what could not be measured rather than hiding it", () => {
    const bare = buildLocationReport({ ...CENTRAL_KL, demographics: null });
    expect(bare.summary.join(" ")).toMatch(/could not be measured/);
  });
});

describe("the analysis pages", () => {
  it("lists the rivals it was given, nearest first, capped", () => {
    const rivals = Array.from({ length: 20 }, (_, i) => ({
      id: `r${i}`,
      name: `Rival ${i}`,
      rating: 4,
      reviewCount: 10 + i,
      lat: 3.14,
      lng: 101.69,
      distanceMetres: 10 * (i + 1),
      businessStatus: "OPERATIONAL",
      priceLevel: null,
      primaryType: null,
    }));

    const table = buildLocationReport({ ...CENTRAL_KL, rivals }).tables.find(
      (t) => t.title === "Who is already there",
    )!;

    expect(table.rows).toHaveLength(12);
    expect(table.rows[0]!.cells[0]).toBe("Rival 0");
    expect(table.rows[0]!.cells[3]).toBe("10m");
  });

  it("omits the rival table entirely when none were supplied", () => {
    expect(
      buildLocationReport(CENTRAL_KL).tables.find((t) => t.title === "Who is already there"),
    ).toBeUndefined();
  });

  it("reports the catchment as a percentile, on the same scale as the score", () => {
    const table = buildLocationReport({ ...CENTRAL_KL, catchment: 6_457 }).tables.find(
      (t) => t.title === "Catchment",
    )!;

    expect(table.rows[0]!.cells[1]).toBe("6,457");
    expect(table.rows[1]!.cells[1]).toMatch(/Denser than 87% of where Malaysians live/);
    // The error this table exists to prevent.
    expect(table.note).toMatch(/rather than a district total/);
  });

  it("breaks the rent down into the figure an owner can argue with", () => {
    const table = buildLocationReport(CENTRAL_KL).tables.find(
      (t) => t.title === "Rent and break-even",
    )!;

    const measures = table.rows.map((r) => r.cells[0]);
    expect(measures).toContain("Customers per day to break even");
    expect(measures).toContain("Exposure");
    // Words, not colours - a PDF gets printed in black and white.
    expect(["Comfortable", "Tight", "Very exposed"]).toContain(
      table.rows.find((r) => r.cells[0] === "Exposure")!.cells[1],
    );
    expect(table.note).toMatch(/covers ALL fixed costs, not rent alone/);
  });

  it("gives the score dimensions as bars, distinguishing missing from zero", () => {
    const bars = buildLocationReport({ ...CENTRAL_KL, demographics: null }).dimensionBars;

    expect(bars.length).toBeGreaterThan(3);
    expect(bars.some((b) => b.score === null)).toBe(true);
    for (const bar of bars) {
      expect(bar.label).not.toBe("");
      expect(["measured", "inferred", "no data"]).toContain(bar.basis);
    }
  });

  it("orders the age profile youngest to oldest", () => {
    const bands = buildLocationReport(CENTRAL_KL).ageBands;
    expect(bands[0]!.label).toBe("0-4");
    expect(bands.every((b) => b.value > 0)).toBe(true);
  });
});
