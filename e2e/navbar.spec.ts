import { expect, test, type Page } from "@playwright/test";

/**
 * The floating capsule navigation.
 *
 * Most of what makes this bar feel finished is motion, which a test cannot
 * judge. What a test CAN protect is the structure the motion depends on and the
 * things that would quietly break: one link per destination, the pill landing on
 * the right item, the menu leaving the tab order when closed, and the page
 * actions the routes pass in still rendering.
 */

const MAPS = "https://maps.googleapis.com/**";

async function goto(page: Page, path: string) {
  await page.route(MAPS, (route) => route.abort());
  await page.goto(path);
  /**
   * Wait for the bar to actually exist before anything probes it.
   *
   * Without this, `openIfCompact` ran before React had rendered, found no menu
   * button, concluded the layout was not compact and never opened the menu —
   * so the mobile project failed looking for links that were still collapsed.
   * A visibility check on an element that has not rendered yet answers "no",
   * which is indistinguishable from "not compact".
   */
  await page.locator(".navbar").waitFor({ state: "visible" });
}

const NAV = ["Events", "Simulator", "Location", "Compare", "City Demand"];

/** Below 900px the bar collapses behind a menu button. */
async function openIfCompact(page: Page) {
  const burger = page.getByRole("button", { name: "Open menu" });
  if ((await burger.count()) === 0) return;
  if (!(await burger.isVisible())) return;

  await burger.click();
  // The panel is animated open; wait for the state it reports rather than for
  // a fixed duration, which would be a flaky test rather than a passing one.
  await expect(page.getByRole("button", { name: "Close menu" })).toBeVisible();
}

test("carries every destination exactly once", async ({ page }) => {
  await goto(page, "/events");
  await openIfCompact(page);

  for (const label of NAV) {
    // Exactly one: the links are rendered a single time and reflow between
    // layouts. Two copies would put duplicate names in the accessibility tree
    // and make every name-based lookup ambiguous.
    await expect(page.getByRole("link", { name: label, exact: true })).toHaveCount(1);
  }
});

test("the logo returns to the homepage", async ({ page }) => {
  await goto(page, "/compare");

  // The footer carries a brand link with the same accessible name. That is
  // fine — they sit in different landmarks, which is exactly how a screen
  // reader tells them apart — but a page-wide lookup is now ambiguous, so
  // this test says which one it means.
  const home = page.locator(".navbar").getByRole("link", { name: /Spotential home/ });
  await expect(home).toBeVisible();
  await home.click();

  // "/" redirects to the simulator, preserving any query string.
  await expect(page).toHaveURL(/\/simulator/);
});

test("marks the current page for assistive tech, not only in colour", async ({ page }) => {
  await goto(page, "/compare");
  await openIfCompact(page);

  await expect(page.getByRole("link", { name: "Compare", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("link", { name: "Events", exact: true })).not.toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("keeps a nested route lit on its section", async ({ page }) => {
  // An event detail page is still Events; matching on equality alone would
  // unlight the whole bar as soon as you opened a listing.
  await goto(page, "/events/lapan-pagi-club");
  await openIfCompact(page);

  await expect(page.getByRole("link", { name: "Events", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("offers log in and a single primary sign-up", async ({ page }) => {
  await goto(page, "/events");
  await openIfCompact(page);

  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign up" })).toBeVisible();
});

test("still renders the actions each route passes in", async ({ page }) => {
  // The capsule has no room for them, so they moved to their own row. They
  // must not have been lost in the move.
  await goto(page, "/simulator");
  await expect(page.locator(".page-actions")).toBeVisible();
  await expect(page.locator(".page-actions").getByRole("button", { name: /Print/i })).toBeVisible();
});

test("adds no row on pages that pass no actions", async ({ page }) => {
  await goto(page, "/events");
  await expect(page.locator(".page-actions")).toHaveCount(0);
});

test("never pushes the page sideways", async ({ page }) => {
  for (const path of ["/events", "/simulator", "/compare", "/heatmap"]) {
    await goto(page, path);
    const overflow = await page.evaluate(
      () => document.body.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});

test("stays in the document flow so pages are not overlapped", async ({ page }) => {
  await goto(page, "/events");

  /**
   * Sticky rather than fixed, deliberately. A fixed bar would leave a hole at
   * the top of every route and each one would need its own compensating
   * padding — so this asserts the header still occupies real height and the
   * content begins below it rather than underneath it.
   */
  const box = await page.locator(".navbar-shell").boundingBox();
  // The first thing the route renders under the header. Named generically
  // rather than by page class, so a page redesign does not break a test that
  // is about the HEADER — /events used .cockpit before it was rewritten.
  const content = await page.locator(".navbar-shell + *, .events-page").first().boundingBox();
  expect(box!.height).toBeGreaterThan(40);
  expect(content!.y).toBeGreaterThanOrEqual(box!.y + box!.height - 1);
});

test.describe("compact layout", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("hides the links behind a labelled menu button", async ({ page }) => {
    await goto(page, "/events");

    const burger = page.getByRole("button", { name: "Open menu" });
    await expect(burger).toBeVisible();
    await expect(burger).toHaveAttribute("aria-expanded", "false");

    // Closed means genuinely gone: a collapsed-but-visible panel would still
    // hold its links in the tab order and a keyboard user would land inside a
    // menu they cannot see.
    await expect(page.getByRole("link", { name: "Simulator", exact: true })).toHaveCount(0);
  });

  test("opens, reveals every destination, and reports its state", async ({ page }) => {
    await goto(page, "/events");
    await page.getByRole("button", { name: "Open menu" }).click();

    await expect(page.getByRole("button", { name: "Close menu" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    for (const label of NAV) {
      await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
  });

  test("opens to a real height rather than to its own padding", async ({ page }) => {
    await goto(page, "/events");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.waitForTimeout(700);

    // GSAP cannot interpolate towards `auto`; animating to it collapsed this
    // panel to 18px of padding and the menu looked like it opened behind the
    // page. The height is measured in pixels now, and this is the guard.
    const box = await page.locator(".nav-collapse").boundingBox();
    expect(box!.height).toBeGreaterThan(200);
  });

  test("closes on Escape", async ({ page }) => {
    await goto(page, "/events");
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.getByRole("button", { name: "Close menu" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
  });

  test("closes itself after navigating", async ({ page }) => {
    await goto(page, "/events");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("link", { name: "Compare", exact: true }).click();

    await expect(page).toHaveURL(/\/compare/);
    // Otherwise the menu sits over the page you just asked for.
    await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
  });
});
