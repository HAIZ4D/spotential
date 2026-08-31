import { expect, test, type Page } from "@playwright/test";

/**
 * Cross-page design invariants.
 *
 * Two things that were wrong everywhere at once, so they are checked
 * everywhere at once rather than page by page:
 *
 *   1. Controls had SEVEN different heights — 16, 20, 25, 27, 28, 31, 33px —
 *      with no scale behind them. That is most of why the app read as
 *      slightly unfinished, and it is only fixed if the tokens are actually
 *      applied rather than merely declared.
 *   2. A lone em dash stood in for missing data. It means nothing to a reader
 *      who has not been told what it means, and words are both clearer and
 *      what the PDF already does.
 *
 * Maps and Places are blocked, as everywhere else in this suite.
 */

const MAPS = "https://maps.googleapis.com/**";

const PAGES = [
  { name: "analysis", url: "/analysis?lat=3.1578&lng=101.7123&q=KLCC" },
  { name: "compare", url: "/compare?c=korean_restaurant&r=500&p=3.1478,101.6953,KL&p=3.0738,101.5183,PJ" },
  { name: "heatmap", url: "/heatmap" },
  { name: "simulator", url: "/simulator" },
];

async function stub(page: Page) {
  await page.route(MAPS, (route) => route.abort());
  await page.route("https://overpass-api.de/**", (route) => route.abort());

  await page.route("**/v1/competitors", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        competitors: [],
        summary: {
          total: 20,
          averageRating: 4.2,
          ratedCount: 20,
          totalReviews: 2000,
          nearestMetres: 40,
          operational: 20,
        },
        density: [
          { upToMetres: 250, count: 20 },
          { upToMetres: 500, count: 0 },
        ],
        fromCache: true,
        fetchedAt: Date.now(),
        radiusMetres: 500,
        truncated: true,
        completeToMetres: 142,
        searchSkipped: false,
        placesConfigured: true,
      }),
    }),
  );

  for (const path of ["**/v1/demographics", "**/v1/opportunity-gaps", "**/v1/properties*", "**/v1/amenities*", "**/v1/heatmap*"]) {
    await page.route(path, (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
    );
  }
}

/**
 * The guard that the control scale is real.
 *
 * Declaring `--control-md` changes nothing on its own; this measures what the
 * browser actually laid out. 28px is the smallest step in the scale, so
 * anything shorter is an element that never adopted it.
 */
for (const { name, url } of PAGES) {
  test(`${name}: every control meets the size scale`, async ({ page }, testInfo) => {
    await stub(page);
    await page.goto(url);
    await page.waitForTimeout(600);

    // Coarse pointers get 44px; a desktop mouse keeps the dense scale.
    const floor = testInfo.project.name === "mobile" ? 44 : 28;

    const controls = page.locator(
      "button:visible, select:visible, .tab:visible, a.cta:visible, .layer-toggle:visible",
    );
    const count = await controls.count();
    expect(count).toBeGreaterThan(0);

    const undersized: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const control = controls.nth(i);
      const box = await control.boundingBox();
      if (!box) continue;
      if (box.height < floor - 0.5) {
        undersized.push(`${(await control.innerText()).trim().slice(0, 24)} @ ${box.height}px`);
      }
    }

    expect(undersized, `controls under ${floor}px: ${undersized.join(", ")}`).toEqual([]);
  });
}

/**
 * No lone dash standing in for a value.
 *
 * Scoped to short text nodes: an em dash inside a sentence is correct
 * punctuation and stays. What must not survive is a cell or figure whose
 * entire content is a dash.
 */
for (const { name, url } of PAGES) {
  test(`${name}: no lone dash stands in for missing data`, async ({ page }) => {
    await stub(page);
    await page.goto(url);
    await page.waitForTimeout(600);

    const lone = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of Array.from(document.querySelectorAll("td, .figure, .chip-value, .dim-bar-value, .tab-badge"))) {
        const text = (el.textContent ?? "").trim();
        if (/^[—–-]$/.test(text)) bad.push(el.className || el.tagName);
      }
      return bad;
    });

    expect(lone, `lone dashes found in: ${lone.join(", ")}`).toEqual([]);
  });
}

test("missing values say what is missing, in words", async ({ page }) => {
  await stub(page);
  await page.goto("/analysis?lat=3.8077&lng=103.3260&q=Kuantan");
  await page.waitForTimeout(600);

  // Kuantan has no rent benchmark and demographics are stubbed out, so the
  // chips have genuinely nothing to show. They should say so.
  const chips = page.locator(".chip-value");
  await expect(chips.first()).toBeVisible();

  const values = await chips.allInnerTexts();
  for (const value of values) {
    expect(value.trim()).not.toBe("—");
    expect(value.trim().length).toBeGreaterThan(0);
  }
});
