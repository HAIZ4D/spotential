import { expect, test, type Page } from "@playwright/test";
import { openSection } from "./sections.js";

/**
 * Opportunity Gap Detection — Feature add-on #1.
 *
 * Maps stays blocked and the endpoint is stubbed, as everywhere in this suite.
 * The assertions here are mostly about what the panel must REFUSE to claim: an
 * SME could sign a lease on this, and the demand signal is a proxy.
 */

const MAPS = "https://maps.googleapis.com/**";

const gap = (over: Record<string, unknown>) => ({
  category: "other_fnb",
  label: "Other (F&B)",
  outlets: 4,
  outletsAreMinimum: false,
  totalReviews: 400,
  averageRating: 4.1,
  reviewsPerOutlet: 100,
  demandIndex: 0.5,
  saturationIndex: 0.5,
  gapScore: 0.5,
  verdict: "balanced",
  ...over,
});

function payload(over: Record<string, unknown> = {}) {
  return {
    ranked: [
      gap({
        category: "bubble_tea_dessert",
        label: "Bubble tea / dessert",
        outlets: 1,
        totalReviews: 1200,
        reviewsPerOutlet: 1200,
        averageRating: 4.6,
        gapScore: 1,
        verdict: "underserved",
      }),
      gap({
        category: "korean_restaurant",
        label: "Korean restaurant",
        outlets: 3,
        totalReviews: 2450,
        reviewsPerOutlet: 816.67,
        gapScore: 0.23,
        verdict: "balanced",
      }),
      gap({
        category: "cafe_coffee_shop",
        label: "Cafe / coffee shop",
        outlets: 20,
        outletsAreMinimum: true,
        totalReviews: 800,
        reviewsPerOutlet: 40,
        gapScore: 0,
        verdict: "saturated",
      }),
    ],
    noPresence: [
      gap({
        category: "fast_casual_takeaway",
        label: "Fast-casual takeaway",
        outlets: 0,
        totalReviews: 0,
        reviewsPerOutlet: null,
        averageRating: null,
        gapScore: 0,
        verdict: "no-presence",
      }),
    ],
    topOpportunity: gap({
      category: "bubble_tea_dessert",
      label: "Bubble tea / dessert",
      gapScore: 1,
      verdict: "underserved",
    }),
    narrative: "A dessert or bubble tea concept is the clearest opening on this street.",
    radiusMetres: 500,
    fromCache: false,
    categoriesFetched: 6,
    fetchedAt: Date.now(),
    searchSkipped: false,
    placesConfigured: true,
    ...over,
  };
}

async function stubGaps(page: Page, over: Record<string, unknown> = {}) {
  await page.route("**/v1/opportunity-gaps", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload(over)),
    }),
  );
  // Keep the competitor panel quiet so it cannot confuse the assertions.
  await page.route("**/v1/competitors", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        competitors: [],
        summary: { total: 0, averageRating: null, ratedCount: 0, totalReviews: 0, nearestMetres: null, operational: 0 },
        density: [
          { upToMetres: 250, count: 0 },
          { upToMetres: 500, count: 0 },
          { upToMetres: 1000, count: 0 },
        ],
        fromCache: true,
        fetchedAt: Date.now(),
        radiusMetres: 500,
        truncated: false,
        completeToMetres: null,
        searchSkipped: false,
        placesConfigured: true,
      }),
    }),
  );
}

test.beforeEach(async ({ page }) => {
  await page.route(MAPS, (route) => route.abort());
});

test("ranks categories and names the best opportunity", async ({ page }) => {
  await stubGaps(page);
  await page.goto("/analysis?lat=3.1478&lng=101.6953");
  await openSection(page, "Gaps");

  await expect(page.getByText("Opportunity gaps")).toBeVisible();
  await expect(page.getByText("best: Bubble tea / dessert")).toBeVisible();
  /**
   * The write-up is no longer here. It moved to the Spotential AI panel at the
   * top of the page, which sees the competitors, catchment and rent as well —
   * and which, unlike this one, still writes something when no category stands
   * out. This section keeps the evidence; `brief.spec.ts` covers the prose.
   */
  await expect(page.locator(".gap-narrative")).toHaveCount(0);
  await expect(page.getByRole("table")).toBeVisible();
});

test("shows a capped category as a minimum and marks it saturated", async ({ page }) => {
  await stubGaps(page);
  await page.goto("/analysis?lat=3.1478&lng=101.6953");
  await openSection(page, "Gaps");

  // "20+", never a bare 20 that reads as an exact count.
  await expect(page.getByText("20+", { exact: true })).toBeVisible();
  await expect(page.getByText("saturated", { exact: true })).toBeVisible();
});

test("keeps zero-outlet categories out of the ranking and says why", async ({ page }) => {
  // The most dangerous false positive in the feature.
  await stubGaps(page);
  await page.goto("/analysis?lat=3.1478&lng=101.6953");
  await openSection(page, "Gaps");

  await expect(page.getByText(/NOT FOUND NEARBY/)).toBeVisible();
  // Scoped to the panel: the category names also appear in the select options.
  await expect(page.getByRole("main").getByText("Fast-casual takeaway")).toBeVisible();
  await expect(page.getByText(/Zero outlets is/)).toBeVisible();
  await expect(page.getByText(/cannot tell the two apart/)).toBeVisible();

  // And it is definitely not presented as the recommendation.
  await expect(page.getByText("best: Fast-casual takeaway")).toHaveCount(0);
});

test("states the limitations on screen rather than hiding them", async ({ page }) => {
  await stubGaps(page);
  await page.goto("/analysis?lat=3.1478&lng=101.6953");
  await openSection(page, "Gaps");

  await page.getByText(/How this is calculated/).click();
  await expect(page.getByText(/proxy, not a measure of demand/)).toBeVisible();
  await expect(page.getByText(/relative to the other categories at this spot/)).toBeVisible();
  await expect(page.getByText(/lifetime totals/)).toBeVisible();
});

test("renders the table even when the write-up is missing", async ({ page }) => {
  // Gemini Pro failing must cost the prose, not the analysis.
  await stubGaps(page, { narrative: "" });
  await page.goto("/analysis?lat=3.1478&lng=101.6953");
  await openSection(page, "Gaps");

  await expect(page.getByRole("cell", { name: "Korean restaurant" })).toBeVisible();
  await expect(page.getByText("best: Bubble tea / dessert")).toBeVisible();
});

test("explains an area with nothing trading in it", async ({ page }) => {
  await stubGaps(page, { ranked: [], noPresence: [], topOpportunity: null, narrative: "" });
  await page.goto("/analysis?lat=3.1478&lng=101.6953");
  await openSection(page, "Gaps");

  await expect(page.getByText(/no signal to compare against/)).toBeVisible();
});

test("a failing gap analysis leaves the rest of the page working", async ({ page }) => {
  await page.route("**/v1/opportunity-gaps", (route) =>
    route.fulfill({ status: 502, contentType: "application/json", body: "{}" }),
  );
  await page.goto("/analysis?lat=3.1478&lng=101.6953&q=Bangsar");
  await openSection(page, "Gaps");

  await expect(page.getByText(/Could not analyse this area/)).toBeVisible();
  await expect(page.getByText("3.14780, 101.69530")).toBeVisible();
});

test("the simulator route never requests gap analysis", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/v1/opportunity-gaps")) calls.push(r.url());
  });

  await page.goto("/simulator");
  await expect(page.getByTestId("headline-profit")).toBeVisible();
  await page.waitForTimeout(1_000);

  expect(calls).toEqual([]);
});
