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

/**
 * Four now, not five. City Demand was folded into Location, which is also why
 * the masthead-overflow guard below still matters: five items clipped the bar
 * at 375px once, so the scroller stays even though the count came back down.
 */
const NAV = ["Events", "Simulator", "Location", "Compare"];

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

  /**
   * LINKS, not buttons, and that is the change rather than a looser assertion.
   * These used to open a Google popup in place, which meant the product had
   * two sign-in surfaces with two sets of error handling and no page a vendor
   * could be sent to. They address real routes now, so the destination is
   * worth pinning alongside the label.
   */
  await expect(page.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
  await expect(page.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/register");
});

test("does not underline the auth buttons", async ({ page }) => {
  await goto(page, "/events");
  await openIfCompact(page);

  /**
   * They read as buttons, so they must not be underlined like links.
   *
   * The underline arrived with the MARKUP rather than with a stylesheet
   * change: these were `<button>` elements, which the browser never
   * underlines, and became `<a>` when they started addressing real pages.
   * None of their rules had ever needed `text-decoration`, so the default
   * applied. `.nav-link` next to them already carried it.
   *
   * Hover is checked too: a rule covering only the resting state lets the
   * underline back in under the pointer, and on a phone that is the state a
   * tap leaves a control in.
   */
  for (const name of ["Log in", "Sign up"]) {
    const el = page.getByRole("link", { name });
    expect(await el.evaluate((n) => getComputedStyle(n).textDecorationLine), name).toBe("none");
    await el.hover();
    expect(
      await el.evaluate((n) => getComputedStyle(n).textDecorationLine),
      `${name} hovered`,
    ).toBe("none");
  }
});

test("centres the auth labels and balances them against the logo", async ({ page }) => {
  await goto(page, "/events");
  await openIfCompact(page);

  /**
   * SECOND BUG FROM THE SAME CAUSE as the underline above, which is why this
   * is measured rather than eyeballed.
   *
   * A `<button>` centres its own label; a block `<a>` with a `min-height` and
   * no inner alignment drops the line box at the TOP of the pill. When these
   * became links, both labels ended up 7px above centre with 2px of space
   * above and 16px below, and it read as the buttons sitting high in the bar.
   *
   * The text's own rect, via a `Range`, is the only honest way to measure it:
   * the ELEMENT is perfectly centred in the capsule either way, which is what
   * makes this the kind of misalignment that survives a casual look.
   */
  for (const name of ["Log in", "Sign up"]) {
    const off = await page.getByRole("link", { name }).evaluate((el) => {
      const box = el.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el);
      const text = range.getBoundingClientRect();
      return text.y + text.height / 2 - (box.y + box.height / 2);
    });
    expect(Math.abs(off), `${name} label off centre by ${off.toFixed(1)}px`).toBeLessThan(1.5);
  }
});

test("gives both ends of the capsule the same optical margin", async ({ page }) => {
  // Desktop only: below 900px the actions move into the drawer and the
  // capsule holds just the logo and the menu button.
  test.skip((page.viewportSize()?.width ?? 0) < 900, "actions are in the drawer");
  await goto(page, "/events");

  /**
   * Measured to the VISIBLE thing at each end, not to its box. The brand link
   * carries 4px of its own padding, so matching the capsule's raw padding
   * left and right would still look lopsided. It read 19px to the logo mark
   * against 11px to the Sign up pill, which is what made the gold crowd the
   * capsule's curve.
   */
  /**
   * POLLED, because the bar animates itself in.
   *
   * The masthead tweens `.nav-logo` with a `scale` on mount, and `.nav-mark`
   * sits inside it — so a single reading taken while that is still running
   * measures a box mid-flight. It passed in isolation and failed once under
   * full-suite load, which is the worst kind of flake and exactly the trap
   * this file already records for colour transitions: never take one sample of
   * a value that is still moving.
   */
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const nav = document.querySelector(".navbar")!.getBoundingClientRect();
          // `.nav-mark` is the white CHIP, which is the visible left edge. The
          // `<img>` inside it is inset by its own padding and reads 26px from
          // the capsule, which is not the margin anybody sees.
          const mark = document.querySelector(".nav-mark")!.getBoundingClientRect();
          const signup = document.querySelector(".nav-signup")!.getBoundingClientRect();
          return Math.round(Math.abs(mark.x - nav.x - (nav.right - signup.right)));
        }),
      { message: "optical margins never settled to within 3px of each other" },
    )
    .toBeLessThan(3);
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
