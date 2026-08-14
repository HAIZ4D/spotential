import { expect, test, type Page } from "@playwright/test";

/**
 * PDF reports — Feature 4.
 *
 * The endpoint is STUBBED here. Generating a real PDF in CI would mean a real
 * Static Maps call on every run, and the rendering itself is already covered
 * by the service tests. What needs guarding in the browser is the flow: the
 * request carries INPUTS rather than results, the file actually saves, and a
 * failure says so instead of doing nothing.
 */

const MAPS = "https://maps.googleapis.com/**";
const PDF = Buffer.from("%PDF-1.7\n% stub\n");

async function stubReport(page: Page, options: { fail?: number } = {}) {
  await page.route("**/v1/report", (route) => {
    if (options.fail) {
      return route.fulfill({
        status: options.fail,
        contentType: "application/json",
        body: JSON.stringify({ error: "report_failed", message: "Could not generate the report." }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/pdf",
      headers: {
        "content-disposition": 'attachment; filename="spotential-test.pdf"',
        // Not a CORS-safelisted header, and the service is on another origin.
        // The real service sets this too; without it the browser cannot read
        // the filename and every download gets a generic name.
        "access-control-expose-headers": "content-disposition",
      },
      body: PDF,
    });
  });
}

async function stubAnalysis(page: Page) {
  await page.route(MAPS, (route) => route.abort());
  await page.route("**/v1/competitors", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        competitors: [],
        summary: {
          total: 12,
          averageRating: 4.2,
          ratedCount: 12,
          totalReviews: 1400,
          nearestMetres: 80,
          operational: 12,
        },
        density: [{ upToMetres: 500, count: 12 }],
        fromCache: true,
        fetchedAt: Date.now(),
        radiusMetres: 500,
        truncated: false,
        completeToMetres: null,
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

const downloadPdf = (page: Page) => page.getByRole("button", { name: "Download PDF" });

test.describe("simulator", () => {
  test("downloads a report and keeps Print alongside it", async ({ page }) => {
    await stubReport(page);
    await page.goto("/simulator");

    // Print produces a printout of the screen; the report is a different
    // artifact. Both stay.
    await expect(page.getByRole("button", { name: "Print" })).toBeVisible();

    const download = page.waitForEvent("download");
    await downloadPdf(page).click();
    expect((await download).suggestedFilename()).toBe("spotential-test.pdf");
  });

  test("sends the scenario inputs, never a computed result", async ({ page }) => {
    await stubReport(page);
    let body: Record<string, unknown> = {};
    page.on("request", (request) => {
      if (request.url().endsWith("/v1/report")) body = request.postDataJSON();
    });

    await page.goto("/simulator");
    const download = page.waitForEvent("download");
    await downloadPdf(page).click();
    await download;

    expect(body["kind"]).toBe("scenario");
    // The server recomputes; a posted result would let a hand-edited request
    // put arbitrary figures in a document carrying Spotential's name.
    expect(body).not.toHaveProperty("result");
    expect(body).not.toHaveProperty("breakEven");
    expect(body["inputs"]).toMatchObject({ businessCategory: "korean_restaurant" });
  });

  test("says so when the service fails, and the figures keep working", async ({ page }) => {
    await stubReport(page, { fail: 500 });
    await page.goto("/simulator");

    await downloadPdf(page).click();

    await expect(page.getByText(/Could not generate the report/)).toBeVisible();
    await expect(page.getByText(/Print still works/)).toBeVisible();
    // The deterministic core is untouched by an AI or report failure.
    await expect(page.getByTestId("headline-profit")).toHaveText("RM 38,418");
  });

  test("reports being over quota rather than failing silently", async ({ page }) => {
    await stubReport(page, { fail: 429 });
    await page.goto("/simulator");
    await downloadPdf(page).click();
    await expect(page.getByText(/Could not generate the report/)).toBeVisible();
  });
});

test.describe("location", () => {
  test("waits for the competitor lookup before offering a report", async ({ page }) => {
    await stubReport(page);
    await page.route(MAPS, (route) => route.abort());
    // Competitors never resolve, so a report would be a page of dashes.
    await page.route("**/v1/competitors", () => {});
    for (const path of ["**/v1/opportunity-gaps", "**/v1/demographics"]) {
      await page.route(path, (route) => route.fulfill({ status: 503, body: "{}" }));
    }

    await page.goto("/analysis?lat=3.1578&lng=101.7123&q=KLCC");
    await expect(downloadPdf(page)).toBeDisabled();
  });

  test("sends the point, the summary and the rent, but no score", async ({ page }) => {
    await stubAnalysis(page);
    await stubReport(page);

    let body: Record<string, unknown> = {};
    page.on("request", (request) => {
      if (request.url().endsWith("/v1/report")) body = request.postDataJSON();
    });

    await page.goto("/analysis?lat=3.1578&lng=101.7123&q=KLCC&rent=9000");
    await expect(downloadPdf(page)).toBeEnabled();

    const download = page.waitForEvent("download");
    await downloadPdf(page).click();
    await download;

    expect(body["kind"]).toBe("location");
    expect(body["category"]).toBe("korean_restaurant");
    const location = body["location"] as Record<string, unknown>;
    expect(location["label"]).toBe("KLCC");
    expect(location["rentOverride"]).toBe(9000);
    expect(location).not.toHaveProperty("score");
  });
});

test.describe("comparison", () => {
  test("needs two locations before a comparison report is offered", async ({ page }) => {
    await stubAnalysis(page);
    await stubReport(page);

    await page.goto("/compare?c=korean_restaurant&r=500&p=3.1478,101.6953,Only One");
    await expect(downloadPdf(page)).toBeDisabled();
  });

  test("sends every location under one category and radius", async ({ page }) => {
    await stubAnalysis(page);
    await stubReport(page);

    let body: Record<string, unknown> = {};
    page.on("request", (request) => {
      if (request.url().endsWith("/v1/report")) body = request.postDataJSON();
    });

    await page.goto(
      "/compare?c=korean_restaurant&r=500&p=3.1478,101.6953,Central KL&p=3.0738,101.5183,Suburban PJ",
    );
    await expect(downloadPdf(page)).toBeEnabled();

    const download = page.waitForEvent("download");
    await downloadPdf(page).click();
    await download;

    expect(body["kind"]).toBe("comparison");
    // Comparison-level, exactly once — not per location.
    expect(body["category"]).toBe("korean_restaurant");
    expect(body["radiusMetres"]).toBe(500);
    expect((body["locations"] as unknown[]).length).toBe(2);
  });
});
