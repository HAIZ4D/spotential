import { expect, test, type Page } from "@playwright/test";

/**
 * No dashes in the copy.
 *
 * The owner's words: the em dash is a tell of machine-written text, and they
 * did not want the product to read that way. 149 of them came out of the
 * strings across all three workspaces, rewritten into sentences rather than
 * comma-spliced, because a dash usually marks a clause that should have been
 * its own sentence.
 *
 * ONE test holds all of that in place. Without it the next piece of copy
 * anyone writes brings them straight back, and nothing would notice.
 */

const MAPS = "https://maps.googleapis.com/**";

/** Every route, plus the states that only appear after interaction. */
const ROUTES = [
  "/simulator",
  "/events",
  "/analysis?lat=3.1478&lng=101.6953",
  "/compare?c=korean_restaurant&r=500&p=3.1478,101.6953,Central+KL&p=3.1073,101.6067,Suburban+PJ",
];

async function dashesOn(page: Page, path: string): Promise<string[]> {
  await page.route(MAPS, (route) => route.abort());
  await page.goto(path);
  // Let the panels resolve; copy that only renders after a fetch counts too.
  await page.waitForTimeout(1200);

  return page.evaluate(() =>
    document.body.innerText
      .split("\n")
      .filter((line) => /[—–]/.test(line))
      .map((line) => line.trim().slice(0, 120)),
  );
}

for (const route of ROUTES) {
  test(`no em or en dash in the copy on ${route.split("?")[0]}`, async ({ page }) => {
    const offenders = await dashesOn(page, route);
    expect(offenders, `dashes rendered on ${route}`).toEqual([]);
  });
}

test("no dash in the deeper panels either", async ({ page }) => {
  await page.route(MAPS, (route) => route.abort());
  await page.goto("/analysis?lat=3.1478&lng=101.6953");
  await page.locator(".mappane").waitFor();

  /**
   * The tabs hide most of this page's text, so walking the routes alone would
   * miss it. Every panel gets opened, including the disclosure that holds the
   * score working.
   */
  for (const tab of ["Competition", "People", "Demand", "Rent"]) {
    const button = page.locator(".tab").filter({ hasText: tab });
    if ((await button.count()) === 0) continue;
    await button.first().click();
    await page.waitForTimeout(500);

    const found = await page.evaluate(() =>
      document.body.innerText
        .split("\n")
        .filter((l) => /[—–]/.test(l))
        .map((l) => l.trim().slice(0, 110)),
    );
    expect(found, `dashes in the ${tab} panel`).toEqual([]);
  }
});

test("the score working opens without bringing dashes back", async ({ page }) => {
  await page.route(MAPS, (route) => route.abort());
  await page.goto("/analysis?lat=3.1478&lng=101.6953");
  await page.locator(".score-working").waitFor();

  await page.locator(".score-working > summary").click();
  await page.waitForTimeout(400);

  const found = await page.evaluate(() =>
    document.body.innerText
      .split("\n")
      .filter((l) => /[—–]/.test(l))
      .map((l) => l.trim().slice(0, 110)),
  );
  expect(found).toEqual([]);
});
