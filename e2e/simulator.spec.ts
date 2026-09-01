import { expect, test } from "@playwright/test";

/**
 * The deterministic simulator, end to end.
 *
 * The load-bearing test here is the first one. "Instant recalculation" is the
 * central promise of the feature, and the only way to prove it is to cut the
 * network entirely and watch the figures still move.
 */

const HEADLINE = {
  revenue: "headline-revenue",
  profit: "headline-profit",
  breakEven: "headline-breakeven",
  cash: "headline-cash",
};

test.describe("instant recalculation", () => {
  test("figures update with the API completely unreachable", async ({ page }) => {
    // Cut every call to the service. If the engine were server-side, or if the
    // UI waited on a round-trip, nothing below would move.
    await page.route("**/v1/**", (route) => route.abort());
    await page.goto("/");

    // Note these differ from the golden vector's RM37,500: that vector pins
    // tradingDaysPerMonthOverride to 30 to reproduce the spec's worked
    // example, whereas the seeded scenario correctly derives 30.42 days from
    // seven days a week.
    const profit = page.getByTestId(HEADLINE.profit);
    await expect(profit).toHaveText("RM 38,418");
    await expect(page.getByTestId(HEADLINE.breakEven)).toHaveText("6 to 8 months");
    await expect(page.getByTestId(HEADLINE.cash)).toHaveText("RM 223,790");

    // Drag demand down 20%: 180 -> 144.
    const transactions = page.getByLabel("Transactions per day", { exact: true });
    await transactions.fill("144");
    await transactions.blur();

    await expect(profit).toHaveText("RM 25,015");
    await expect(page.getByTestId(HEADLINE.breakEven)).toHaveText("8 to 13 months");
  });

  test("raising the price lowers the cost-of-goods percentage (SPEC 4.3)", async ({ page }) => {
    await page.route("**/v1/**", (route) => route.abort());
    await page.goto("/");

    const cogs = page.getByLabel("Cost of goods", { exact: true });
    await expect(cogs).toHaveValue("32");

    const price = page.getByLabel("Average price per transaction", { exact: true });
    await price.fill("36");
    await price.blur();

    // Same RM5.76 unit cost over double the price.
    await expect(cogs).toHaveValue("16");
  });
});

test.describe("plausibility warnings", () => {
  test("warns on implausible seat turns without blocking the input", async ({ page }) => {
    await page.route("**/v1/**", (route) => route.abort());
    await page.goto("/");

    const transactions = page.getByLabel("Transactions per day", { exact: true });
    await transactions.fill("500");
    await transactions.blur();

    await expect(page.getByText(/seat-turns\/day/)).toBeVisible();
    // Advisory, never blocking: the value the user typed is still there.
    await expect(transactions).toHaveValue("500");
  });
});

test.describe("never breaks even", () => {
  test("names the failure and offers the nearest fix", async ({ page }) => {
    await page.route("**/v1/**", (route) => route.abort());
    await page.goto("/");

    await page.getByLabel("Average price per transaction", { exact: true }).fill("10");
    const transactions = page.getByLabel("Transactions per day", { exact: true });
    await transactions.fill("80");
    await transactions.blur();

    await expect(page.getByTestId(HEADLINE.breakEven)).toHaveText("Never at these inputs");
    await expect(page.getByText("To break even you would need one of:")).toBeVisible();
    // Rent cannot fix this scenario — it would have to go negative.
    await expect(page.getByText("cannot reach break-even on its own").first()).toBeVisible();
    await expect(page.getByText("closest to reach")).toBeVisible();
  });
});

test.describe("server parity", () => {
  test("confirms the running service agrees with the browser", async ({ page }) => {
    await page.goto("/");
    // The badge is the acceptance-criterion-#3 check surfaced live.
    await expect(page.getByText("server agrees")).toBeVisible({ timeout: 20_000 });
  });

  test("degrades to a notice when the service is unreachable", async ({ page }) => {
    await page.route("**/v1/**", (route) => route.abort());
    await page.goto("/");

    await expect(page.getByText("server unreachable")).toBeVisible({ timeout: 20_000 });
    // And the figures are entirely unaffected.
    await expect(page.getByTestId(HEADLINE.profit)).toHaveText("RM 38,418");
  });
});
