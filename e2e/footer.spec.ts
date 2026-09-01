import { expect, test, type Page } from "@playwright/test";

/**
 * The site footer.
 *
 * Most of it is presentation, but two things in it are obligations rather than
 * decoration: Kontur Population is CC BY 4.0 and OpenStreetMap is ODbL, and
 * both require attribution wherever the data is shown. They used to sit only
 * at the bottom of the heatmap page, so a catchment figure quoted on
 * /analysis carried the data without the notice.
 */

const MAPS = "https://maps.googleapis.com/**";
const ROUTES = ["/events", "/simulator", "/analysis", "/compare"];

async function goto(page: Page, path: string) {
  await page.route(MAPS, (route) => route.abort());
  await page.goto(path);
  await page.locator("footer.footer").waitFor({ state: "attached" });
}

test("appears on every route", async ({ page }) => {
  for (const route of ROUTES) {
    await goto(page, route);
    await expect(page.locator("footer.footer"), route).toHaveCount(1);
  }
});

test("carries the attributions the licences require", async ({ page }) => {
  await goto(page, "/simulator");
  const footer = page.locator("footer.footer");

  // Neither of these is optional, and neither may be page-specific.
  await expect(footer.getByText(/Kontur Population/)).toBeVisible();
  await expect(footer.getByText(/CC BY 4\.0/)).toBeVisible();
  await expect(footer.getByText(/OpenStreetMap contributors/)).toBeVisible();
  await expect(footer.getByText(/ODbL/)).toBeVisible();
});

test("links the attributions to their source, not just names them", async ({ page }) => {
  await goto(page, "/events");
  const footer = page.locator("footer.footer");

  await expect(footer.getByRole("link", { name: /Kontur Population/ })).toHaveAttribute(
    "href",
    /humdata\.org/,
  );
  await expect(footer.getByRole("link", { name: /OpenStreetMap/ })).toHaveAttribute(
    "href",
    /openstreetmap\.org\/copyright/,
  );
});

test("repeats the comparison-aid caveat where anyone can find it", async ({ page }) => {
  await goto(page, "/compare");

  // A reader landing deep in the app should not have to hunt for the one
  // panel that says the score is not a forecast.
  await expect(
    page.locator("footer.footer").getByText(/comparison aid, not a forecast/),
  ).toBeVisible();
});

test("navigates from its own links", async ({ page }) => {
  await goto(page, "/simulator");

  await page.locator("footer.footer").getByRole("link", { name: "Find events" }).click();
  await expect(page).toHaveURL(/\/events/);
});

test("keeps screen-reader labels clipped, everywhere on the page", async ({ page }) => {
  await goto(page, "/events");

  /**
   * A footer rule written as `.ft-col a span` also matched the brand logo's
   * `.sr-only` label and overrode its `position: absolute` — 0,2,1 beating
   * 0,1,0 — which broke the clip and printed "Spotential home" beside the
   * wordmark. This audits every one of them, not only the footer's.
   */
  const leaking = await page.evaluate(() =>
    [...document.querySelectorAll(".sr-only")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return getComputedStyle(el).position !== "absolute" || r.width > 2 || r.height > 2;
      })
      .map((el) => el.textContent?.trim() ?? ""),
  );

  expect(leaking).toEqual([]);
});

test("still credits its data sources when printed", async ({ page }) => {
  await goto(page, "/simulator");
  await page.emulateMedia({ media: "print" });

  /**
   * A printed page is the copy most likely to be handed to someone else and
   * to outlive the screen it came from, so the attribution has to survive it.
   * The decoration does not: nav columns and the brand block go, the credits
   * and the not-a-forecast line stay.
   */
  const footer = page.locator("footer.footer");
  await expect(footer).toBeVisible();
  await expect(footer.getByText(/Kontur Population/)).toBeVisible();
  await expect(footer.getByText(/OpenStreetMap contributors/)).toBeVisible();
  await expect(footer.getByText(/comparison aid, not a forecast/)).toBeVisible();

  await expect(footer.getByRole("link", { name: "Find events" })).toBeHidden();
  await expect(footer.getByText(/Know the spot/)).toBeHidden();

  // And the navbar is still gone, which is what `.no-print` is actually for.
  await expect(page.locator(".navbar-shell")).toBeHidden();
});
