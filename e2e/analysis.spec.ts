import { expect, test } from "@playwright/test";

/**
 * Location Analysis — slice 1a.
 *
 * CI NEVER LOADS GOOGLE MAPS. Every test here blocks maps.googleapis.com and
 * asserts the degraded state plus that everything around it still works.
 * Letting CI hit Maps on every push would spend real money for no signal, and
 * the graceful-degradation path is the one that actually needs guarding —
 * an ad blocker or a captive portal hits it far more often than an outage.
 *
 * The real map is verified by hand against the deployed site.
 */

const MAPS = "https://maps.googleapis.com/**";

test.describe("routing", () => {
  test("the root redirects to the simulator", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/simulator/);
    await expect(page.getByTestId("headline-profit")).toHaveText("RM 38,418");
  });

  test("an old share link keeps its scenario through the redirect", async ({ page }) => {
    // Links of the form /?s=... are already in the wild. A redirect that drops
    // the query string would silently reset them to the default scenario.
    await page.goto("/");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("s"), { timeout: 5_000 })
      .not.toBeNull();

    const before = new URL(page.url()).searchParams.get("s");

    await page.getByLabel("Transactions per day", { exact: true }).fill("210");
    await page.getByLabel("Transactions per day", { exact: true }).blur();

    // The URL is written on a 400ms debounce. A fixed 600ms sleep raced it and
    // failed about one run in three — it would read the PREVIOUS scenario and
    // then assert the old value came back, which looks like a share-link bug
    // and is really a test bug. Wait for the write instead of guessing at it.
    await expect
      .poll(() => new URL(page.url()).searchParams.get("s"), { timeout: 5_000 })
      .not.toBe(before);

    const scenario = new URL(page.url()).searchParams.get("s")!;
    await page.goto(`/?s=${encodeURIComponent(scenario)}`);

    await expect(page).toHaveURL(/\/simulator/);
    await expect(page.getByLabel("Transactions per day", { exact: true })).toHaveValue("210");
  });

  test("navigates between the two sections", async ({ page }) => {
    await page.route(MAPS, (route) => route.abort());
    await page.goto("/simulator");

    await page.getByRole("link", { name: "Location" }).click();
    await expect(page).toHaveURL(/\/analysis/);

    await page.getByRole("link", { name: "Simulator", exact: true }).click();
    await expect(page).toHaveURL(/\/simulator/);
    await expect(page.getByTestId("headline-profit")).toBeVisible();
  });

  test("an unknown path lands on the simulator rather than a blank page", async ({ page }) => {
    await page.goto("/does-not-exist");
    await expect(page).toHaveURL(/\/simulator/);
    await expect(page.getByTestId("headline-profit")).toBeVisible();
  });
});

test.describe("cost control", () => {
  test("the simulator route never requests Google Maps", async ({ page }) => {
    // The analysis route is lazy-loaded precisely so Maps is not billed for
    // someone who only opens the simulator.
    const mapsRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("maps.googleapis.com")) mapsRequests.push(request.url());
    });

    await page.goto("/simulator");
    await expect(page.getByTestId("headline-profit")).toBeVisible();
    await page.getByLabel("Transactions per day", { exact: true }).fill("200");
    await page.waitForTimeout(1_000);

    expect(mapsRequests).toEqual([]);
  });
});

test.describe("analysis page", () => {
  test.beforeEach(async ({ page }) => {
    await page.route(MAPS, (route) => route.abort());
  });

  test("degrades to a clear state when Maps cannot load", async ({ page }) => {
    await page.goto("/analysis");

    await expect(page.getByTestId("maps-unavailable")).toBeVisible({ timeout: 20_000 });
    // The coordinates are still shown and the page is still navigable.
    await expect(page.getByText("Kuala Lumpur city centre")).toBeVisible();
    await expect(page.getByRole("link", { name: "Simulator", exact: true })).toBeVisible();
  });

  test("honours a location from the link", async ({ page }) => {
    await page.goto("/analysis?lat=3.1707&lng=101.6505&q=Mont+Kiara");

    await expect(page.getByText("Mont Kiara", { exact: true })).toBeVisible();
    await expect(page.getByText("3.17070, 101.65050")).toBeVisible();
  });

  test("a corrupted location link falls back with a notice", async ({ page }) => {
    await page.goto("/analysis?lat=abc&lng=999");

    await expect(page.getByText("could not be read")).toBeVisible();
    await expect(page.getByText("Kuala Lumpur city centre")).toBeVisible();
  });

  test("warns when the pin is outside Malaysia", async ({ page }) => {
    // Jakarta — valid coordinates, but the presets do not apply there.
    await page.goto("/analysis?lat=-6.2088&lng=106.8456&q=Jakarta");

    await expect(page.getByText("outside Malaysia")).toBeVisible();
  });

  test("keeps the location in the address bar", async ({ page }) => {
    await page.goto("/analysis?lat=3.1707&lng=101.6505&q=Mont+Kiara");

    await expect
      .poll(() => new URL(page.url()).searchParams.get("lat"), { timeout: 5_000 })
      .toBe("3.170700");
    expect(new URL(page.url()).searchParams.get("q")).toBe("Mont Kiara");
  });
});
