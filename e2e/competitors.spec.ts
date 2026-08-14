import { expect, test, type Page } from "@playwright/test";
import { openSection } from "./sections.js";

/**
 * Competitor panels — Feature 1b.
 *
 * Google Maps stays blocked, as everywhere in this suite, and the competitors
 * endpoint is stubbed. Neither Maps nor Places is ever called from CI: both
 * bill per request and neither would tell us anything the stub does not.
 */

const MAPS = "https://maps.googleapis.com/**";

function competitorPayload(over: Record<string, unknown> = {}) {
  return {
    competitors: [
      {
        id: "a",
        name: "Seoul Garden Bangsar",
        lat: 3.1481,
        lng: 101.6955,
        rating: 4.4,
        reviewCount: 820,
        primaryType: "korean_restaurant",
        priceLevel: "PRICE_LEVEL_MODERATE",
        businessStatus: "OPERATIONAL",
        distanceMetres: 120,
      },
      {
        id: "b",
        name: "Kim's Kitchen",
        lat: 3.1495,
        lng: 101.696,
        rating: 3.9,
        reviewCount: 64,
        primaryType: "korean_restaurant",
        priceLevel: null,
        businessStatus: "OPERATIONAL",
        distanceMetres: 380,
      },
      {
        id: "c",
        name: "Closed Down BBQ",
        lat: 3.152,
        lng: 101.698,
        rating: null,
        reviewCount: 0,
        primaryType: "korean_restaurant",
        priceLevel: null,
        businessStatus: "CLOSED_PERMANENTLY",
        distanceMetres: 460,
      },
    ],
    summary: {
      total: 3,
      averageRating: 4.15,
      ratedCount: 2,
      totalReviews: 884,
      nearestMetres: 120,
      operational: 2,
    },
    density: [
      { upToMetres: 250, count: 1 },
      { upToMetres: 500, count: 2 },
      { upToMetres: 1000, count: 0 },
    ],
    fromCache: false,
    fetchedAt: Date.now(),
    radiusMetres: 500,
    truncated: false,
    completeToMetres: null,
    searchSkipped: false,
    placesConfigured: true,
    ...over,
  };
}

async function stubCompetitors(page: Page, over: Record<string, unknown> = {}) {
  await page.route("**/v1/competitors", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(competitorPayload(over)),
    }),
  );
}

test.beforeEach(async ({ page }) => {
  await page.route(MAPS, (route) => route.abort());
});

test("lists competitors with rating, reviews and distance", async ({ page }) => {
  await stubCompetitors(page);
  await page.goto("/analysis?lat=3.1478&lng=101.6953&q=Bangsar");
  await openSection(page, "Competition");

  await expect(page.getByText("Seoul Garden Bangsar")).toBeVisible();
  await expect(page.getByText("Kim's Kitchen")).toBeVisible();
  await expect(page.getByText("3 within 500m")).toBeVisible();
  await expect(page.getByText(/Average rating 4\.15 across 2 rated/)).toBeVisible();
  await expect(page.getByText(/nearest 120m away/)).toBeVisible();
});

test("marks permanently closed competitors rather than hiding them", async ({ page }) => {
  await stubCompetitors(page);
  await page.goto("/analysis?lat=3.1478&lng=101.6953");
  await openSection(page, "Competition");

  // Still listed — a closed unit is a vacancy, which is useful information.
  await expect(page.getByText("Closed Down BBQ")).toBeVisible();
  await expect(page.getByText("closed", { exact: true })).toBeVisible();
});

test("shows density bands", async ({ page }) => {
  await stubCompetitors(page);
  await page.goto("/analysis?lat=3.1478&lng=101.6953");
  await openSection(page, "Competition");

  await expect(page.getByText("Competition density")).toBeVisible();
  await expect(page.getByText("0–250m")).toBeVisible();
  await expect(page.getByText("250–500m")).toBeVisible();
});

test("labels cached results with their age", async ({ page }) => {
  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
  await stubCompetitors(page, { fromCache: true, fetchedAt: threeDaysAgo });
  await page.goto("/analysis?lat=3.1478&lng=101.6953");
  await openSection(page, "Competition");

  // An SME should know whether this is today's data or last Tuesday's.
  await expect(page.getByText("cached 3 days ago")).toBeVisible();
});

test("explains an empty result instead of showing a blank panel", async ({ page }) => {
  await stubCompetitors(page, {
    competitors: [],
    summary: { total: 0, averageRating: null, ratedCount: 0, totalReviews: 0, nearestMetres: null, operational: 0 },
    density: [
      { upToMetres: 250, count: 0 },
      { upToMetres: 500, count: 0 },
      { upToMetres: 1000, count: 0 },
    ],
  });
  await page.goto("/analysis?lat=3.1478&lng=101.6953");
  await openSection(page, "Competition");

  await expect(page.getByText(/No competitors of this type found/)).toBeVisible();
});

test("a capped search is labelled a limit, not a finding", async ({ page }) => {
  // A dense area fills Google's 20-result quota within 114m. Showing
  // "0 competitors in 250-500m" would read as an opportunity when in fact we
  // never looked that far.
  await stubCompetitors(page, {
    truncated: true,
    completeToMetres: 114,
    density: [
      { upToMetres: 250, count: 3 },
      { upToMetres: 500, count: 0 },
      { upToMetres: 1000, count: 0 },
    ],
  });
  await page.goto("/analysis?lat=3.1478&lng=101.6953");
  await openSection(page, "Competition");

  await expect(page.getByText(/at most 20 places per search/)).toBeVisible();
  await expect(page.getByText("complete to 114m")).toBeVisible();
  // The bands beyond the cap say "not searched", never "0".
  await expect(page.getByText("not searched").first()).toBeVisible();
});

test("says so plainly when competitor lookup is not configured", async ({ page }) => {
  await stubCompetitors(page, { placesConfigured: false, competitors: [] });
  await page.goto("/analysis?lat=3.1478&lng=101.6953");
  await openSection(page, "Competition");

  await expect(page.getByText(/not configured on this deployment/)).toBeVisible();
});

test("a failing competitor lookup leaves the rest of the page working", async ({ page }) => {
  await page.route("**/v1/competitors", (route) =>
    route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "places_failed" }) }),
  );
  await page.goto("/analysis?lat=3.1478&lng=101.6953&q=Bangsar");
  await openSection(page, "Competition");

  await expect(page.getByText(/Could not load competitor data/)).toBeVisible();
  // Location details and navigation are unaffected.
  await expect(page.getByText("3.14780, 101.69530")).toBeVisible();
  await expect(page.getByRole("link", { name: "Simulator", exact: true })).toBeVisible();
});

test("changing the radius re-queries", async ({ page }) => {
  let calls = 0;
  await page.route("**/v1/competitors", (route) => {
    calls += 1;
    const body = route.request().postDataJSON() as { radiusMetres: number };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(competitorPayload({ radiusMetres: body.radiusMetres })),
    });
  });

  await page.goto("/analysis?lat=3.1478&lng=101.6953");
  await openSection(page, "Competition");
  await expect(page.getByText("3 within 500m")).toBeVisible();

  await page.getByLabel("Search radius").selectOption("1000");
  await expect(page.getByText("3 within 1,000m")).toBeVisible();
  expect(calls).toBeGreaterThanOrEqual(2);
});

test("the simulator route never requests competitors", async ({ page }) => {
  const competitorCalls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/v1/competitors")) competitorCalls.push(r.url());
  });

  await page.goto("/simulator");
  await expect(page.getByTestId("headline-profit")).toBeVisible();
  await page.waitForTimeout(1_000);

  expect(competitorCalls).toEqual([]);
});

/**
 * Data we already pay Places for and used to discard.
 *
 * `priceLevel` and `primaryType` have always been in the field mask and
 * billed on every search; the old four-column table showed neither. Free
 * signal, so it should stay on screen.
 */
test("shows price level and cuisine type, which the old table dropped", async ({ page }) => {
  await stubCompetitors(page);
  await page.goto("/analysis?lat=3.1478&lng=101.6953");
  await openSection(page, "Competition");

  const list = page.locator(".clist");

  // PRICE_LEVEL_MODERATE renders as marks, not the raw enum.
  await expect(page.getByText("PRICE_LEVEL_MODERATE")).toHaveCount(0);
  // Scoped to the list: the toolbar's category <option> also reads
  // "Korean restaurant".
  await expect(list.getByText("korean restaurant").first()).toBeVisible();
  await expect(list.locator(".clist-price").first()).toBeVisible();
});

test("sorting reorders the list and the ranks follow", async ({ page }) => {
  await stubCompetitors(page);
  await page.goto("/analysis?lat=3.1478&lng=101.6953");
  await openSection(page, "Competition");

  const rows = page.locator(".clist-row");

  // Default is nearest first: Seoul Garden at 120m.
  await expect(rows.first()).toContainText("Seoul Garden Bangsar");

  await page.getByRole("button", { name: "Busiest" }).click();
  // 820 reviews against 64 and 0.
  await expect(rows.first()).toContainText("Seoul Garden Bangsar");

  await page.getByRole("button", { name: "Best rated" }).click();
  await expect(rows.first()).toContainText("Seoul Garden Bangsar");
  // Unrated sinks rather than sorting as a zero at the top.
  await expect(rows.last()).toContainText("Closed Down BBQ");
});

test("a closed outlet keeps its badge under every sort", async ({ page }) => {
  await stubCompetitors(page);
  await page.goto("/analysis?lat=3.1478&lng=101.6953");
  await openSection(page, "Competition");

  const list = page.locator(".clist");
  for (const sort of ["Busiest", "Best rated", "Nearest"]) {
    await page.getByRole("button", { name: sort }).click();
    await expect(list.getByText("closed", { exact: true })).toBeVisible();
  }
});

/**
 * THE TWO RINGS ARE NOT TESTED HERE, DELIBERATELY.
 *
 * They are Google Maps overlays, and CI never loads Maps — every spec in this
 * suite blocks it, because it bills per request and the graceful-degradation
 * path is the one worth guarding. With the map unavailable the rings do not
 * exist and the legend is correctly hidden, so any assertion here would be
 * testing the fallback rather than the feature.
 *
 * Verified by hand against the deployed map instead, which is the same
 * convention the pin and radius circle have always followed.
 */
