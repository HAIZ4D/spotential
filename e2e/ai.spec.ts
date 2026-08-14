import { expect, test, type Page } from "@playwright/test";
import { applyFieldValue, seedScenario, simulate } from "@spotential/sim-engine";

/**
 * The AI branch-and-revert flow — SPEC §7.3 and §8.3.
 *
 * The Gemini call is intercepted at the browser. The live model loop is
 * verified separately against the deployed service; paying for a model call on
 * every CI run would buy flakiness rather than confidence. What matters here
 * is what the UI does with a response: land the patch on a branch, mark the
 * inputs it touched, keep the baseline pinned, and revert cleanly.
 */

/**
 * A patch response shaped exactly as the service returns one.
 *
 * The payload is computed with the real engine rather than hand-written, so
 * the mock cannot drift from what the service would actually send — and it
 * exercises the same code the server would have run.
 */
async function mockPatch(page: Page) {
  const patched = applyFieldValue(
    seedScenario("korean_restaurant", "mont_kiara"),
    "customersPerDay",
    144,
  );

  await page.route("**/v1/simulate/ask", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        kind: "patch",
        label: "Demand -20%",
        rationale: "A 20% fall in customers per day.",
        operations: [{ field: "customersPerDay", op: "mul", value: 0.8 }],
        changedFields: ["customersPerDay"],
        inputs: patched,
        result: simulate(patched),
        narration: "Profit falls because your cost base is heavily fixed.",
      }),
    }),
  );
}

test("a patch lands on a branch, marks the input, and reverts", async ({ page }) => {
  await mockPatch(page);
  await page.goto("/");

  const transactions = page.getByLabel("Transactions per day", { exact: true });
  const profit = page.getByTestId("headline-profit");
  await expect(profit).toHaveText("RM 38,418");

  await page.getByPlaceholder("what if demand drops 20%?").fill("what if demand drops 20%?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();

  // The input the AI touched moves, and says so.
  await expect(transactions).toHaveValue("144");
  await expect(page.getByText("AI", { exact: true }).first()).toBeVisible();

  // Figures come from the engine, not the narration.
  await expect(profit).toHaveText("RM 25,015");
  await expect(page.getByTestId("headline-profit-delta")).toContainText("13,403");

  // The baseline is still pinned, so one click puts everything back.
  await page.getByRole("button", { name: "Revert to baseline" }).first().click();
  await expect(transactions).toHaveValue("180");
  await expect(profit).toHaveText("RM 38,418");
});

test("an out-of-scope question is declined and changes nothing", async ({ page }) => {
  await page.route("**/v1/simulate/ask", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        kind: "declined",
        reason: "Choosing a different city is outside what this simulator can answer.",
        suggestion: "Try lowering rent to model a cheaper area.",
      }),
    }),
  );
  await page.goto("/");

  await page.getByPlaceholder("what if demand drops 20%?").fill("should I move to Penang?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();

  await expect(page.getByText("outside what this simulator can answer")).toBeVisible();
  await expect(page.getByTestId("headline-profit")).toHaveText("RM 38,418");
  await expect(page.getByLabel("Transactions per day", { exact: true })).toHaveValue("180");
});

test("an ambiguous question asks once, and the panel is untouched", async ({ page }) => {
  await page.route("**/v1/simulate/ask", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        kind: "clarification",
        question: "By how much would you like demand to fall?",
      }),
    }),
  );
  await page.goto("/");

  await page.getByPlaceholder("what if demand drops 20%?").fill("what if it is slower?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();

  await expect(page.getByText("By how much would you like demand to fall?")).toBeVisible();
  await expect(page.getByTestId("headline-profit")).toHaveText("RM 38,418");
});

test("a failing assistant leaves the figures working", async ({ page }) => {
  await page.route("**/v1/simulate/ask", (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "ai_failed", message: "Could not reach the assistant." }),
    }),
  );
  await page.goto("/");

  await page.getByPlaceholder("what if demand drops 20%?").fill("what if demand drops 20%?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();

  await expect(page.getByText("Could not reach the assistant")).toBeVisible();

  // The deterministic core is untouched — the sliders still work.
  const transactions = page.getByLabel("Transactions per day", { exact: true });
  await transactions.fill("144");
  await transactions.blur();
  await expect(page.getByTestId("headline-profit")).toHaveText("RM 25,015");
});
