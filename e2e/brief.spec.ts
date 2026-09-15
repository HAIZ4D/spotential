import { expect, test, type Page } from "@playwright/test";

/**
 * Spotential AI on the location page: four specialists, in the report rather
 * than behind a tab.
 *
 * The panel replaced two AI surfaces with one and moved it out of the tab bar,
 * because the gap write-up was skipped whenever no category stood out, exactly
 * when every category is saturated and the table is hardest to read. It then
 * replaced its single briefing with Opportunity, Rivals, Customers and Money,
 * each reading one section of the fact sheet.
 *
 * These tests are about what must hold through all of that: the panel is
 * always there, the computed sentence is always true, a specialist that is
 * missing is NAMED rather than dropped, and the model failing never leaves an
 * empty box.
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

const READING = (id: string, role: string, headline: string, move: string) => ({
  id,
  role,
  headline,
  points: [
    "Every one of the 6 categories compared came back saturated.",
    "The search filled its 20 result cap within 421m.",
  ],
  move,
});

/** Three ran; Customers had no section to read, because demographics 503'd. */
const READINGS = {
  kind: "readings",
  cached: false,
  readings: [
    READING(
      "opportunity",
      "Opportunity",
      "This is a fully worked F&B street, not an opening.",
      "Visit the competitor 40m away to check their peak hour pricing.",
    ),
    READING(
      "rivals",
      "Rivals",
      "The nearest rival is 40m away and shares this doorway.",
      "Walk the 40m to the nearest rival at lunchtime.",
    ),
    READING(
      "money",
      "Money",
      "Rent here is an inferred benchmark rather than a quoted figure.",
      "Get a real quoted rent for the specific unit.",
    ),
  ],
  withheld: [],
  skipped: [
    {
      id: "customers",
      role: "Customers",
      reason:
        "Neither a population catchment nor district demographics resolved for this point, so who lives within reach is not known.",
    },
  ],
};

/** All four present, for the layout assertion. */
const READINGS_FOUR = {
  ...READINGS,
  readings: [
    ...READINGS.readings.slice(0, 2),
    READING("customers", "Customers", "About 6,018 residents live within 500m.", "Count footfall at lunchtime."),
    READINGS.readings[2]!,
  ],
  skipped: [],
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
  await stub(page, { status: 200, body: READINGS });
  await page.goto(AT_KL);

  // Visible without a single click. That is the whole point of the move.
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByText("Spotential AI")).toBeVisible();

  // And the tab it used to live in is gone.
  await expect(page.getByRole("tab", { name: /^Ask/ })).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(5);
});

test("says every category is crowded, which the table alone never did", async ({ page }) => {
  await stub(page, { status: 200, body: READINGS });
  await page.goto(AT_KL);

  /**
   * The bug in one assertion. The write-up used to be skipped whenever there
   * was no top opportunity, so this exact state — six saturated categories,
   * every opportunity bar empty — produced no prose at all.
   */
  await expect(panel(page).getByText(/already crowded/)).toBeVisible();
  await expect(
    panel(page).getByText("This is a fully worked F&B street, not an opening."),
  ).toBeVisible();

  // Each specialist stays on its own subject, which is the whole reason there
  // are four of them rather than one general answer.
  const cards = panel(page).locator(".ai-spec");
  await expect(cards).toHaveCount(4);
  await expect(cards.nth(0)).toContainText("Opportunity");
  await expect(cards.nth(1)).toContainText(/nearest rival is 40m/);
  await expect(cards.nth(3)).toContainText(/inferred benchmark/);
});

test("names a specialist that had nothing to read, rather than dropping it", async ({ page }) => {
  await stub(page, { status: 200, body: READINGS });
  await page.goto(AT_KL);

  /**
   * A dropped card would leave a panel that looks complete while a whole
   * subject is missing, and the reader would have no way to know. Customers is
   * skipped here because demographics 503, which is a fact about the data
   * rather than about the model, so the card says which.
   */
  const quiet = panel(page).locator(".ai-spec.is-quiet");
  await expect(quiet).toHaveCount(1);
  await expect(quiet).toContainText("Customers");
  await expect(quiet).toContainText(/not known/);
});

test("a withheld specialist is named, and the others still render", async ({ page }) => {
  await stub(page, {
    status: 200,
    body: {
      ...READINGS,
      readings: READINGS.readings.slice(0, 2),
      withheld: [{ id: "money", role: "Money", reason: "refused" }],
    },
  });
  await page.goto(AT_KL);

  /**
   * THE CONTAINMENT CLAIM. The single briefing this replaced refused whole
   * when any field invented a figure, which was right for one object and is
   * wrong for four: a bad figure now costs one card and the card says so.
   */
  await expect(panel(page).locator(".ai-spec")).toHaveCount(4);
  await expect(panel(page).getByText(/Withheld/)).toBeVisible();
  await expect(panel(page).getByText(/nearest rival is 40m/)).toBeVisible();
});

test("the computed sentence survives every specialist being refused", async ({ page }) => {
  await stub(page, {
    status: 200,
    body: {
      ...READINGS,
      readings: [],
      withheld: [
        { id: "opportunity", role: "Opportunity", reason: "refused" },
        { id: "rivals", role: "Rivals", reason: "refused" },
        { id: "money", role: "Money", reason: "refused" },
      ],
    },
  });
  await page.goto(AT_KL);

  /**
   * A refusal must not leave an empty box. The derived line is read off the
   * score object, so it costs nothing, cannot fail, and is still true, which
   * is exactly why the panel leads with it rather than with the model.
   */
  await expect(panel(page).getByText(/Withheld/).first()).toBeVisible();
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
  await stub(page, { status: 200, body: READINGS });
  await page.goto(AT_KL);

  // Which sentences this product computes and which it generates is the
  // distinction the rest of the page rests on, so the panel states it.
  await expect(panel(page).locator(".ai-derived-tag")).toContainText(/computed from the figures/i);
});

test("the gap is discussed as advice, with actions rather than observations", async ({ page }) => {
  await stub(page, { status: 200, body: READINGS });
  await page.goto(AT_KL);

  /**
   * The Gaps tab is gone and the reading is here instead. What the owner asked
   * for is the last assertion: not more things to know, but things to do.
   */
  await expect(page.getByRole("tab", { name: /^Gaps/ })).toHaveCount(0);

  /**
   * Every specialist that ran carries ONE action, marked apart from its
   * observations. What the owner asked for is the last assertion: not more
   * things to know, but a thing to do.
   */
  const moves = panel(page).locator(".ai-spec-move");
  await expect(moves).toHaveCount(3);
  await expect(moves.first()).toContainText(/Visit the competitor/);
  await expect(panel(page).locator(".ai-spec-move-label").first()).toContainText(/Do this/i);
});

test("reduced motion leaves nothing stranded", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await stub(page, { status: 200, body: READINGS });
  await page.goto(AT_KL);

  await expect(
    panel(page).getByText("This is a fully worked F&B street, not an opening."),
  ).toBeVisible();

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

test("an older revision's reply cannot take the page down", async ({ page }) => {
  /**
   * THE CRASH THIS EXISTS TO STOP, found by a test that was about something
   * else entirely.
   *
   * A Cloud Run deploy serves two revisions at once, so a browser holding the
   * new bundle can be answered by the old one. It was: a stale service
   * returned the single briefing's `{kind: "brief"}` shape, the panel called
   * `.find` on an absent `withheld`, and the uncaught TypeError blanked the
   * ENTIRE PAGE. The score, the map and the tabs all went with it, for an AI
   * response, which is exactly what this product's structure is supposed to
   * make impossible.
   */
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(String(error)));

  await stub(page, {
    status: 200,
    body: {
      kind: "brief",
      cached: false,
      briefing: { headline: "From a previous revision.", readings: ["stale"] },
    },
  });
  await page.goto(AT_KL);

  // The deterministic core is untouched, which is the whole claim.
  await expect(page.getByRole("img", { name: /Success score/ })).toBeVisible();
  await expect(panel(page).locator(".ai-derived")).toContainText(/scores \d+ out of 100/);
  // Said plainly rather than rendered as four empty cards.
  await expect(panel(page).locator(".ai-unavailable")).toContainText(/did not come back in a form/);
  await expect(panel(page).locator(".ai-spec")).toHaveCount(0);
  expect(crashes).toEqual([]);
});

/**
 * p1-to-p99 luminance of a screenshot, decoded in the page.
 *
 * MEASURED FROM PAINTED PIXELS, never `getComputedStyle`. The panel's ground
 * is a gradient, which reports `rgba(0,0,0,0)`, so walking up the ancestors
 * sails past the navy and scores white-on-navy as a failure.
 */
async function paintedContrast(page: Page, shot: Buffer, inset = 0): Promise<number> {
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
      return (ls[Math.floor(ls.length * 0.99)]! + 0.05) / (ls[Math.floor(ls.length * 0.01)]! + 0.05);
    },
    { b64: shot.toString("base64"), inset },
  );
}

/**
 * The TEXT'S own rect, not the element's.
 *
 * A card is mostly empty ground, and how much of it the letters occupy changes
 * with the viewport, so a p1-to-p99 reading over the whole box measures the
 * background twice and reports near 1:1 on something perfectly legible.
 */
async function textRect(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    return { x: r.x, y: r.y, width: Math.max(1, r.width), height: Math.max(1, r.height) };
  });
}

test("every colour on a specialist card is legible", async ({ page }) => {
  await stub(page, { status: 200, body: READINGS });
  await page.goto(AT_KL);
  await expect(panel(page).locator(".ai-spec").first()).toBeVisible();

  /**
   * Recolouring a surface means re-checking everything sitting on it, which
   * this project has been caught by four times. These tiles are new, so each
   * state is measured on painted pixels rather than assumed from the token.
   */
  for (const [name, selector] of [
    ["role label", ".ai-spec-role"],
    ["headline", ".ai-spec-headline"],
    ["point", ".ai-spec-points li"],
    ["action label", ".ai-spec-move-label"],
    ["action", ".ai-spec-move"],
    ["absent-section note", ".ai-spec-quiet"],
  ] as const) {
    await page.locator(selector).first().scrollIntoViewIfNeeded();
    const clip = await textRect(page, selector);
    const contrast = await paintedContrast(page, await page.screenshot({ clip }));
    expect(contrast, `${name} measured ${contrast.toFixed(2)}:1`).toBeGreaterThan(4.5);
  }
});

test("lays the four specialists out two by two, never three and a stray", async ({ page }) => {
  /**
   * `auto-fit` packed three across the panel and left the fourth alone on its
   * own row, which is the one arrangement four things must never take. The
   * columns are stated now, so this asserts the GEOMETRY rather than the rule:
   * exactly two distinct left edges and exactly two distinct top edges, and
   * the two cards in a row sharing a height so their actions line up.
   */
  test.skip((page.viewportSize()?.width ?? 0) < 760, "one column by design on a phone");

  /**
   * WIDE ON PURPOSE. At the default desktop width `auto-fit` already lands on
   * two columns, so reinstating the bug here passed and the test guarded
   * nothing. The stray-fourth-card arrangement only appears once the panel is
   * wide enough for a third, which is the screen the owner was looking at.
   */
  await page.setViewportSize({ width: 1920, height: 1200 });

  await stub(page, { status: 200, body: READINGS_FOUR });
  await page.goto(AT_KL);
  await expect(panel(page).locator(".ai-spec")).toHaveCount(4);

  const geometry = () =>
    panel(page)
      .locator(".ai-spec")
      .evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), h: Math.round(r.height) };
        }),
      );

  /**
   * POLLED, because the cards arrive on a staggered `from` tween and a single
   * sample taken mid-flight reads four different tops for a grid that is
   * perfectly aligned. This file's own rule, one scale up: never take one
   * sample of a value that is still moving.
   */
  await expect
    .poll(async () => new Set((await geometry()).map((b) => b.y)).size)
    .toBe(2);

  const boxes = await geometry();
  expect(new Set(boxes.map((b) => b.x)).size).toBe(2);
  // Equal heights within a row, which is what puts every "Do this" on one line.
  expect(boxes[0]!.h).toBe(boxes[1]!.h);
  expect(boxes[2]!.h).toBe(boxes[3]!.h);
});
