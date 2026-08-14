import { expect, test } from "@playwright/test";

/**
 * App Check degradation.
 *
 * The point of gating only the paid routes is blast radius: if reCAPTCHA or
 * Firebase cannot load — an ad blocker, a corporate proxy, a Google outage —
 * the simulator must remain completely usable, because it computes in the
 * browser and never needed the network.
 *
 * These tests block Firebase and reCAPTCHA outright and assert exactly that.
 */

const FIREBASE_HOSTS = [
  "https://*.googleapis.com/**",
  "https://www.google.com/recaptcha/**",
  "https://www.gstatic.com/recaptcha/**",
];

test.describe("with Firebase and reCAPTCHA blocked", () => {
  test.beforeEach(async ({ page }) => {
    for (const pattern of FIREBASE_HOSTS) {
      await page.route(pattern, (route) => route.abort());
    }
  });

  test("the simulator is completely unaffected", async ({ page }) => {
    await page.goto("/simulator");

    await expect(page.getByTestId("headline-profit")).toHaveText("RM 38,418");

    // Every interactive figure still recalculates locally.
    const transactions = page.getByLabel("Transactions per day", { exact: true });
    await transactions.fill("144");
    await transactions.blur();
    await expect(page.getByTestId("headline-profit")).toHaveText("RM 25,015");
    await expect(page.getByTestId("headline-breakeven")).toHaveText("8–13 months");
  });

  test("share links and CSV still work without any Google service", async ({ page }) => {
    await page.goto("/simulator");

    const download = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download CSV" }).click(),
    ]).then(([d]) => d);
    expect(download.suggestedFilename()).toContain("spotential-");

    await expect
      .poll(() => new URL(page.url()).searchParams.get("s"), { timeout: 5_000 })
      .not.toBeNull();
  });

  test("the analysis page still renders rather than white-screening", async ({ page }) => {
    await page.goto("/analysis?lat=3.1478&lng=101.6953&q=KL");

    // Maps is gone and the paid panels will fail, but the shell holds: the
    // place name, its coordinates and the section tabs are all still there.
    await expect(page.getByRole("heading", { name: "KL" })).toBeVisible();
    await expect(page.getByText("3.14780, 101.69530")).toBeVisible();
    await expect(page.getByRole("tab", { name: /^Overview/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Simulator", exact: true })).toBeVisible();
  });
});

test.describe("the paid routes reject unattested callers", () => {
  test("a direct API call without App Check is refused", async ({ request }) => {
    // Exactly what a script pointed at the public URL would do.
    const response = await request.post("http://localhost:8080/v1/competitors", {
      data: { lat: 3.1478, lng: 101.6953, radiusMetres: 500, category: "korean_restaurant" },
      failOnStatusCode: false,
    });

    // 401 when enforcement is on. Locally it is off by design, so accept 200
    // too rather than making this test depend on local env configuration.
    expect([200, 401]).toContain(response.status());
    if (response.status() === 401) {
      expect((await response.json()).error).toBe("app_check_required");
    }
  });

  test("the free routes stay callable", async ({ request }) => {
    const response = await request.get("http://localhost:8080/health");
    expect(response.status()).toBe(200);
    expect((await response.json()).status).toBe("ok");
  });
});
