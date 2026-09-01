import { expect, test, type Page } from "@playwright/test";

/**
 * Spotential AI, in the report rather than behind a tab.
 *
 * The feature replaced two AI surfaces with one and moved it out of the tab
 * bar, because the gap write-up was skipped whenever no category stood out —
 * exactly when every category is saturated and the table is hardest to read.
 * These tests are about that: the panel is always there, the computed sentence
 * is always true, and the model failing never leaves an empty box.
 */

const MAPS = "https://maps.googleapis.com/**";
const AT_KL = "/analysis?lat=3.1478&lng=101.6953&q=Kuala%20Lumpur";

const COMPETITORS = {
  competitors: [],
  summary: {
    total: 20,
    averageRating: 4.3,
    ratedCount: 18,
    totalReviews: 5600,
    nearestMetres: 40,
    operational: 19,
  },
  density: [{ upToMetres: 500, count: 20 }],
  fromCache: true,
  fetchedAt: Date.now(),
  radiusMetres: 500,
  truncated: true,
  completeToMetres: 421,
  searchSkipped: false,
  placesConfigured: true,
};

/** Every category crowded and no winner: the owner's screenshot. */
const GAPS = {
  ranked: [
    "Fast-casual takeaway",
    "Korean restaurant",
    "Cafe / coffee shop",
    "Casual dining / mamak",
    "Bubble tea / dessert",
    "Other (F&B)",
  ].map((label, i) => ({
    category: `c${i}`,
    label,
    outlets: 20,
    outletsAreMinimum: true,
    reviewsPerOutlet: 200 + i,
    averageRating: 4.3,
    gapScore: 0.2,
    verdict: "saturated",
  })),
  noPresence: [],
  topOpportunity: null,
  radiusMetres: 500,
  fromCache: true,
  categoriesFetched: 6,
  fetchedAt: Date.now(),
  searchSkipped: false,
  placesConfigured: true,
};

const BRIEFING = {
  kind: "brief",
  cached: false,
  briefing: {
    headline: "This is a fully worked F&B street, not an opening.",
    readings: [
      "Every one of the 6 categories compared came back saturated.",
      "The search filled its 20 result cap within 421m.",
    ],
    watchOut: "Rent here is an inferred benchmark rather than a quoted figure.",
    nextStep: "Get a real quoted rent for the specific unit.",
  },
};

async function stub(page: Page, brief: { status: number; body: unknown }) {
  await page.route(MAPS, (route) => route.abort());
  await page.route("**/v1/competitors", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(COMPETITORS) }),
  );
  await page.route("**/v1/opportunity-gaps", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(GAPS) }),
  );
  await page.route("**/v1/demographics", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
  );
  await page.route("**/v1/location/brief", (route) =>
    route.fulfill({
      status: brief.status,
      contentType: "application/json",
      body: JSON.stringify(brief.body),
    }),
  );
}

const panel = (page: Page) => page.locator(".aipanel");

test("the analysis is in the page, not behind a tab", async ({ page }) => {
  await stub(page, { status: 200, body: BRIEFING });
  await page.goto(AT_KL);

  // Visible without a single click. That is the whole point of the move.
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByText("Spotential AI")).toBeVisible();

  // And the tab it used to live in is gone.
  await expect(page.getByRole("tab", { name: /^Ask/ })).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(6);
});

test("says every category is crowded, which the table alone never did", async ({ page }) => {
  await stub(page, { status: 200, body: BRIEFING });
  await page.goto(AT_KL);

  /**
   * The bug in one assertion. The write-up used to be skipped whenever there
   * was no top opportunity, so this exact state — six saturated categories,
   * every opportunity bar empty — produced no prose at all.
   */
  await expect(panel(page).getByText(/already crowded/)).toBeVisible();
  await expect(panel(page).getByText("This is a fully worked F&B street, not an opening.")).toBeVisible();
  // Scoped to the cards. A bare text match also caught the "What should I
  // watch out for?" suggestion chip in the ask box below.
  await expect(panel(page).locator(".ai-card.watch")).toContainText(/inferred benchmark/);
  await expect(panel(page).locator(".ai-card.next")).toContainText(/quoted rent/);
});

test("the computed sentence survives a refused briefing", async ({ page }) => {
  await stub(page, {
    status: 200,
    body: {
      kind: "refused",
      reason:
        "The analysis was withheld because it referred to a figure this page did not measure.",
      unsupported: [87],
    },
  });
  await page.goto(AT_KL);

  /**
   * A refusal must not leave an empty box. The derived line is read off the
   * score object, so it costs nothing, cannot fail, and is still true — which
   * is exactly why the panel leads with it rather than with the model.
   */
  await expect(panel(page).getByText(/withheld because it referred to a figure/)).toBeVisible();
  await expect(panel(page).locator(".ai-derived")).toContainText(/scores \d+ out of 100/);
});

test("the computed sentence survives the model being unconfigured", async ({ page }) => {
  await stub(page, {
    status: 503,
    body: { error: "ai_unavailable", message: "The analysis is not configured on this deployment." },
  });
  await page.goto(AT_KL);

  await expect(panel(page).getByText(/not configured on this deployment/)).toBeVisible();
  await expect(panel(page).locator(".ai-derived")).toContainText(/scores \d+ out of 100/);

  // The deterministic core is untouched by an AI failure.
  await expect(page.getByRole("img", { name: /Success score/ })).toBeVisible();
});

test("labels what was computed separately from what was written", async ({ page }) => {
  await stub(page, { status: 200, body: BRIEFING });
  await page.goto(AT_KL);

  // Which sentences this product computes and which it generates is the
  // distinction the rest of the page rests on, so the panel states it.
  await expect(panel(page).locator(".ai-derived-tag")).toContainText(/computed from the figures/i);
});

test("the gaps tab keeps the table and no longer carries its own write-up", async ({ page }) => {
  await stub(page, { status: 200, body: BRIEFING });
  await page.goto(AT_KL);
  await page.getByRole("tab", { name: /^Gaps/ }).click();

  // The evidence stays where it was; only the interpretation moved.
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.locator(".gap-narrative")).toHaveCount(0);
});

test("reduced motion leaves nothing stranded", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await stub(page, { status: 200, body: BRIEFING });
  await page.goto(AT_KL);

  await expect(panel(page).getByText("This is a fully worked F&B street, not an opening.")).toBeVisible();

  /**
   * A `from()` tween that never runs must not leave its targets at the values
   * it would have started from. This repo has been bitten by exactly that
   * twice, and both times the element was present in the DOM and invisible.
   */
  const faded = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".ai-reveal")].filter(
      (el) => Number(getComputedStyle(el).opacity) < 0.99,
    ).length,
  );
  expect(faded).toBe(0);

  await context.close();
});
