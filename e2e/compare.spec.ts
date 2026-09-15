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

/**
 * The full table lives behind "Show every figure" now, because it holds
 * exactly the figures the ledger already shows. It is kept rather than deleted
 * because it tallies and labels each cell measured or inferred, and it is the
 * part that prints — but every test that reads a table ROW has to open it
 * first. Folding content into a `<details>` hides it from every query.
 */
async function openWorking(page: Page): Promise<void> {
  const working = page.locator(".cmpx-working");
  await working.waitFor();
  if ((await working.getAttribute("open")) === null) {
    await working.locator("summary").click();
  }
  await expect(working.locator("table")).toBeVisible();
}

test("renders both locations and names a winner when they differ", async ({ page }) => {
  await stub(page);
  await page.goto(TWO);

  await expect(
    page.getByRole("heading", { name: "Where the difference actually is" }),
  ).toBeVisible();
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

  await openWorking(page);

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

  /**
   * The LEDGER is what a reader sees; the table saying the same thing is
   * folded away. The row is marked "not scored" and draws an empty track,
   * because a tie at zero and an absence of data look identical as two
   * zero-length bars and mean opposite things.
   */
  const rent = page.locator(".cmpx-row").filter({ hasText: "Rent sensitivity" });
  await expect(rent.locator(".cmpx-outcome.absent")).toBeVisible();
  await expect(rent.locator(".cmpx-track.empty")).toBeVisible();
  await expect(rent.locator(".dim-bar-fill")).toHaveCount(0);

  // And the table below still says it in its own words.
  await openWorking(page);
  await expect(page.getByText("no data either side").first()).toBeVisible();
});

test("asks for a second location rather than comparing one", async ({ page }) => {
  await stub(page);
  await page.goto("/compare?c=korean_restaurant&r=500&p=3.1478,101.6953,Only One");

  await expect(page.getByRole("heading", { name: "Add a second location" })).toBeVisible();
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
  await openWorking(page);
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

  const rows = page.locator(".cmpx-row");
  await expect(rows.first()).toBeVisible();

  // A decided dimension draws bars; an unscored one draws none and says so.
  const absent = rows.filter({ hasText: "not scored" });
  if ((await absent.count()) > 0) {
    await expect(absent.first().locator(".dim-bar-fill")).toHaveCount(0);
    await expect(absent.first().locator(".cmpx-track.empty")).toBeVisible();
  }

  // Somewhere on the page at least one dimension is drawn as bars.
  await expect(page.locator(".cmpx-row .dim-bar-fill").first()).toBeVisible();
});

test("draws no bar for a dimension with no data on either side", async ({ page }) => {
  await stub(page);
  // Kuantan and Kota Bharu - outside every curated trading area, so rent is
  // unavailable for both. That dimension gets an empty track and the words,
  // never two zero-length bars, which would read as a tie at 0.
  await page.goto(
    "/compare?c=korean_restaurant&r=500&p=3.8077,103.3260,Kuantan&p=6.1254,102.2381,Kota Bharu",
  );

  const rent = page.locator(".cmpx-row").filter({ hasText: "Rent sensitivity" });
  await expect(rent.locator(".cmpx-track.empty")).toBeVisible();
  await expect(rent.locator(".dim-bar-fill")).toHaveCount(0);
});

test("the other routes are untouched by the compare styles", async ({ page }) => {
  await stub(page);

  // The CSS is scoped under `.cmpx`; nothing here may leak.
  await page.goto("/analysis?lat=3.1578&lng=101.7123&q=KLCC");
  await expect(page.locator(".cmpx")).toHaveCount(0);
  await expect(page.locator(".cmpx-hero")).toHaveCount(0);

  // City Demand was folded into the Location page; its old link still has to
  // land somewhere, and the comparison styling must not follow it there.
  await page.goto("/heatmap");
  await expect(page).toHaveURL(/\/analysis/);
  await expect(page.locator(".cmpx-hero")).toHaveCount(0);
});

/* ------------------------------------------------------------------ *
 * The rebuild                                                         *
 * ------------------------------------------------------------------ */

test("shows the gap, which is the question the page is asked", async ({ page }) => {
  await stub(page);
  await page.goto(TWO);
  await expect(page.locator(".cmpx-row").first()).toBeVisible();

  /**
   * THE DELTA MUST EQUAL THE BARS BESIDE IT.
   *
   * The page used to print two absolute scores per dimension and leave the
   * reader subtracting 87 from 90. The gap is a figure in its own column now,
   * read off the comparison object rather than recomputed in the view — so
   * this checks the rendered figure against the rendered values, which is the
   * only way the two could ever be caught disagreeing.
   */
  const rows = page.locator(".cmpx-row:not(.is-absent)");
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    const values = (
      await row.locator(".cmpx-bar-value").allInnerTexts()
    )
      .map((t) => Number(t.trim()))
      .filter((n) => Number.isFinite(n));
    if (values.length < 2) continue;

    const shown = Number((await row.locator(".cmpx-delta-figure").innerText()).trim());
    const actual = Math.max(...values) - Math.min(...values);
    const label = await row.locator(".cmpx-dim").innerText();

    // The bar values are rounded for display and the gap is not, so a whole
    // point of slack is the rounding rather than a disagreement.
    expect(Math.abs(shown - actual), `${label}: shows ${shown}, bars differ by ${actual}`)
      .toBeLessThanOrEqual(1);
  }
});

test("explains an unscored dimension ONCE, not once per dimension", async ({ page }) => {
  /**
   * A fixture that actually WITHHOLDS data, rather than the shared stub, which
   * answers demographics for any point and so leaves only rent unscored. The
   * case this test is about needs more than one unscored dimension to exist.
   */
  await stub(page);
  // Registered AFTER the shared stub so it wins: Playwright gives precedence
  // to the most recently added route. Withholding demographics is what makes a
  // second dimension go unscored.
  await page.route("**/v1/demographics", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
  );

  // Outside every curated trading area too, so rent goes with them.
  await page.goto(
    "/compare?c=korean_restaurant&r=500&p=3.8077,103.3260,Kuantan&p=6.1254,102.2381,Kota Bharu",
  );
  await expect(page.locator(".cmpx-row").first()).toBeVisible();

  /**
   * This sentence used to print in full inside every unscored row. With three
   * of five unscored it became the largest block of text on the page while
   * saying one thing, three times.
   */
  const absent = await page.locator(".cmpx-row.is-absent").count();

  /**
   * ASSERTED, not assumed. The first version of this test guarded the whole
   * thing behind `if (absent > 1)`, and under this file's stub the default
   * comparison has exactly ONE unscored dimension — so the branch never ran
   * and the test passed happily with the bug reinstated. A test named for an
   * invariant that quietly skips itself is worse than no test.
   */
  expect(absent, "fixture no longer exercises the repeated-sentence case").toBeGreaterThan(1);

  await expect(
    page.getByText(/excluded from both totals rather than counted as zero/),
  ).toHaveCount(1);

  // And every unscored row still says so itself, briefly.
  await expect(page.locator(".cmpx-row.is-absent .cmpx-outcome.absent")).toHaveCount(absent);
});

test("plots only the axes that carry data", async ({ page }) => {
  await stub(page);
  await page.goto(TWO);
  await expect(page.locator(".cmpx-row").first()).toBeVisible();

  /**
   * A pentagon with spokes pinned at the centre does not read as "unmeasured",
   * it reads as two bad locations — the misreading that removed the radar from
   * /analysis. Unscored axes are left off and the panel says how many.
   */
  const scored = await page.locator(".cmpx-row:not(.is-absent)").count();
  const absent = await page.locator(".cmpx-row.is-absent").count();

  if (absent > 0 && scored >= 3) {
    await expect(page.getByText(/left off rather than plotted at zero/)).toBeVisible();
  }
  if (scored < 3) {
    // Below three axes there is no polygon to draw, so it says so in words.
    await expect(page.locator(".cmpx-noshape")).toBeVisible();
  }
});

test("folds the full table away rather than repeating the ledger", async ({ page }) => {
  await stub(page);
  await page.goto(TWO);

  const working = page.locator(".cmpx-working");
  await expect(working).toBeVisible();
  // Closed by default: it holds exactly the figures above it. It survives
  // because it tallies and labels every cell measured or inferred.
  await expect(working.locator("table")).toBeHidden();

  await working.locator("summary").click();
  await expect(working.locator("table")).toBeVisible();
});

test("never pushes the comparison sideways", async ({ page }) => {
  await stub(page);
  await page.goto(TWO);
  await expect(page.locator(".cmpx-row").first()).toBeVisible();

  /**
   * On a phone the old table was 482px inside a 358px window. It scrolled, so
   * nothing was technically broken, but values read as truncated: "3" for 35,
   * "measure" for measured, the verdict column entirely off screen.
   */
  const overflow = await page.evaluate(
    () => document.body.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // And the ledger itself is not a horizontal scroller standing in for a layout.
  const scrollers = await page.locator(".cmpx-ledger").evaluateAll((els) =>
    els.filter((e) => e.scrollWidth > e.clientWidth + 1).length,
  );
  expect(scrollers).toBe(0);
});

/* ------------------------------------------------------------------ *
 * Spotential AI                                                       *
 * ------------------------------------------------------------------ */

const READINGS = {
  kind: "readings",
  cached: false,
  withheld: [] as { id: string; role: string; reason: string }[],
  readings: [
    {
      id: "analyst",
      role: "Analyst",
      headline: "The sites differ far more in crowding than in anything else.",
      points: ["Both searches filled the 20-result cap, so each count is a floor."],
    },
    {
      id: "skeptic",
      role: "Skeptic",
      headline: "Three of five dimensions could not be scored.",
      points: ["Rent is inferred from a benchmark rather than a quote."],
    },
    {
      id: "advisor",
      role: "Advisor",
      headline: "Get a written rent quote before treating either score as settled.",
      points: ["Walk to the nearest rival at the hour you plan to trade."],
    },
  ],
};

async function stubAI(page: Page, body: unknown, status = 200) {
  await page.route("**/v1/compare/brief", (route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }),
  );
}

test("still says something true when the model is unreachable", async ({ page }) => {
  await stub(page);
  await stubAI(page, { error: "ai_unavailable" }, 503);
  await page.goto(TWO);

  /**
   * THE PROPERTY THE WHOLE PANEL RESTS ON.
   *
   * The first line is derived from the comparison object: it costs nothing and
   * cannot fail, so an unreachable model, a guard refusal or a deployment with
   * no Gemini key all still leave a reader with something true. If this ever
   * depended on the model, a bad day would empty the panel entirely.
   */
  await expect(page.locator(".cmpai-derived")).toBeVisible();
  await expect(page.locator(".cmpai-derived")).toContainText(/dimensions|scores highest|spread/);

  // And the failure names itself rather than looking like a bug.
  await expect(page.getByText(/could not be reached/)).toBeVisible();
});

test("renders three specialists, each with its own job", async ({ page }) => {
  await stub(page);
  await stubAI(page, READINGS);
  await page.goto(TWO);

  await expect(page.locator(".cmpai-card")).toHaveCount(3);
  for (const role of ["Analyst", "Skeptic", "Advisor"]) {
    await expect(page.getByRole("heading", { name: role })).toBeVisible();
  }
  // Each says what it is for, so three cards read as three views rather than
  // one long argument split into thirds.
  await expect(page.getByText("what would change this answer")).toBeVisible();
});

test("NAMES a withheld specialist rather than quietly showing fewer", async ({ page }) => {
  await stub(page);
  await stubAI(page, {
    ...READINGS,
    readings: READINGS.readings.slice(0, 2),
    withheld: [{ id: "advisor", role: "Advisor", reason: "refused" }],
  });
  await page.goto(TWO);

  // A shorter panel that looks complete is worse than one that says a view is
  // missing, and this is the reason the agents are separate calls at all.
  await expect(page.locator(".cmpai-card")).toHaveCount(2);
  await expect(page.locator(".cmpai-withheld")).toContainText("Advisor");
  await expect(page.locator(".cmpai-withheld")).toContainText(/did not measure/);
});

test("labels what was generated, next to what was computed", async ({ page }) => {
  await stub(page);
  await stubAI(page, READINGS);
  await page.goto(TWO);

  // Which sentences this product computes and which it generates is the
  // distinction the rest of the page rests on.
  await expect(page.getByText(/Written by Spotential AI from the figures on this page/)).toBeVisible();
  await expect(page.getByText(/the comparison itself is computed, not generated/)).toBeVisible();
});

test("says plainly that it cannot move the controls", async ({ page }) => {
  await stub(page);
  await stubAI(page, READINGS);
  await page.goto(TWO);

  /**
   * The reader-facing half of the answer-only decision. The server half is
   * that the route offers the model no tool to do it, which a unit test pins.
   */
  await expect(page.getByText(/cannot change the business type or the radius/)).toBeVisible();
  await expect(page.getByText(/cannot work out a figure of its own/)).toBeVisible();
});

/* ------------------------------------------------------------------ *
 * Surviving navigation                                                *
 * ------------------------------------------------------------------ */

test("a shared link BEATS whatever was saved", async ({ page }) => {
  await stub(page);

  /**
   * THE ONE THAT COULD ACTUALLY HARM SOMEBODY, which is why it is first.
   *
   * Someone opening a link you sent them must see YOUR comparison, not
   * whatever they happened to be looking at earlier. A restore that silently
   * overrode the URL would show them two sites they never chose, under a
   * heading that says the link is shareable.
   */
  await page.goto(TWO);
  await expect(page.getByText("Central KL").first()).toBeVisible();

  // A different comparison arrives by link while a saved one exists.
  await page.goto(
    "/compare?c=korean_restaurant&r=500&p=3.8077,103.3260,Kuantan&p=6.1254,102.2381,Kota Bharu",
  );

  await expect(page.getByText("Kuantan").first()).toBeVisible();
  await expect(page.getByText("Kota Bharu").first()).toBeVisible();
  // And not a trace of the saved one.
  await expect(page.getByText("Central KL")).toHaveCount(0);
});

test("survives leaving the page and coming back", async ({ page }) => {
  /**
   * DESKTOP ONLY, deliberately. Below 900px the nav links sit inside the
   * hamburger drawer, and this file already records why a test about
   * something else must not drive that drawer: it raced the page's own
   * re-renders, passed in isolation and failed about one run in twelve under
   * load. The drawer is covered properly in `navbar.spec`.
   *
   * The mobile half of this behaviour is the test below, which arrives at a
   * bare `/compare` — which is exactly what the drawer's link is anyway.
   */
  test.skip((page.viewportSize()?.width ?? 0) < 900, "nav links are in the drawer");

  await stub(page);
  await page.goto(TWO);
  await expect(page.locator(".cmpx-row").first()).toBeVisible();

  // Driven the way a person does it: the nav, not a scripted URL.
  await page.getByRole("link", { name: "Events", exact: true }).click();
  await expect(page).toHaveURL(/\/events/);

  await page.getByRole("link", { name: "Compare", exact: true }).click();
  await expect(page).toHaveURL(/\/compare/);

  // Both sites still there, and the address bar carries them again, so the
  // link stays shareable after a restore rather than being a dead /compare.
  await expect(page.getByText("Central KL").first()).toBeVisible();
  await expect(page.getByText("Suburban PJ").first()).toBeVisible();
  expect(page.url()).toMatch(/[?&]p=/);
});

test("survives a refresh", async ({ page }) => {
  await stub(page);
  await page.goto(TWO);
  await expect(page.locator(".cmpx-row").first()).toBeVisible();

  // Straight to a bare /compare, which is what the nav link is.
  await page.goto("/compare");
  await expect(page.getByText("Central KL").first()).toBeVisible();
});

test("a first-ever visit still asks for a second location", async ({ page }) => {
  await stub(page);

  // Nothing saved: the empty state has to survive the restore, or a new
  // reader lands on an empty shell with no idea what to do.
  await page.goto("/compare");
  await expect(page.getByRole("heading", { name: "Add a second location" })).toBeVisible();
});

test("degrades rather than breaking when storage is refused", async ({ page }) => {
  /**
   * Private browsing throws on access rather than returning null, and the
   * accessor itself is what throws. Losing the saved list is a degraded flow;
   * a page that will not render is a broken one.
   */
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", {
      get() {
        throw new Error("storage is blocked");
      },
    });
  });
  await stub(page);

  await page.goto(TWO);
  // The URL still carries everything, so the page works exactly as before.
  await expect(page.getByText("Central KL").first()).toBeVisible();
  await expect(page.locator(".cmpx-row").first()).toBeVisible();
});

/* ------------------------------------------------------------------ *
 * The navy panel, and waiting for an answer                           *
 * ------------------------------------------------------------------ */

/**
 * p1-to-p99 luminance of a screenshot, decoded in the page.
 *
 * MEASURED FROM PAINTED PIXELS, never `getComputedStyle`. The panel's ground
 * is a gradient, which reports `rgba(0,0,0,0)`, so walking up the ancestors
 * sails past the navy and scores white-on-navy as a failure. A first attempt
 * at this compared colour STRINGS instead and passed on `rgba(255,255,255,
 * 0.08)` because the text contained "255" — the same mistake as reading a blue
 * channel as an alpha, which this project has already paid for once.
 *
 * Inset, because a pill's rounded ends show the panel behind them and those
 * corner pixels otherwise supply the whole range on their own.
 */
async function textRect(page: Page, selector: string) {
  /**
   * The TEXT'S own rect, not the element's.
   *
   * A heading's box is mostly empty ground, and how much of it the letters
   * occupy changes with the viewport — so a p1-to-p99 reading over the whole
   * box measures the background twice and reports near-1:1 on a page that is
   * perfectly legible. The desktop run passed and the 412px one came back at
   * 1.24:1 for white-on-navy. `navshell.spec` already records this: sample the
   * text rect via a Range, or a 1% tail lands in the antialiasing.
   */
  return page.locator(selector).first().evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    return { x: r.x, y: r.y, width: Math.max(1, r.width), height: Math.max(1, r.height) };
  });
}

async function paintedContrast(page: Page, shot: Buffer, inset = 0.12): Promise<number> {
  return page.evaluate(
    async ({ b64, inset }) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);

      const ix = Math.floor(img.width * inset);
      const iy = Math.floor(img.height * inset);
      const data = ctx.getImageData(
        ix,
        iy,
        Math.max(1, img.width - 2 * ix),
        Math.max(1, img.height - 2 * iy),
      ).data;

      const lin = (v: number) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      const ls: number[] = [];
      for (let i = 0; i < data.length; i += 4) {
        ls.push(0.2126 * lin(data[i]!) + 0.7152 * lin(data[i + 1]!) + 0.0722 * lin(data[i + 2]!));
      }
      ls.sort((a, b) => a - b);
      const lo = ls[Math.floor(ls.length * 0.01)]!;
      const hi = ls[Math.floor(ls.length * 0.99)]!;
      return (hi + 0.05) / (lo + 0.05);
    },
    { b64: shot.toString("base64"), inset },
  );
}

test("every colour on the navy panel is legible", async ({ page }) => {
  await stub(page);
  await stubAI(page, READINGS);
  await page.goto(TWO);
  await expect(page.locator(".cmpai-readings")).toBeVisible();

  // Filled, so the send button is measured ENABLED rather than in its
  // disabled state, which is a different colour entirely.
  await page.locator("#cmpai-question").fill("Which is the safer bet?");

  for (const [name, selector] of [
    ["derived line", ".cmpai-derived"],
    ["panel heading", ".cmpai .cmpx-panel-head h2"],
    ["ask label", ".cmpai-ask-label"],
    ["provenance note", ".cmpai-label"],
  ] as const) {
    /**
     * CENTRED, not merely "in view".
     *
     * `scrollIntoViewIfNeeded` parks an element at the TOP of the viewport,
     * which on this site is underneath the sticky navbar — and a screenshot
     * captures whatever is painted at those coordinates, navbar included. That
     * is navy over navy, so a perfectly legible white heading measured 1.24:1
     * and the desktop run passed only because the page was short enough not to
     * scroll. Centring puts clear air around the text.
     */
    await page.locator(selector).first().evaluate((el) =>
      el.scrollIntoView({ block: "center" }),
    );
    await page.waitForTimeout(250);
    const clip = await textRect(page, selector);
    // No inset: the clip is already the letters, so trimming it would throw
    // away the very pixels being measured.
    const contrast = await paintedContrast(page, await page.screenshot({ clip }), 0);
    expect(contrast, `${name} measured ${contrast.toFixed(2)}:1`).toBeGreaterThan(4.5);
  }

  /**
   * The button is measured as a BOX rather than as text, because what matters
   * there is the label against its own gold fill. Inset, since a pill's
   * rounded ends show the navy panel behind them and those corner pixels would
   * otherwise supply the entire range on their own.
   */
  await page.locator(".cmpai-ask-form button").evaluate((el) =>
    el.scrollIntoView({ block: "center" }),
  );
  await page.waitForTimeout(250);
  const button = await paintedContrast(
    page,
    await page.locator(".cmpai-ask-form button").screenshot(),
    0.28,
  );
  expect(button, `ask button measured ${button.toFixed(2)}:1`).toBeGreaterThan(4.5);
});

test("the example chips stay readable when hovered", async ({ page }) => {
  await stub(page);
  await stubAI(page, READINGS);
  await page.goto(TWO);
  await expect(page.locator(".cmpai-readings")).toBeVisible();

  /**
   * Hover is a real state to check on a navy panel, and on a phone it is the
   * state a tap LEAVES a control in.
   *
   * Not, as first written, because the app-wide `button:hover` threatens this
   * chip: measured, it does not. The base rule is `.cmpai .cmpai-examples
   * button` (0,2,1) and `button:hover` is (0,1,1), so `--surface` never
   * reaches it. That selector has erased five other controls in this app
   * precisely because they were not written at that specificity, so what this
   * asserts is the outcome rather than the mechanism: whatever hover paints,
   * the label stays readable.
   */
  const chip = page.locator(".cmpai-examples button").first();
  const box = (await chip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(350);

  const contrast = await paintedContrast(page, await chip.screenshot(), 0.3);
  expect(contrast, `hovered chip measured ${contrast.toFixed(2)}:1`).toBeGreaterThan(4.5);
});

test("shows an honest waiting state while the answer is coming", async ({ page }) => {
  await stub(page);
  await stubAI(page, READINGS);
  // Held open, so the in-flight state can be observed rather than raced.
  await page.route("**/v1/compare/ask", () => {});
  await page.goto(TWO);
  await expect(page.locator(".cmpai-readings")).toBeVisible();

  await expect(page.locator(".aiwait")).toHaveCount(0);

  await page.locator("#cmpai-question").fill("Which is the safer bet?");
  await page.getByRole("button", { name: "Ask" }).click();

  const waiting = page.locator(".aiwait");
  await expect(waiting).toBeVisible();
  // Announced, not just drawn: a spinner nobody can hear is not feedback.
  await expect(waiting).toHaveAttribute("role", "status");

  /**
   * NO INVENTED PROGRESS. There are no progress callbacks from the model, so a
   * bar or a percentage would be measuring nothing. What it says instead is
   * what actually happens: the answer comes from this page's figures and every
   * number in it is checked against them first.
   */
  await expect(waiting).toContainText(/checking every number/);
  await expect(waiting.locator("progress")).toHaveCount(0);
  await expect(waiting).not.toContainText(/%/);
});

test("clears the waiting state once the answer lands", async ({ page }) => {
  await stub(page);
  await stubAI(page, READINGS);
  await page.route("**/v1/compare/ask", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ kind: "answer", text: "Neither site separates on this evidence." }),
    }),
  );
  await page.goto(TWO);
  await expect(page.locator(".cmpai-readings")).toBeVisible();

  await page.locator("#cmpai-question").fill("Which is the safer bet?");
  await page.getByRole("button", { name: "Ask" }).click();

  await expect(page.locator(".cmpai-reply")).toContainText("Neither site separates");
  // A waiting state left behind would say it is still working when it is not.
  await expect(page.locator(".aiwait")).toHaveCount(0);
});
