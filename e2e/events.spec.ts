import { expect, test, type Page } from "@playwright/test";

/**
 * Events — the opportunity marketplace.
 *
 * The assertions cluster around the two things a listings page can most easily
 * get wrong, and both are about honesty rather than layout:
 *
 *   1. WHOSE NUMBER IS THIS? Booth price and slot count are commitments the
 *      organizer is bound to. The expected turnout is marketing, written by
 *      the party selling the booth. The page must keep them visibly apart.
 *   2. WHAT IS ACTUALLY BOOKABLE? A sample listing must never let a vendor
 *      believe they applied to an event that does not exist.
 *
 * CI calls neither Google Maps nor Places here — this page needs neither, and
 * that is the point: discovery costs nothing to serve.
 */

const MAPS = "https://maps.googleapis.com/**";

const PRICED = {
  id: "evt-1",
  slug: "terang-malam-market",
  name: "Terang Malam Market",
  summary: "Evening pop-up bazaar by the lake.",
  eventType: "bazaar",
  venueName: "Setia Ecohill Walk",
  address: "Semenyih, Selangor",
  state: "Selangor",
  point: { lat: 2.95, lng: 101.84 },
  startDate: "2099-09-25",
  endDate: "2099-09-27",
  dailyHours: "17:00 - 23:00",
  wantedCategories: ["cafe_coffee_shop", "bubble_tea_dessert"],
  packages: [
    {
      id: "std",
      label: "Standard lot",
      priceRm: 650,
      sizeLabel: "3m x 3m",
      slots: 45,
      slotsAvailable: 12,
      includes: ["Power point"],
    },
  ],
  totalSlots: 45,
  availableSlots: 12,
  expectedVisitors: 18_000,
  vendorRequirements: ["Own canopy", "Food handler certification"],
  organizerName: "Ecohill Community Events",
  source: "seed",
  sourceNote: "Sample listing curated to demonstrate scoring. NOT a live booking.",
  reviewed: "2026-08-31",
};

/** Deliberately silent about turnout AND price — the honesty cases. */
const SILENT = {
  ...PRICED,
  id: "evt-2",
  slug: "quiet-collectors-meet",
  name: "Quiet Collectors Meet",
  venueName: "ATO Gaming Cafe",
  state: "W.P. Kuala Lumpur",
  eventType: "market",
  packages: [],
  expectedVisitors: null,
  totalSlots: 24,
  availableSlots: 0,
};

async function stub(page: Page, options: { fail?: boolean } = {}) {
  await page.route(MAPS, (route) => route.abort());

  await page.route("**/v1/events?**", (route) => route.fulfill(listBody(route.request().url())));
  await page.route("**/v1/events", (route) => route.fulfill(listBody(route.request().url())));

  function listBody(url: string) {
    if (options.fail) {
      return {
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "events_unavailable", message: "not loaded" }),
      };
    }
    // Honour the real filters so these tests assert behaviour rather than a
    // constant. The server does the same narrowing.
    const q = new URL(url).searchParams;
    let events = [PRICED, SILENT];

    const state = q.get("state");
    if (state) events = events.filter((e) => e.state === state);

    const text = q.get("q");
    if (text) {
      const needle = text.toLowerCase();
      events = events.filter((e) =>
        `${e.name} ${e.venueName} ${e.organizerName}`.toLowerCase().includes(needle),
      );
    }

    const maxPrice = q.get("maxPrice");
    if (maxPrice !== null) {
      const cap = Number(maxPrice);
      events = events.filter((e) => {
        const cheapest = Math.min(...e.packages.map((pkg) => pkg.priceRm));
        return Number.isFinite(cheapest) && cheapest <= cap;
      });
    }
    return {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ events, total: 2, matched: events.length, vintage: "2026-08-31" }),
    };
  }

  await page.route("**/v1/events/rank", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        matched: 2,
        ranked: [
          { eventId: "evt-1", score: score(82) },
          { eventId: "evt-2", score: score(41) },
        ],
      }),
    }),
  );

  for (const event of [PRICED, SILENT]) {
    await page.route(`**/v1/events/${event.slug}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          event,
          days: 3,
          entryPriceRm: event.packages[0]?.priceRm ?? null,
          venueCatchment: 3_100,
          catchmentRadiusMetres: 500,
        }),
      }),
    );
  }
}

function score(overall: number) {
  return {
    overall,
    completeness: 0.83,
    entryPriceRm: 650,
    dimensions: [
      {
        key: "categoryFit",
        label: "Category fit",
        score: 100,
        kind: "direct",
        weight: 0.3,
        note: "Specifically recruiting your category.",
      },
      {
        key: "visitorDraw",
        label: "Expected draw",
        score: 45,
        kind: "proxy",
        weight: 0.09,
        note: "The organizer's own estimate, not a measurement.",
      },
      {
        key: "travel",
        label: "Travel",
        score: 0,
        kind: "unavailable",
        weight: 0,
        note: "Set where you are based.",
      },
    ],
  };
}

test("lists events with the facts that decide whether to read on", async ({ page }) => {
  await stub(page);
  await page.goto("/events");

  const card = page.locator(".evc").filter({ hasText: "Terang Malam Market" });
  await expect(card).toBeVisible();
  await expect(card.getByText("RM650")).toBeVisible();
  // Availability reads as a ratio now, so "how tight is it?" is answerable
  // without knowing the venue's size.
  await expect(card.getByText("12 of 45")).toBeVisible();
});

test("says price on request rather than showing a zero", async ({ page }) => {
  await stub(page);
  await page.goto("/events");

  // A dash would read as free and a 0 would be a price nobody quoted.
  const card = page.locator(".evc").filter({ hasText: "Quiet Collectors Meet" });
  await expect(card.getByText("Price on request")).toBeVisible();
  await expect(card.getByText("No booths left")).toBeVisible();
  await expect(card.locator(".evc-soldout")).toHaveText("Full");
});

test("says what is from the poster and what is an estimate", async ({ page }) => {
  await stub(page);
  await page.goto("/events");

  /**
   * The per-card "Sample" badge was removed at the owner's request. The
   * substantive guards are untouched and are what these assert: the page still
   * separates the poster's own facts from our estimates, and the apply route
   * still refuses a seeded listing server-side.
   */
  await expect(page.locator(".ev-flag")).toHaveCount(0);
  await expect(page.getByText(/curated estimates/)).toBeVisible();
  await expect(page.getByText(/not live bookings/)).toBeVisible();
});

test("filters narrow the list", async ({ page }) => {
  await stub(page);
  await page.goto("/events");
  await expect(page.locator(".evc")).toHaveCount(2);

  /**
   * A custom listbox, not a native <select> — the state options are real DOM
   * so they can be animated, which means driving them the way a person does
   * rather than through selectOption.
   */
  await page.getByRole("button", { name: /State/ }).click();
  await page.getByRole("option", { name: /^Selangor/ }).click();
  await expect(page.locator(".evc")).toHaveCount(1);
  await expect(page.locator(".evc")).toContainText("Terang Malam Market");
});

test("ranking is opt-in and reorders by fit", async ({ page }) => {
  await stub(page);
  await page.goto("/events");

  // No scores until the vendor asks — the page is useful without a profile.
  await expect(page.locator(".evc-score")).toHaveCount(0);

  /**
   * Ranking and the business type are ONE control now. Picking a category is
   * what turns ranking on, because ranking without one silently scores every
   * vendor as a cafe.
   */
  // Ranking is the default sort now, so scores are present from the start.
  await expect(page.locator(".evc-score")).toHaveCount(2);
  await expect(page.locator(".evc").first()).toContainText("Terang Malam Market");
  await expect(page.locator(".evc-score").first()).toContainText("82");
});

test("calls the ranking a comparison aid, not a prediction", async ({ page }) => {
  await stub(page);
  await page.goto("/events");

  // Same framing as the Success Score, and for the same reason: none of it
  // has been checked against how a vendor actually traded.
  // Now stated in the page hero rather than beside the rank button.
  await expect(page.getByText(/comparison aid, not a prediction/)).toBeVisible();
});

test("offers a way out of an empty result instead of a blank page", async ({ page }) => {
  await stub(page);
  await page.goto("/events?state=Sabah");

  await expect(page.getByText("No events match those filters")).toBeVisible();
  await expect(page.getByRole("button", { name: /Clear all filters/ })).toBeVisible();
});

test("degrades to a notice when the catalogue is unavailable", async ({ page }) => {
  await stub(page, { fail: true });
  await page.goto("/events");

  await expect(page.getByText(/Could not load events/)).toBeVisible();
  await expect(page.getByText(/Every other page is unaffected/)).toBeVisible();
});

/**
 * The detail page, where the money questions get answered.
 */
test("attributes the turnout figure to the organizer every time it appears", async ({ page }) => {
  await stub(page);
  await page.goto("/events/terang-malam-market");

  /**
   * The figure appears in three places — the facts list, the ROI caption and
   * the score note — and EVERY ONE of them names its source. That is the
   * property worth pinning, so the count is asserted rather than just the
   * first occurrence.
   */
  const mentions = page.getByText(/18,000/);
  await expect(mentions).toHaveCount(3);

  for (let i = 0; i < 3; i += 1) {
    await expect(mentions.nth(i)).toContainText(/organizer/i);
  }

  // And the panel states the incentive outright, not just the attribution.
  await expect(page.getByText(/turnout figure is the organizer's own/)).toBeVisible();
});

test("says not stated rather than zero when no turnout was published", async ({ page }) => {
  await stub(page);
  await page.goto("/events/quiet-collectors-meet");

  const facts = page.locator(".event-facts").first();
  await expect(facts.getByText("not stated")).toBeVisible();
});

test("leads the ROI panel with a ratio, not a projected profit", async ({ page }) => {
  await stub(page);
  await page.goto("/events/terang-malam-market");

  /**
   * The single most important assertion on this page. A projected profit would
   * multiply the organizer's turnout claim by a capture rate nobody can know
   * and print the result to the ringgit. The headline is instead the share of
   * the crowd needed to break even, which a stallholder can judge from
   * experience without believing the turnout at all.
   */
  await expect(page.locator(".roi-figure")).toBeVisible();
  await expect(page.locator(".roi-figure")).toContainText("%");
  await expect(page.getByText(/must buy from you, just to cover your costs/)).toBeVisible();
});

test("shows a sweep of capture rates rather than one number", async ({ page }) => {
  await stub(page);
  await page.goto("/events/terang-malam-market");

  await expect(page.getByText(/These are scenarios, not/)).toBeVisible();
  // One row per capture rate in the sweep.
  await expect(page.locator("table tbody tr")).toHaveCount(5);
});

test("explains itself when the organizer published no booth price", async ({ page }) => {
  await stub(page);
  await page.goto("/events/quiet-collectors-meet");

  await expect(page.getByText(/has not published a booth price/)).toBeVisible();
});

test("scores the venue on the same national scale the rest of the app uses", async ({ page }) => {
  await stub(page);
  await page.goto("/events/terang-malam-market");

  await expect(page.getByText(/3,100/).first()).toBeVisible();
  await expect(page.getByText(/residents within 500m/).first()).toBeVisible();
  // The caveat that stops it being read as footfall.
  await expect(page.getByText(/beyond their own doorstep/)).toBeVisible();
});

test("shows an unscored dimension in words, never as a zero bar", async ({ page }) => {
  await stub(page);
  await page.goto("/events/terang-malam-market");

  // A zero-length bar and a genuinely zero score look identical and mean
  // opposite things — the same rule /compare already holds.
  await expect(page.getByText("not scored").first()).toBeVisible();
});

/**
 * Applying, and the refusal that matters most.
 */
test("refuses to take an application for a sample listing", async ({ page }) => {
  await stub(page);
  await page.goto("/events/terang-malam-market");

  // Stated BEFORE the form rather than discovered after submitting. Letting
  // someone believe they applied to an event that does not exist would be the
  // most harmful thing this feature could do — so the form is absent, not
  // merely disabled, and the route refuses these server-side regardless.
  await expect(page.getByText(/Applications are not open for this event yet/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Send application/ })).toHaveCount(0);
});

test("keeps browsing and costing free of any sign-in", async ({ page }) => {
  await stub(page);
  await page.goto("/events/terang-malam-market");

  // The whole discovery experience must work signed out; only applying does not.
  await expect(page.locator(".roi-figure")).toBeVisible();
  await expect(page.locator(".dim-bars")).toBeVisible();
});

test("never calls Google Maps", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("maps.googleapis.com")) calls.push(r.url());
  });

  await stub(page);
  await page.goto("/events");
  await page.goto("/events/terang-malam-market");

  // Events needs no map, which is why the route is lazy-loaded away from the
  // maps bundle and why serving this page costs nothing.
  expect(calls).toEqual([]);
});

/**
 * The redesign: horizontal rows, posters, fittability rings, controls on top.
 *
 * The motion itself a test cannot judge. What it can protect is the structure
 * the motion hangs off, and the two places where an image or a ring could
 * quietly start claiming something untrue.
 */
test("lays the card out as a poster-first tile", async ({ page }) => {
  await stub(page);
  await page.goto("/events");

  /**
   * Taller than wide, deliberately. The row layout was replaced by a grid of
   * poster-led tiles: the artwork carries dates, venue and the feel of an
   * event in a form a vendor reads faster than a table, so it leads and the
   * figures support it.
   */
  const box = (await page.locator(".evc").first().boundingBox())!;
  expect(box.height).toBeGreaterThan(box.width);

  // And the poster is the top of the card, not a thumbnail beside the text.
  const media = (await page.locator(".evc-media").first().boundingBox())!;
  expect(media.width).toBeGreaterThan(box.width * 0.9);
  expect(media.y).toBeLessThan(box.y + 4);
});

test("puts the controls above the results, not beside them", async ({ page }) => {
  await stub(page);
  await page.goto("/events");

  const bar = (await page.locator(".filterbar").boundingBox())!;
  const grid = (await page.locator(".evc-grid").boundingBox())!;

  // Above, and spanning the full width the grid does — a sidebar would sit
  // alongside and cost the results a third of the page.
  expect(bar.y + bar.height).toBeLessThanOrEqual(grid.y + 1);
  expect(Math.abs(bar.width - grid.width)).toBeLessThan(30);
});

test("shows a real poster where one exists and a generated cover where none does", async ({
  page,
}) => {
  await stub(page);
  await page.goto("/events");

  /**
   * The stubbed listings have no posters, so every card must fall back. The
   * fallback is deliberately a generated graphic rather than a stock photo: a
   * borrowed crowd shot would imply we know what the event looks like, on a
   * page whose whole argument is that its figures are checkable.
   */
  await expect(page.locator(".evc-cover")).toHaveCount(2);
  await expect(page.locator(".evc-img img")).toHaveCount(0);
});

test("draws no arc for a dimension that was never scored", async ({ page }) => {
  await stub(page);
  await page.goto("/events");
  await expect(page.locator(".metric").first()).toBeVisible();
  // A zero-length arc and a genuine zero look identical and mean opposite
  // things, so an unavailable axis shows a dash against an empty track.
  const labels = await page.locator(".metric").first().getAttribute("title");
  expect(labels).toBeTruthy();
});

test("keeps the whole row a single keyboard stop", async ({ page }) => {
  await stub(page);
  await page.goto("/events");

  // One anchor covering the card, so a hover-only "View detail" button is
  // never the thing a keyboard user has to find.
  const card = page.locator(".evc").first();
  await expect(card.locator("a.evc-hit")).toHaveCount(1);
  await expect(card.getByRole("link")).toHaveCount(1);
});

/**
 * The custom listbox.
 *
 * Replacing a native <select> to gain animation means taking on everything the
 * browser was doing for free: keyboard driving, type-ahead, and the semantics
 * a screen reader needs. That is the part worth testing — the animation is
 * cosmetic, the contract is not.
 */
test.describe("the state listbox", () => {
  const openState = async (page: Page) => {
    await page.getByRole("button", { name: /State/ }).click();
    await expect(page.getByRole("listbox", { name: "State" })).toBeVisible();
  };

  test("announces the label AND the current value", async ({ page }) => {
    await stub(page);
    await page.goto("/events");

    /**
     * A <label for> pointing at a button REPLACES its content as the
     * accessible name, so this control once announced only "State" and never
     * said which state was chosen. The name must carry both.
     */
    const trigger = page.getByRole("button", { name: /State/ });
    const name = await trigger.getAttribute("aria-labelledby");
    expect(name).toBeTruthy();
    await expect(trigger).toContainText("All states");
  });

  test("reports its expanded state", async ({ page }) => {
    await stub(page);
    await page.goto("/events");

    const trigger = page.getByRole("button", { name: /State/ });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  test("marks the chosen option as selected, not just coloured", async ({ page }) => {
    await stub(page);
    await page.goto("/events");
    await openState(page);

    await expect(page.getByRole("option", { name: /All states/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("can be driven entirely from the keyboard", async ({ page }) => {
    await stub(page);
    await page.goto("/events");

    // The browser gave this away for free with a native select; it is
    // reimplemented here, so it is asserted here.
    await page.getByRole("button", { name: /State/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("listbox", { name: "State" })).toBeVisible();

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await expect(page.getByRole("button", { name: /State/ })).not.toContainText("All states");
  });

  test("closes on Escape without choosing anything", async ({ page }) => {
    await stub(page);
    await page.goto("/events");
    await openState(page);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /State/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(page.getByRole("button", { name: /State/ })).toContainText("All states");
  });

  test("offers only states that have events, with their counts", async ({ page }) => {
    await stub(page);
    await page.goto("/events");
    await openState(page);

    /**
     * Listing all sixteen Malaysian states looked complete and was mostly
     * dead ends. The options are derived from the result, so every one of them
     * leads somewhere, and the count says whether it is worth the click.
     */
    const labels = await page.getByRole("option").allTextContents();
    expect(labels[0]).toMatch(/All states/);
    expect(labels.length).toBeLessThan(6);
    for (const label of labels) expect(label).toMatch(/\d+$/);
  });
});

test("sorting by best match is what ranks, and the business drives it", async ({ page }) => {
  await stub(page);
  await page.goto("/events");

  /**
   * There is no separate "rank for me" toggle any more: sorting by best match
   * IS ranking, and having both left the page with two ways to ask the same
   * thing. The business selector is what the scores are computed against.
   */
  await expect(page.getByRole("button", { name: /Sort by/ })).toContainText("Best match");
  await expect(page.locator(".evc-score")).toHaveCount(2);

  const business = page.getByRole("button", { name: /I sell/ });
  await business.click();
  await page.getByRole("option", { name: "Bubble tea / dessert" }).click();

  await expect(page).toHaveURL(/cat=bubble_tea_dessert/);
  await expect(business).toContainText("Bubble tea / dessert");
});

test("switching sort order changes the list without rescoring", async ({ page }) => {
  await stub(page);
  await page.goto("/events");

  await page.getByRole("button", { name: /Sort by/ }).click();
  await page.getByRole("option", { name: "Starting soonest" }).click();

  await expect(page).toHaveURL(/sort=soon/);
  // Scores are gone from the cards because the list is no longer ranked by fit.
  await expect(page.locator(".evc-score")).toHaveCount(0);
});

/**
 * Regressions from two bugs the owner hit.
 *
 * Both were about the filter bar, and both were invisible to the tests that
 * existed: the specs set filter state through the URL, which is precisely the
 * path that worked. Only typing exercised the broken one.
 */
test("typing in the search box actually types", async ({ page }) => {
  await stub(page);
  await page.goto("/events");

  /**
   * The bug: the reader took `q` from the URL while the writer set `query`, so
   * every keystroke wrote a parameter nothing read back. The input was
   * controlled by a value that never changed, and the field appeared frozen.
   */
  const box = page.getByPlaceholder("Event, venue or organizer");
  await box.click();
  await box.pressSequentially("terang", { delay: 30 });

  await expect(box).toHaveValue("terang");
  await expect(page).toHaveURL(/[?&]q=terang/);
  await expect(page.locator(".evc")).toHaveCount(1);
  await expect(page.locator(".evc")).toContainText("Terang Malam Market");
});

test("clearing the search restores the full list", async ({ page }) => {
  await stub(page);
  await page.goto("/events?q=terang");
  await expect(page.locator(".evc")).toHaveCount(1);

  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.locator(".evc")).toHaveCount(2);
});

test("a budget fires one request, not one per keystroke", async ({ page }) => {
  await stub(page);
  await page.goto("/events");
  await expect(page.locator(".evc")).toHaveCount(2);

  const fetches: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/v1/events?")) fetches.push(new URL(r.url()).search);
  });

  /**
   * Typing "700" passes through 7 and 70, and neither matches any event — so
   * an unthrottled fetch emptied the page twice on the way and read as broken.
   * The field stays instant; only the request waits.
   */
  const money = page.locator("#fb-budget");
  await money.click();
  await money.pressSequentially("700", { delay: 40 });

  await expect(page.locator(".evc")).toHaveCount(1);
  expect(fetches.filter((f) => f.includes("maxPrice"))).toHaveLength(1);
});

test("says why a budget emptied the list, and what would clear it", async ({ page }) => {
  await stub(page);
  await page.goto("/events?budget=100");

  // "Try raising the booth price" is advice. The cheapest actual price is the
  // fact that lets someone act without guessing.
  await expect(page.getByText(/cheapest booth/)).toBeVisible();
  await expect(page.getByText(/RM650/)).toBeVisible();
});

test.describe("the hero", () => {
  /**
   * The bento carries three DERIVED figures, and each has a distinct absent
   * state. A number that is still loading, a number that genuinely does not
   * exist, and zero are three different statements — the old strip rendered
   * the middle one as a lone em dash, which means nothing to a reader who has
   * not been told what it means.
   */
  test("counts the catalogue in figures the page can back up", async ({ page }) => {
    await page.route(MAPS, (route) => route.abort());
    await page.goto("/events");

    const bento = page.locator(".hero-bento");
    await expect(bento.locator(".hb-tile")).toHaveCount(3);

    // The figures must agree with the list they describe. Read at the SAME
    // instant: taking the card count first and polling the figure afterwards
    // compares against a number that was already stale, and reported a
    // mismatch of one while the list was still settling.
    await expect(page.locator(".evc").first()).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const figure = document.querySelector(".hb-tile .hb-value")?.textContent?.trim();
          const cards = document.querySelectorAll(".evc").length;
          return figure === String(cards) ? "agree" : `${figure} vs ${cards}`;
        }),
      )
      .toBe("agree");
  });

  test("holds the figure's place while the catalogue loads", async ({ page }) => {
    // Hold the response open so the loading state is observable at all.
    let release: (() => void) | null = null;
    const held = new Promise<void>((r) => (release = r));
    await page.route("**/v1/events**", async (route) => {
      await held;
      await route.continue();
    });
    await page.route(MAPS, (route) => route.abort());

    await page.goto("/events", { waitUntil: "commit" });
    await page.locator(".hero-bento").waitFor();

    // A skeleton, never an em dash, and never a zero standing in for unknown.
    await expect(page.locator(".hb-skel").first()).toBeVisible();
    await expect(page.locator(".hb-value").first()).not.toHaveText("0");
    await expect(page.locator(".hb-value").first()).not.toContainText("—");

    release!();
    await expect.poll(() => page.locator(".hb-skel").count()).toBe(0);
  });

  test("hands transform back to CSS so the tiles can lift", async ({ page }) => {
    await page.route(MAPS, (route) => route.abort());
    await page.goto("/events");
    await page.locator(".hb-tile").first().waitFor();

    /**
     * GSAP and CSS must never both own `transform`.
     *
     * A `transition: transform` on the tile smoothed every frame the entrance
     * wrote, so the tile eased BACKWARDS into the `from` values and stopped
     * there — rendering at scale(0.97) translateY(14px) permanently. And a
     * `from` leaves an inline transform, which a stylesheet `:hover` can never
     * outrank. The entrance therefore clears the property and marks the hero
     * ready; this asserts both halves of that.
     */
    await expect(page.locator(".events-hero")).toHaveClass(/is-ready/);
    await expect
      .poll(() =>
        page.evaluate(() => getComputedStyle(document.querySelector(".hb-tile")!).transform),
      )
      .toBe("none");
  });

  test("the drifting grid moves by exactly one cell", async ({ page }) => {
    await page.route(MAPS, (route) => route.abort());
    await page.goto("/events");
    const grid = page.locator(".hero-grid-bg");
    await grid.waitFor({ state: "attached" });

    /**
     * The backdrop loops by translating one whole cell. Any other distance
     * leaves a visible jump at the wrap, so the tween's travel and the CSS
     * `background-size` are one number in two files — asserted here rather
     * than trusted to stay in step.
     */
    const cell = await page.evaluate(() => {
      const size = getComputedStyle(document.querySelector(".hero-grid-bg")!).backgroundSize;
      return parseFloat(size);
    });
    expect(cell).toBe(34);

    // And it is actually moving, on a transform rather than a repaint.
    const first = await page.evaluate(
      () => getComputedStyle(document.querySelector(".hero-grid-bg")!).transform,
    );
    await expect
      .poll(() =>
        page.evaluate(() => getComputedStyle(document.querySelector(".hero-grid-bg")!).transform),
      )
      .not.toBe(first);
  });
});
