import { expect, test, type Page } from "@playwright/test";

/**
 * Location profile / Overall Success Score — Feature 1d.
 *
 * The assertions are mostly about restraint: the panel must not let a single
 * number read as a forecast, and it must show the missing rent axis rather
 * than quietly scoring four dimensions and calling it five.
 */

const MAPS = "https://maps.googleapis.com/**";

function competitorsPayload(over: Record<string, unknown> = {}) {
  return {
    competitors: [],
    summary: {
      total: 4,
      averageRating: 4.0,
      ratedCount: 4,
      totalReviews: 800,
      nearestMetres: 120,
      operational: 4,
    },
    density: [
      { upToMetres: 250, count: 2 },
      { upToMetres: 500, count: 2 },
      { upToMetres: 1000, count: 0 },
    ],
    fromCache: true,
    fetchedAt: Date.now(),
    radiusMetres: 500,
    truncated: false,
    completeToMetres: null,
    searchSkipped: false,
    placesConfigured: true,
    ...over,
  };
}

async function stub(page: Page, competitorsOver: Record<string, unknown> = {}) {
  await page.route("**/v1/competitors", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(competitorsPayload(competitorsOver)),
    }),
  );
  await page.route("**/v1/demographics", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        matched: true,
        resolution: "district",
        demographics: {
          district: "W.P. Kuala Lumpur",
          state: "W.P. Kuala Lumpur",
          total: 2_074_100,
          age: Object.fromEntries(
            ["15-19","20-24","25-29","30-34","35-39","40-44","45-49","50-54","55-59","60-64"].map(
              (b) => [b, 145_000],
            ),
          ),
          ethnicity: { bumi_malay: 862_300, chinese: 729_500 },
        },
        vintage: "2025",
        reviewed: "2026-08-12",
        sourceNote: "CC BY 4.0",
      }),
    }),
  );
  await page.route("**/v1/opportunity-gaps", (route) =>
    route.fulfill({ status: 502, contentType: "application/json", body: "{}" }),
  );
}

test.beforeEach(async ({ page }) => {
  await page.route(MAPS, (route) => route.abort());
});

test("shows the profile with a score and the radar chart", async ({ page }) => {
  await stub(page);
  await page.goto("/analysis?lat=3.1478&lng=101.6953");

  await expect(page.getByText("Location profile")).toBeVisible();

  // The score is the hero now: a ring rather than a pill in a panel header.
  await expect(page.getByRole("img", { name: /Success score \d+ out of 100/ })).toBeVisible();
  await expect(page.getByText("out of 100")).toBeVisible();

  // Radar axes render as SVG text; the same labels also appear in the table
  // below, so scope to the chart.
  const radar = page.locator(".hero").getByRole("img");
  await expect(radar.getByText("Competition", { exact: true })).toBeVisible();
  await expect(radar.getByText("Rent sensitivity", { exact: true })).toBeVisible();
});

test("states that it is a comparison score and not a forecast", async ({ page }) => {
  await stub(page);
  await page.goto("/analysis?lat=3.1478&lng=101.6953");

  // The footer repeats this caveat site-wide, so both assertions name the
  // panel. The panel's wording is its own — "comparison score" against the
  // footer's "comparison aid" — and it is the one that has to be here.
  const panel = page.locator(".notice.info").first();
  await expect(panel.getByText(/comparison score, not a forecast/)).toBeVisible();
  await expect(panel.getByText(/validated against real business outcomes/)).toBeVisible();
});

test("labels every dimension as measured or inferred", async ({ page }) => {
  await stub(page);
  await page.goto("/analysis?lat=3.1478&lng=101.6953");

  await expect(page.getByRole("table").getByText("measured").first()).toBeVisible();
  await expect(page.getByRole("table").getByText("inferred").first()).toBeVisible();
});

test("rent sensitivity is inferred where a benchmark reaches", async ({ page }) => {
  await stub(page);
  await page.goto("/analysis?lat=3.1478&lng=101.6953");

  const row = page.getByRole("row").filter({ hasText: "Rent sensitivity" });
  await expect(row.getByText("inferred")).toBeVisible();
});

test("rent sensitivity stays empty where no benchmark reaches, rather than faking it", async ({
  page,
}) => {
  await stub(page);
  // Kuantan — outside every curated trading area. Coverage is deliberately
  // partial, and the honest answer is an empty axis, not a national average.
  await page.goto("/analysis?lat=3.8077&lng=103.3260");

  const row = page.getByRole("row").filter({ hasText: "Rent sensitivity" });
  await expect(row.getByText("no data")).toBeVisible();
});

test("an empty area is not presented as a perfect one", async ({ page }) => {
  // Must agree with Opportunity Gap Detection: absence is unproven, not open.
  await stub(page, {
    summary: {
      total: 0, averageRating: null, ratedCount: 0,
      totalReviews: 0, nearestMetres: null, operational: 0,
    },
  });
  await page.goto("/analysis?lat=3.1478&lng=101.6953");

  await expect(page.getByText(/unproven rather than open/i)).toBeVisible();
});

test("scores a capped search on density rather than the capped count", async ({ page }) => {
  // 20 outlets within 140m is a real measurement, not a bound — the cap is
  // accounted for. Scoring on the count alone made every urban location score
  // the same, which defeated the comparison the whole panel exists for.
  await stub(page, {
    truncated: true,
    completeToMetres: 140,
    summary: {
      total: 20, averageRating: 4.3, ratedCount: 20,
      totalReviews: 4000, nearestMetres: 60, operational: 20,
    },
  });
  await page.goto("/analysis?lat=3.1478&lng=101.6953");

  await expect(page.getByText(/per km²/)).toBeVisible();
  // Not presented as a bound, because it is not one.
  await expect(page.getByText(/≤\s*\d+/)).toHaveCount(0);
});

test("marks it as a bound only when density cannot be worked out", async ({ page }) => {
  await stub(page, {
    truncated: true,
    completeToMetres: null,
    summary: {
      total: 20, averageRating: 4.3, ratedCount: 20,
      totalReviews: 4000, nearestMetres: 60, operational: 20,
    },
  });
  await page.goto("/analysis?lat=3.1478&lng=101.6953");

  await expect(page.getByText(/≤\s*\d+/).first()).toBeVisible();
});

test("explains the weighting when asked", async ({ page }) => {
  await stub(page);
  await page.goto("/analysis?lat=3.1478&lng=101.6953");

  await page.getByText(/How the score is weighted/).click();
  await expect(page.getByText(/how much each signal can be trusted/)).toBeVisible();
  await expect(page.getByText(/peaks rather than slopes/)).toBeVisible();
});

test("the simulator route has no profile panel", async ({ page }) => {
  await page.goto("/simulator");
  await expect(page.getByTestId("headline-profit")).toBeVisible();
  await expect(page.getByText("Location profile")).toHaveCount(0);
});
