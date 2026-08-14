import { expect, test, type Page } from "@playwright/test";
import { openSection } from "./sections.js";

/**
 * District demographics — Feature 1c.
 *
 * The load-bearing assertion is that district population is never presented as
 * a catchment. KL district is over two million people; a 500m radius is not,
 * and this panel sits next to a break-even calculator.
 */

const MAPS = "https://maps.googleapis.com/**";

function payload(over: Record<string, unknown> = {}) {
  return {
    matched: true,
    resolution: "district",
    demographics: {
      district: "W.P. Kuala Lumpur",
      state: "W.P. Kuala Lumpur",
      total: 2_074_100,
      age: {
        "0-4": 100600, "5-9": 126600, "10-14": 121600, "15-19": 142900,
        "20-24": 142400, "25-29": 146400, "30-34": 205000, "35-39": 238900,
        "40-44": 243200, "45-49": 177900, "50-54": 128400, "55-59": 79800,
        "60-64": 72500, "65-69": 46200, "70-74": 45500, "75-79": 30800,
        "80-84": 16000, "85+": 9200,
      },
      ethnicity: {
        bumi_malay: 862300, bumi_other: 21000, chinese: 729500,
        indian: 176900, other_citizen: 13800, other_noncitizen: 270700,
      },
    },
    vintage: "2025",
    reviewed: "2026-08-12",
    sourceNote: "CC BY 4.0, Department of Statistics Malaysia",
    ...over,
  };
}

async function stub(page: Page, over: Record<string, unknown> = {}) {
  await page.route("**/v1/demographics", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload(over)),
    }),
  );
  // Quiet the neighbours so assertions cannot collide.
  for (const path of ["**/v1/competitors", "**/v1/opportunity-gaps"]) {
    await page.route(path, (route) =>
      route.fulfill({ status: 502, contentType: "application/json", body: "{}" }),
    );
  }
}

test.beforeEach(async ({ page }) => {
  await page.route(MAPS, (route) => route.abort());
});

test("shows the district and its mix", async ({ page }) => {
  await stub(page);
  await page.goto("/analysis?lat=3.1478&lng=101.6953");
  await openSection(page, "People");

  await expect(page.getByText("Area demographics")).toBeVisible();
  await expect(page.getByRole("main").getByText("W.P. Kuala Lumpur").first()).toBeVisible();
  await expect(page.getByText("AGE DISTRIBUTION")).toBeVisible();
  await expect(page.getByText("ETHNIC MIX")).toBeVisible();
});

test("never presents district population as a catchment", async ({ page }) => {
  // The whole point of the panel's framing.
  await stub(page);
  await page.goto("/analysis?lat=3.1478&lng=101.6953");
  await openSection(page, "People");

  await expect(page.getByText(/not.*a catchment estimate for your radius/i)).toBeVisible();
  await expect(page.getByText(/would badly overstate your market/)).toBeVisible();
});

test("shows proportions, not raw headcounts, in the breakdown", async ({ page }) => {
  await stub(page);
  await page.goto("/analysis?lat=3.1478&lng=101.6953");
  await openSection(page, "People");

  // Percentages transfer to a small radius; absolute counts do not.
  await expect(page.getByText("41.6%")).toBeVisible(); // Malay share
  await expect(page.getByText("35.2%")).toBeVisible(); // Chinese share
});

test("attributes the source and vintage", async ({ page }) => {
  await stub(page);
  await page.goto("/analysis?lat=3.1478&lng=101.6953");
  await openSection(page, "People");

  await expect(page.getByText(/Department of Statistics Malaysia, 2025 estimates/)).toBeVisible();
  await expect(page.getByText(/geoBoundaries/)).toBeVisible();
});

test("explains a point with no district rather than showing zeroes", async ({ page }) => {
  await stub(page, { matched: false, resolution: "none", demographics: null });
  await page.goto("/analysis?lat=5.0&lng=110.0");
  await openSection(page, "People");

  await expect(page.getByText(/does not fall inside any Malaysian administrative district/)).toBeVisible();
});

test("a failing lookup leaves the rest of the page working", async ({ page }) => {
  await page.route("**/v1/demographics", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
  );
  await page.goto("/analysis?lat=3.1478&lng=101.6953&q=KL");
  await openSection(page, "People");

  await expect(page.getByText(/Could not load demographic data/)).toBeVisible();
  await expect(page.getByText("3.14780, 101.69530")).toBeVisible();
});

test("the simulator route never requests demographics", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/v1/demographics")) calls.push(r.url());
  });

  await page.goto("/simulator");
  await expect(page.getByTestId("headline-profit")).toBeVisible();
  await page.waitForTimeout(1_000);

  expect(calls).toEqual([]);
});
