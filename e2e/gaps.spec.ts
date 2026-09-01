import { expect, test, type Page } from "@playwright/test";

/**
 * Opportunity gaps, at their new home.
 *
 * This file used to drive a Gaps tab holding a ranked table. The tab is gone —
 * the owner could not act on the numbers — and the reading is now written by
 * Gemini inside the Spotential AI panel, with the figures folded into a
 * disclosure beneath it.
 *
 * PORTED RATHER THAN BINNED. This repo has already learned that deleting a
 * page is not deleting its guarantees: running `heatmap.spec` against its new
 * home caught three things that had silently gone missing in that merge. Of
 * the eight tests here, seven guard behaviour that still exists, and one
 * genuinely died with the table.
 */

const MAPS = "https://maps.googleapis.com/**";
const AT_KL = "/analysis?lat=3.1478&lng=101.6953";

const RANKED = [
  {
    category: "bubble_tea",
    label: "Bubble tea / dessert",
    outlets: 3,
    outletsAreMinimum: false,
    totalReviews: 1_920,
    reviewsPerOutlet: 640,
    averageRating: 4.5,
    demandIndex: 0.9,
    saturationIndex: 0.2,
    gapScore: 0.88,
    verdict: "underserved",
  },
  {
    category: "korean_restaurant",
    label: "Korean restaurant",
    outlets: 20,
    outletsAreMinimum: true,
    totalReviews: 7_580,
    reviewsPerOutlet: 379,
    averageRating: 4.41,
    demandIndex: 0.5,
    saturationIndex: 0.9,
    gapScore: 0.2,
    verdict: "saturated",
  },
];

const ABSENT = [
  {
    category: "fast_casual",
    label: "Fast-casual takeaway",
    outlets: 0,
    outletsAreMinimum: false,
    totalReviews: 0,
    reviewsPerOutlet: null,
    averageRating: null,
    demandIndex: 0,
    saturationIndex: 0,
    gapScore: 0,
    verdict: "no-presence",
  },
];

const BRIEFING = {
  kind: "brief",
  cached: false,
  briefing: {
    headline: "A street with one thin category and one crowded one.",
    readings: ["Korean restaurants number 20 or more, averaging 379 reviews per outlet."],
    watchOut: "The result cap filled early, so the count is a floor.",
    nextStep: "Get a quoted rent for the unit.",
    opportunity: {
      verdict: "Bubble tea and dessert is the least crowded category relative to its demand here.",
      why: "Three outlets carry 640 reviews each, against 20 or more Korean restaurants averaging 379.",
      moves: [
        "Visit the 3 dessert outlets at 9pm to see whether the queues match the review counts.",
        "Compare a second site before committing.",
      ],
    },
  },
};

async function stub(
  page: Page,
  over: Record<string, unknown> = {},
  brief: { status: number; body: unknown } = { status: 200, body: BRIEFING },
) {
  await page.route(MAPS, (route) => route.abort());
  await page.route("**/v1/opportunity-gaps", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ranked: RANKED,
        noPresence: ABSENT,
        topOpportunity: RANKED[0],
        radiusMetres: 500,
        fromCache: true,
        categoriesFetched: 6,
        fetchedAt: Date.now(),
        searchSkipped: false,
        placesConfigured: true,
        ...over,
      }),
    }),
  );
  await page.route("**/v1/location/brief", (route) =>
    route.fulfill({
      status: brief.status,
      contentType: "application/json",
      body: JSON.stringify(brief.body),
    }),
  );
  await page.route("**/v1/demographics", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
  );
  await page.route("**/v1/competitors", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        competitors: [],
        summary: {
          total: 0,
          averageRating: null,
          ratedCount: 0,
          totalReviews: 0,
          nearestMetres: null,
          operational: 0,
        },
        density: [{ upToMetres: 500, count: 0 }],
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

const openWorking = async (page: Page) => {
  await page.getByText("Show the figures behind this").click();
};

test("names the best opportunity, without a tab to open", async ({ page }) => {
  await stub(page);
  await page.goto(AT_KL);

  // It used to take a click on a Gaps tab. It is on the page now.
  await expect(page.getByRole("tab", { name: /^Gaps/ })).toHaveCount(0);
  await expect(page.locator(".ai-gap-verdict")).toContainText(/Bubble tea/);
});

test("shows a capped category as a minimum and marks it saturated", async ({ page }) => {
  await stub(page);
  await page.goto(AT_KL);
  await openWorking(page);

  // "20+", never a bare 20 that reads as an exact count.
  await expect(page.locator(".ai-gap-rows")).toContainText("20+ outlets");
  await expect(page.locator(".ai-gap-verdict-pill.saturated")).toBeVisible();
});

test("keeps zero-outlet categories out of the ranking and says why", async ({ page }) => {
  // The most dangerous false positive in the feature, and the one the model is
  // most tempted by: an empty category looks exactly like an open market.
  await stub(page);
  await page.goto(AT_KL);
  await openWorking(page);

  await expect(page.getByText(/Not found nearby/)).toBeVisible();
  await expect(page.getByText(/Zero outlets is/)).toBeVisible();
  await expect(page.getByText(/cannot tell the two apart/)).toBeVisible();

  // And it is definitely not what the AI called the opening.
  await expect(page.locator(".ai-gap-verdict")).not.toContainText(/Fast-casual/);
});

test("states the limitations on screen rather than hiding them", async ({ page }) => {
  await stub(page);
  await page.goto(AT_KL);
  await openWorking(page);

  // The five caveats had no other home. They moved before the panel was
  // deleted, which is the whole reason this file was ported rather than binned.
  await expect(page.getByText(/proxy, not a measure of demand/)).toBeVisible();
  await expect(page.getByText(/relative to the other categories at this spot/)).toBeVisible();
  await expect(page.getByText(/lifetime totals/)).toBeVisible();
  await expect(page.getByText(/category labels are approximate/)).toBeVisible();
});

test("keeps the figures when the write-up is missing", async ({ page }) => {
  /**
   * Gemini failing must cost the prose, not the analysis — the same rule the
   * table followed in its own tab. Caught a real regression during the move:
   * the disclosure was nested inside the AI-ready branch, so a refused
   * briefing took the evidence down with it.
   */
  await stub(page, {}, { status: 503, body: { error: "ai_unavailable", message: "Not configured." } });
  await page.goto(AT_KL);

  await expect(page.locator(".ai-unavailable")).toBeVisible();
  await openWorking(page);
  await expect(page.locator(".ai-gap-rows")).toContainText("Korean restaurant");
});

test("explains an area with nothing trading in it", async ({ page }) => {
  await stub(page, { ranked: [], noPresence: [], topOpportunity: null });
  await page.goto(AT_KL);

  await expect(page.getByText(/no signal to compare against/)).toBeVisible();
  // Emptiness is not an opening, and the copy has to say so.
  await expect(page.getByText(/no appetite for this kind of business/)).toBeVisible();
});

test("a failing gap analysis leaves the rest of the page working", async ({ page }) => {
  await page.route(MAPS, (route) => route.abort());
  await page.route("**/v1/opportunity-gaps", (route) =>
    route.fulfill({ status: 502, contentType: "application/json", body: "{}" }),
  );
  await page.goto(`${AT_KL}&q=Bangsar`);

  // The deterministic core is untouched: the score still renders, and the
  // panel still leads with a sentence computed from the figures.
  await expect(page.getByRole("img", { name: /Success score/ })).toBeVisible();
  await expect(page.locator(".ai-derived")).toContainText(/scores \d+ out of 100/);
});

test("the simulator route never requests gap analysis", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/v1/opportunity-gaps")) calls.push(r.url());
  });

  await page.route(MAPS, (route) => route.abort());
  await page.goto("/simulator");
  await expect(page.getByText(/What-if/i).first()).toBeVisible();
  expect(calls).toEqual([]);
});
