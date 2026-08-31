import { expect, test, type Page } from "@playwright/test";

/**
 * Side-by-side comparison — Feature 2.
 *
 * The assertions are about restraint again: a comparison must not crown a
 * winner on noise, and must not turn "neither has data" into a tie.
 */

const MAPS = "https://maps.googleapis.com/**";

/** Distinct competitor payloads keyed by rounded latitude. */
function competitorsFor(lat: number) {
  const dense = Math.abs(lat - 3.1478) < 0.01;
  return {
    competitors: [],
    summary: {
      total: 20,
      averageRating: dense ? 4.23 : 4.08,
      ratedCount: 20,
      totalReviews: dense ? 2060 : 1740,
      nearestMetres: 60,
      operational: 20,
    },
    density: [
      { upToMetres: 250, count: 20 },
      { upToMetres: 500, count: 0 },
      { upToMetres: 1000, count: 0 },
    ],
    fromCache: true,
    fetchedAt: Date.now(),
    radiusMetres: 500,
    truncated: true,
    // The signal that separates them: same 20 outlets, very different areas.
    completeToMetres: dense ? 142 : 263,
    searchSkipped: false,
    placesConfigured: true,
  };
}

async function stub(page: Page) {
  await page.route("**/v1/competitors", (route) => {
    const body = route.request().postDataJSON() as { lat: number };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(competitorsFor(body.lat)),
    });
  });

  await page.route("**/v1/demographics", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        matched: true,
        resolution: "district",
        demographics: {
          district: "Test District",
          state: "Test",
          total: 2_000_000,
          age: Object.fromEntries(
            ["15-19","20-24","25-29","30-34","35-39","40-44","45-49","50-54","55-59","60-64"].map(
              (b) => [b, 150_000],
            ),
          ),
          ethnicity: { bumi_malay: 800_000 },
        },
        vintage: "2025",
        reviewed: "2026-08-12",
        sourceNote: "CC BY 4.0",
      }),
    }),
  );
}

const TWO =
  "/compare?c=korean_restaurant&r=500&p=3.1478,101.6953,Central KL&p=3.0738,101.5183,Suburban PJ";

test.beforeEach(async ({ page }) => {
  await page.route(MAPS, (route) => route.abort());
});

test("renders both locations and names a winner when they differ", async ({ page }) => {
  await stub(page);
  await page.goto(TWO);

  await expect(page.getByText("Location profiles")).toBeVisible();
  // Both series appear in the radar legend.
  await expect(page.getByText("Central KL").first()).toBeVisible();
  await expect(page.getByText("Suburban PJ").first()).toBeVisible();
  // The spread-out site should win on competition density, and the verdict is
  // the first thing on the page rather than a pill in a card header.
  await expect(
    page.getByRole("heading", { name: /Suburban PJ scores highest/ }),
  ).toBeVisible();
});

test("states that these are comparison scores, not forecasts", async ({ page }) => {
  await stub(page);
  await page.goto(TWO);

  await expect(page.getByText(/comparison scores, not forecasts/)).toBeVisible();
  // Feature 1e filled the rent axis in, so the caveat must describe what is
  // actually shown rather than still claiming the dimension is missing.
  await expect(page.getByText(/researched benchmarks unless you entered a quote/i)).toBeVisible();
});

test("rent is compared once a benchmark covers both locations", async ({ page }) => {
  await stub(page);
  await page.goto(TWO);

  const row = page.getByRole("row").filter({ hasText: "Rent sensitivity" });
  await expect(row.getByText("inferred").first()).toBeVisible();
  await expect(row.getByText("no data")).toHaveCount(0);
});

test("shows no data either side where no benchmark covers either location", async ({ page }) => {
  await stub(page);
  // Kuantan and Kota Bharu — both outside every curated trading area. Missing
  // on both sides must read as missing, never as a tie at zero.
  await page.goto(
    "/compare?c=korean_restaurant&r=500&p=3.8077,103.3260,Kuantan&p=6.1254,102.2381,Kota Bharu",
  );

  await expect(page.getByText("no data either side").first()).toBeVisible();
});

test("asks for a second location rather than comparing one", async ({ page }) => {
  await stub(page);
  await page.goto("/compare?c=korean_restaurant&r=500&p=3.1478,101.6953,Only One");

  await expect(page.getByText(/Add at least two locations/)).toBeVisible();
  await expect(page.getByText(/A single score means little on its own/)).toBeVisible();
});

test("reports a malformed location in the link rather than hiding it", async ({ page }) => {
  await stub(page);
  await page.goto("/compare?c=korean_restaurant&r=500&p=3.1478,101.6953,Good&p=999,101,Broken");

  await expect(page.getByText(/could not be read/)).toBeVisible();
});

test("category and radius apply to the whole comparison", async ({ page }) => {
  await stub(page);
  await page.goto(TWO);

  // One control each, not one per location — the constraint that keeps the
  // comparison commensurable.
  await expect(page.getByLabel("Business type")).toHaveCount(1);
  await expect(page.getByLabel("Search radius")).toHaveCount(1);
  await expect(page.getByText(/would not be a comparison/)).toBeVisible();
});

test("the comparison link round-trips", async ({ page }) => {
  await stub(page);
  await page.goto(TWO);
  const verdict = page.getByRole("heading", { name: /Suburban PJ scores highest/ });
  await expect(verdict).toBeVisible();

  const link = page.url();
  await page.goto("about:blank");
  await page.goto(link);

  await expect(page.getByRole("heading", { name: /Suburban PJ scores highest/ })).toBeVisible();
});

test("the simulator route is untouched", async ({ page }) => {
  await page.goto("/simulator");
  await expect(page.getByTestId("headline-profit")).toHaveText("RM 38,418");
  await expect(page.getByText("Location profiles")).toHaveCount(0);
});

/**
 * The redesign's own guarantees.
 *
 * The page moved from a sidebar-and-stacked-cards layout to the cockpit the
 * other routes use. What must survive that is not the markup but the honesty:
 * three distinct outcomes, no zero standing in for missing data, and a hero
 * that cannot disagree with the table beneath it.
 */
test("the hero verdict agrees with the table it sits above", async ({ page }) => {
  await stub(page);
  await page.goto(TWO);

  await expect(page.getByRole("heading", { name: /Suburban PJ scores highest/ })).toBeVisible();

  // The Overall row's verdict cell must name the same winner. Both read the
  // same comparison object, and this pins that they cannot drift apart.
  const overall = page.getByRole("row").filter({ hasText: "Overall" });
  await expect(overall.getByText("Suburban PJ")).toBeVisible();
});

test("names the dimension that actually decided it", async ({ page }) => {
  await stub(page);
  await page.goto(TWO);

  // Competition density is the axis these two sites differ most on.
  await expect(page.getByText(/driven mostly by competition/)).toBeVisible();
});

test("keeps the three outcomes visually distinct", async ({ page }) => {
  await stub(page);
  await page.goto(TWO);

  const dims = page.locator(".cmp-dim");
  await expect(dims.first()).toBeVisible();

  // A decided dimension draws bars; a no-data one draws none and says so.
  const noData = dims.filter({ hasText: "no data either side" });
  if ((await noData.count()) > 0) {
    await expect(noData.first().locator(".cmp-bar-fill")).toHaveCount(0);
    await expect(noData.first().locator(".cmp-empty")).toBeVisible();
  }

  // Somewhere on the page at least one dimension is drawn as bars.
  await expect(page.locator(".cmp-bar-fill").first()).toBeVisible();
});

test("draws no bar for a dimension with no data on either side", async ({ page }) => {
  await stub(page);
  // Kuantan and Kota Bharu - outside every curated trading area, so rent is
  // unavailable for both. That dimension gets an empty track and the words,
  // never two zero-length bars, which would read as a tie at 0.
  await page.goto(
    "/compare?c=korean_restaurant&r=500&p=3.8077,103.3260,Kuantan&p=6.1254,102.2381,Kota Bharu",
  );

  const rent = page.locator(".cmp-dim").filter({ hasText: "Rent sensitivity" });
  await expect(rent.locator(".cmp-empty")).toBeVisible();
  await expect(rent.locator(".cmp-bar-fill")).toHaveCount(0);
});

test("the other routes are untouched by the compare styles", async ({ page }) => {
  await stub(page);

  // The CSS is scoped under .cockpit.compare; nothing here may leak.
  await page.goto("/analysis?lat=3.1578&lng=101.7123&q=KLCC");
  await expect(page.locator(".cockpit.compare")).toHaveCount(0);
  await expect(page.locator(".cmp-hero")).toHaveCount(0);

  await page.goto("/heatmap");
  await expect(page.locator(".cockpit.heat")).toHaveCount(1);
  await expect(page.locator(".cmp-hero")).toHaveCount(0);
});
