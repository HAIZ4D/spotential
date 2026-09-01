import { expect, test, type Page } from "@playwright/test";
import { openSection } from "./sections.js";

/**
 * The Location page's tab rail.
 *
 * Written after a bug the whole existing suite was blind to. The rail is
 * `display: flex` with `overflow-x: auto`, and the tabs carried a `min-width`
 * — so the default `flex-shrink: 1` squashed EVERY tab to that minimum, and
 * the widest label plus its badge overflowed its own button and painted over
 * the next tab's first letter. "People" rendered as "eople".
 *
 * Nothing caught it because every assertion in the suite is name-based, and an
 * accessible name is unaffected by a label being covered by a sibling. Only
 * geometry sees this, so these tests measure boxes.
 */

const MAPS = "https://maps.googleapis.com/**";

async function stub(page: Page) {
  await page.route(MAPS, (route) => route.abort());
  await page.route("**/v1/competitors", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
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
        // A truncated search gives the widest possible badge ("20+"), which is
        // the case that actually overflowed.
        truncated: true,
        completeToMetres: 421,
        searchSkipped: false,
        placesConfigured: true,
      }),
    }),
  );
  for (const path of ["**/v1/opportunity-gaps", "**/v1/demographics"]) {
    await page.route(path, (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
    );
  }
}

const AT_KL = "/analysis?lat=3.1478&lng=101.6953&q=Kuala%20Lumpur";

test("no tab's content overflows its own button", async ({ page }) => {
  await stub(page);
  await page.goto(AT_KL);
  await expect(page.getByRole("tab", { name: /^Competition/ })).toBeVisible();

  /**
   * Measured against the CHILDREN's boxes, not `scrollWidth`.
   *
   * `scrollWidth` was the obvious check and it is the wrong one: a button with
   * `overflow: visible` is not a scroll container, so it reports no horizontal
   * overflow no matter how far its content spills. Reinstating the bug proved
   * that — the assertion passed while the label was visibly covering its
   * neighbour. Child rectangles are what actually paint.
   */
  const overflowing = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".tab")]
      .map((el) => {
        const box = el.getBoundingClientRect();
        const spill = [...el.children]
          .map((child) => child.getBoundingClientRect())
          .filter((r) => r.width > 0)
          .reduce((worst, r) => Math.max(worst, r.right - box.right, box.left - r.left), 0);
        return { label: el.textContent?.trim() ?? "", spill: Math.round(spill) };
      })
      .filter((t) => t.spill > 1)
      .map((t) => `${t.label} spills ${t.spill}px past its own button`),
  );
  expect(overflowing).toEqual([]);
});

test("the sliding thumb lands on the active tab, not near it", async ({ page }) => {
  await stub(page);
  await page.goto(AT_KL);

  for (const section of ["Competition", "Rent", "Overview"] as const) {
    await openSection(page, section);

    /**
     * The thumb is measured off the live element rather than computed from an
     * assumed equal-width grid — badges make these tabs genuinely different
     * widths. A 1px tolerance covers sub-pixel layout and the tween's final
     * frame; anything larger means it is tracking something else.
     */
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const thumb = document.querySelector(".tab-thumb")?.getBoundingClientRect();
            const active = document
              .querySelector('.tab[aria-selected="true"]')
              ?.getBoundingClientRect();
            if (!thumb || !active) return null;
            return Math.max(Math.abs(thumb.x - active.x), Math.abs(thumb.width - active.width)) < 1;
          }),
        { message: `thumb did not settle on ${section}` },
      )
      .toBe(true);
  }
});

test("exactly one tab is selected, and its badge stays legible", async ({ page }) => {
  await stub(page);
  await page.goto(AT_KL);
  await openSection(page, "Competition");

  await expect(page.locator('.tab[aria-selected="true"]')).toHaveCount(1);

  /**
   * Wait for the badge to EXIST before measuring it.
   *
   * The first version measured straight after the click and read a transient
   * mid-load state — the competitors response had not landed, so the tab
   * carried no figure yet and the reading was of something else entirely.
   * Same class as the debounce race already written up in the gotchas: poll
   * for the value, never sleep towards it.
   */
  const badge = page.locator('.tab[aria-selected="true"] .tab-badge');
  await expect(badge).toHaveText("20+");

  /**
   * Polled, because the badge CROSSFADES.
   *
   * Selecting a tab tweens the badge's text from navy to white while its
   * background tweens from the soft tint to navy, and for a few frames in the
   * middle those two are genuinely close — a single reading taken right after
   * the click measured 1.35:1 and called it a defect. 160ms of crossfade is
   * not a legibility failure; a badge that SETTLES illegible is. So this waits
   * for the value to stop moving, exactly as the debounce gotcha prescribes.
   *
   * Navy rather than gold, incidentally: gold is the CTA colour and Sign up
   * already owns it, so a gold badge here would put two "act on me" signals on
   * one screen. Same call the navbar pill made.
   */
  await expect
    .poll(() =>
      badge.evaluate((el) => {
        const style = getComputedStyle(el);
        const parse = (s: string) => (s.match(/\d+/g) ?? []).slice(0, 3).map(Number);
        const lum = ([r, g, b]: number[]) => {
          const f = (v: number) => {
            const c = v / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
        };
        const [hi, lo] = [lum(parse(style.color)), lum(parse(style.backgroundColor))].sort(
          (a, b) => b - a,
        );
        return (hi! + 0.05) / (lo! + 0.05);
      }),
    )
    .toBeGreaterThanOrEqual(4.5);
});
