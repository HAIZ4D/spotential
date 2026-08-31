import { expect, test } from "@playwright/test";

/**
 * Share links, CSV and print — SPEC §7.7 and §7.8.
 *
 * The share URL is the entire persistence layer in v1, so a link that does not
 * reproduce its figures exactly is a data-loss bug, not a cosmetic one.
 */

test.beforeEach(async ({ page }) => {
  // Keep these hermetic: none of it depends on the service.
  await page.route("**/v1/**", (route) => route.abort());
});

test("a shared link reproduces the exact figures", async ({ page }) => {
  await page.goto("/");

  // The URL sync runs on a debounce, and it fires once for the DEFAULT
  // scenario before any edit. Capture that first, so the wait below is for the
  // edit landing rather than for the sync merely having happened.
  await expect
    .poll(() => new URL(page.url()).searchParams.get("s"), { timeout: 5_000 })
    .not.toBeNull();
  const defaultParam = new URL(page.url()).searchParams.get("s");

  // Build a distinctive scenario.
  await page.getByLabel("Average price per transaction", { exact: true }).fill("24");
  const transactions = page.getByLabel("Transactions per day", { exact: true });
  await transactions.fill("210");
  await transactions.blur();

  await expect
    .poll(() => new URL(page.url()).searchParams.get("s"), { timeout: 5_000 })
    .not.toBe(defaultParam);

  const profitBefore = await page.getByTestId("headline-profit").textContent();
  const breakEvenBefore = await page.getByTestId("headline-breakeven").textContent();
  const link = page.url();

  await page.goto("about:blank");
  await page.goto(link);

  await expect(page.getByTestId("headline-profit")).toHaveText(profitBefore!);
  await expect(page.getByTestId("headline-breakeven")).toHaveText(breakEvenBefore!);
  await expect(page.getByLabel("Transactions per day", { exact: true })).toHaveValue("210");
});

test("a corrupted link falls back to defaults with a notice", async ({ page }) => {
  await page.goto("/?s=v1.thisIsNotValidBase64Payload");

  await expect(page.getByText("could not be read")).toBeVisible();
  // Still usable rather than a blank screen.
  await expect(page.getByTestId("headline-profit")).toHaveText("RM 38,418");
});

/**
 * The banner must fire on a broken link and stay silent otherwise.
 *
 * It used to test `window.location.search.includes("s=")`, which matches ANY
 * parameter whose name ends in s — `?seats=40`, `?days=7`, `?utm_campaigns=x`
 * each produced a red error about a shared link that was never sent. Six of
 * twelve sampled URLs were false positives.
 */
test.describe("the shared-link notice", () => {
  test("stays silent when no scenario was offered", async ({ page }) => {
    for (const url of [
      "/simulator",
      "/simulator?seats=40",
      "/simulator?days=7",
      "/simulator?utm_campaigns=spring",
      "/simulator?options=1",
      // The real handoff from the analysis page seeds rent and district.
      "/simulator?rent=9000&category=korean_restaurant&district=klcc",
    ]) {
      await page.goto(url);
      await expect(page.getByText(/could not be read/)).toHaveCount(0);
      // And the page still works from defaults.
      await expect(page.getByTestId("headline-profit")).toBeVisible();
    }
  });

  test("still warns when a scenario was offered and is broken", async ({ page }) => {
    // Present but empty is a broken link, not an absent one — the decode
    // reason alone cannot tell those apart, which is why `supplied` exists.
    for (const url of ["/simulator?s=", "/simulator?s=garbage", "/simulator?s=v1.notBase64"]) {
      await page.goto(url);
      await expect(page.getByText(/could not be read/)).toBeVisible();
    }
  });

  test("says what to do about it", async ({ page }) => {
    await page.goto("/simulator?s=v1.notBase64");
    await expect(page.getByText(/Ask them to resend the link/)).toBeVisible();
  });
});

test("a hostile link cannot smuggle in an unknown field", async ({ page }) => {
  const hostile = Buffer.from(
    JSON.stringify({
      v: 1,
      p: "2026.08.1",
      e: "0.1.0",
      i: { businessCategory: "korean_restaurant", district: "mont_kiara", isAdmin: true },
    }),
  )
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await page.goto(`/?s=v1.${hostile}`);
  await expect(page.getByText("could not be read")).toBeVisible();
});

test("CSV downloads with the projection in it", async ({ page }) => {
  await page.goto("/");

  const download = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download CSV" }).click(),
  ]).then(([d]) => d);

  expect(download.suggestedFilename()).toMatch(/^spotential-korean_restaurant-\d{4}-\d{2}-\d{2}\.csv$/);

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const csv = Buffer.concat(chunks).toString("utf8");

  expect(csv).toContain("Monthly profit (RM),38418");
  expect(csv).toContain("Month,Ramp,Transactions/day");
  // Raw numbers only — formatted currency would land in Excel as text.
  expect(csv).not.toMatch(/RM\s[\d,]/);
});

test("print view hides the controls and keeps the figures", async ({ page }) => {
  await page.goto("/");
  await page.emulateMedia({ media: "print" });

  // Inputs, masthead and the AI panel are all chrome, not content.
  await expect(page.getByLabel("Transactions per day", { exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Download CSV" })).toBeHidden();

  // The numbers a bank would want are still there.
  await expect(page.getByTestId("headline-profit")).toBeVisible();
  await expect(page.getByText("Monthly cost breakdown")).toBeVisible();
  await expect(page.getByText("Break-even", { exact: true }).first()).toBeVisible();
});
