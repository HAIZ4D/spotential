import { expect, test, type Page } from "@playwright/test";
import { openSection } from "./sections.js";

/**
 * The location chatbot — Feature 3.
 *
 * Gemini is stubbed: CI must never spend on the model, and the guard that
 * makes this feature safe is unit-tested server-side. What matters here is the
 * browser contract — the request carries the page's own data, an answer
 * renders, and a failure leaves every deterministic panel working.
 */

const MAPS = "https://maps.googleapis.com/**";

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

async function stubChat(page: Page, body: unknown, status = 200) {
  await page.route("**/v1/location/ask", (route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }),
  );
}

const chat = (page: Page) => page.locator("section.card", { hasText: "Ask about this location" });
const box = (page: Page) => chat(page).getByLabel("Ask about this location");

const AT_KLCC = "/analysis?lat=3.1578&lng=101.7123&q=KLCC";

test.beforeEach(async ({ page }) => {
  await stubAnalysis(page);
});

test("states up front that it cannot calculate", async ({ page }) => {
  await stubChat(page, { kind: "answer", text: "ok" });
  await page.goto(AT_KLCC);
  await openSection(page, "Ask");

  // Same promise, now the section lede rather than a filled notice box. The
  // wording gained "already" and lost a sentence break the dash pass created.
  await expect(
    chat(page).getByText(/can only cite figures already shown on this page/),
  ).toBeVisible();
  await expect(chat(page).getByText(/does not\s+calculate/)).toBeVisible();
});

test("waits for the analysis before accepting a question", async ({ page }) => {
  await stubChat(page, { kind: "answer", text: "ok" });
  // Competitors never resolve, so there is nothing to be grounded on.
  await page.route("**/v1/competitors", () => {});
  await page.goto(AT_KLCC);
  await openSection(page, "Ask");

  await expect(box(page)).toBeDisabled();
  await expect(box(page)).toHaveAttribute("placeholder", /Waiting for the analysis/);
});

test("sends the page's own data and no score, then shows the answer", async ({ page }) => {
  await stubChat(page, {
    kind: "answer",
    text: "Competition scores 45 here, the weakest of the five dimensions.",
  });

  let body: Record<string, unknown> = {};
  page.on("request", (request) => {
    if (request.url().endsWith("/v1/location/ask")) body = request.postDataJSON();
  });

  await page.goto(AT_KLCC);
  await openSection(page, "Ask");
  await expect(box(page)).toBeEnabled();
  await box(page).fill("why did it score that?");
  await chat(page).getByRole("button", { name: "Ask" }).click();

  await expect(chat(page).getByText(/the weakest of the five dimensions/)).toBeVisible();

  expect(body["question"]).toBe("why did it score that?");
  expect(body["category"]).toBe("korean_restaurant");
  // The server rebuilds the facts from these with the shared engine. A posted
  // score would let the chat cite something the panels never produced.
  expect(body["location"]).not.toHaveProperty("score");
  expect((body["location"] as Record<string, unknown>)["competitors"]).toMatchObject({ total: 12 });
});

test("offers openers that map onto what the data holds", async ({ page }) => {
  await stubChat(page, { kind: "answer", text: "Competition is the weakest dimension." });
  await page.goto(AT_KLCC);
  await openSection(page, "Ask");

  await chat(page).getByRole("button", { name: "How crowded is it here?" }).click();
  await expect(chat(page).getByText(/Competition is the weakest dimension/)).toBeVisible();
});

test("shows a refusal rather than an invented figure", async ({ page }) => {
  // What the server sends when its numeric guard fires.
  await stubChat(page, {
    kind: "refused",
    reason:
      "I could not answer that without working out a figure myself, and every number here has " +
      "to come from the panels on this page.",
  });

  await page.goto(AT_KLCC);
  await openSection(page, "Ask");
  await box(page).fill("what percent of revenue is rent?");
  await chat(page).getByRole("button", { name: "Ask" }).click();

  await expect(chat(page).getByText(/every number here has to come from the panels/)).toBeVisible();
});

test("passes on a decline with the nearest thing it can answer", async ({ page }) => {
  await stubChat(page, {
    kind: "declined",
    reason: "There is no seasonal data here.",
    suggestion: "Ask about competitor density instead.",
  });

  await page.goto(AT_KLCC);
  await openSection(page, "Ask");
  await box(page).fill("how busy is Ramadan?");
  await chat(page).getByRole("button", { name: "Ask" }).click();

  await expect(chat(page).getByText(/no seasonal data/)).toBeVisible();
  await expect(chat(page).getByText(/competitor density instead/)).toBeVisible();
});

test("a view change moves the control rather than answering", async ({ page }) => {
  await stubChat(page, {
    kind: "adjust",
    category: null,
    radiusMetres: 1000,
    why: "Widening the search to 1km.",
  });

  await page.goto(AT_KLCC);
  await openSection(page, "Ask");
  await expect(page.getByLabel("Search radius")).toHaveValue("500");

  await box(page).fill("what about 1km?");
  await chat(page).getByRole("button", { name: "Ask" }).click();

  // The model proposes; the page's own cached fetch executes.
  await expect(page.getByLabel("Search radius")).toHaveValue("1000");
  // And it must not describe a view it has not seen.
  await expect(chat(page).getByText(/ask again once they have/i)).toBeVisible();
});

test("says the figures are unaffected when the assistant fails", async ({ page }) => {
  await stubChat(
    page,
    { error: "ai_failed", message: "Could not reach the assistant. Every figure on the page is unaffected." },
    502,
  );

  await page.goto(AT_KLCC);
  await openSection(page, "Ask");
  await box(page).fill("why so low?");
  await chat(page).getByRole("button", { name: "Ask" }).click();

  await expect(chat(page).getByText(/Every figure on the page is unaffected/)).toBeVisible();

  /**
   * The deterministic core is untouched by an AI failure. The score survives
   * in the hero, and the working behind it is still one click away: the table
   * sits inside a disclosure now, so the test opens it as a reader would.
   */
  await expect(page.getByRole("img", { name: /Success score/ })).toBeVisible();
  await openSection(page, "Overview");
  await page.locator(".score-working > summary").click();
  await expect(page.getByRole("table").getByText("Competition")).toBeVisible();
});

test("keeps the conversation and can clear it", async ({ page }) => {
  await stubChat(page, { kind: "answer", text: "Competition is the weakest dimension." });
  await page.goto(AT_KLCC);
  await openSection(page, "Ask");

  await box(page).fill("first question");
  await chat(page).getByRole("button", { name: "Ask" }).click();
  await expect(chat(page).getByText("first question")).toBeVisible();

  await chat(page).getByRole("button", { name: "Clear" }).click();
  await expect(chat(page).getByText("first question")).toHaveCount(0);
});

test("the simulator route has no location chat", async ({ page }) => {
  await page.goto("/simulator");
  await expect(page.getByText("Ask about this location")).toHaveCount(0);
});
