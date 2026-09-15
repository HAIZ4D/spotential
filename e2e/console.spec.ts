import { expect, test, type Page } from "@playwright/test";
import { PATCHABLE_FIELDS } from "@spotential/sim-engine";

/**
 * The what-if console.
 *
 * The simulator used to open with a KPI strip, then a narrow sidebar holding
 * the ask box above seventeen form fields, with the charts it moves in a
 * different column. So the one thing the page is for was the smallest thing on
 * it, and a question and its consequence were never on screen together.
 *
 * These tests are about that inversion, and about the two things the aurora
 * must not cost: legibility and the deterministic core.
 */

const PATCH = {
  kind: "patch",
  label: "Demand down 20%",
  rationale: "A 20% fall in customers per day.",
  // `mul`, the engine's actual vocabulary. The first version of this fixture
  // said "multiply", which is what the component was guessing too — so the
  // test agreed with the bug instead of catching it.
  operations: [{ field: "customersPerDay", op: "mul", value: 0.8 }],
  changedFields: ["customersPerDay"],
  narration: "Fewer customers cuts revenue straight through to profit.",
};

/**
 * Answers with a REAL patched scenario: the inputs come back from the page's
 * own request, so the engine recomputes rather than the test inventing figures.
 */
async function stubPatch(page: Page) {
  await page.route("**/v1/simulate/ask", async (route) => {
    const body = route.request().postDataJSON() as { inputs: Record<string, number> };
    const inputs = {
      ...body.inputs,
      customersPerDay: Math.round((body.inputs["customersPerDay"] ?? 180) * 0.8),
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...PATCH, inputs, result: null }),
    });
  });
}

const ask = (page: Page) => page.getByLabel("Ask a what-if question");
const askButton = (page: Page) => page.getByRole("button", { name: "Ask", exact: true });

test("the console is the first thing on the page", async ({ page }) => {
  await page.goto("/simulator");

  const console_ = page.locator(".simconsole");
  await expect(console_).toBeVisible();
  await expect(console_.getByText("Ask what would happen.")).toBeVisible();

  // Above the figures it moves, so cause and effect are adjacent. The KPI
  // strip used to be first and the ask box was in a sidebar below it.
  const consoleBox = (await console_.boundingBox())!;
  const kpiBox = (await page.locator(".headline").first().boundingBox())!;
  expect(consoleBox.y).toBeLessThan(kpiBox.y);
});

test("the ask field has an accessible name, which it never had", async ({ page }) => {
  await page.goto("/simulator");
  // It carried only a placeholder before. A placeholder is not a name: it
  // disappears on the first keystroke and screen readers may not announce it.
  await expect(ask(page)).toBeVisible();
  await expect(ask(page)).toHaveAttribute("aria-label", "Ask a what-if question");
});

test("names the parameters the model changed, never a figure it wrote", async ({ page }) => {
  await stubPatch(page);
  await page.goto("/simulator");

  await ask(page).fill("what if demand drops 20%?");
  await askButton(page).click();

  /**
   * The honesty surface. The model returns operations on parameters and the
   * engine computes everything else, but that used to be a claim the reader
   * had to take on trust because the patch itself was invisible.
   */
  const chips = page.locator(".sim-ops li");
  await expect(chips).toHaveCount(1);
  await expect(chips.first()).toContainText("Customers / day");
  // "−20%", not "set to 1": a chip that misdescribes the patch is worse than
  // no chip, because the chip is what makes the patch checkable.
  await expect(chips.first()).toContainText("−20%");

  // And the input it names really did move, in the levers rail.
  await expect(page.getByLabel("Transactions per day", { exact: true })).toHaveValue("144");
});

test("an unreachable assistant leaves every figure and lever working", async ({ page }) => {
  await page.route("**/v1/simulate/ask", (route) =>
    route.fulfill({ status: 502, contentType: "application/json", body: "{}" }),
  );
  await page.goto("/simulator");

  await ask(page).fill("what if demand drops 20%?");
  await askButton(page).click();

  await expect(page.locator(".sim-note.warn")).toBeVisible();

  // The deterministic core is untouched: the engine runs in the browser, so
  // the levers still move the figures with the assistant down.
  const transactions = page.getByLabel("Transactions per day", { exact: true });
  await transactions.fill("200");
  await expect(page.locator(".headline")).toContainText("RM");
  await expect(transactions).toHaveValue("200");
});

test("the aurora stops under reduced motion, and nothing is stranded", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/simulator");

  await expect(page.locator(".simconsole")).toBeVisible();

  const animated = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".aurora i")].filter(
      (el) => getComputedStyle(el).animationName !== "none",
    ).length,
  );
  expect(animated).toBe(0);

  // Present and readable regardless: the blobs are decoration, not structure.
  await expect(page.getByText("Ask what would happen.")).toBeVisible();
  await context.close();
});

test("the console stays legible across the aurora's whole loop", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "sampled once, on the desktop layout");
  await page.goto("/simulator");
  const box = (await page.locator(".simconsole").boundingBox())!;

  /**
   * Sampled REPEATEDLY, and inset.
   *
   * A single reading measures one frame of a moving background, and the frame
   * that matters is the aurora's brightest crest rather than its rest state.
   * Inset because the console is full-bleed: its edges are flat navy and would
   * supply a flattering dark end to the range on their own.
   */
  const ratios: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    await page.waitForTimeout(1500);
    const shot = await page.screenshot({
      clip: { x: box.x + 40, y: box.y + 20, width: box.width - 80, height: box.height - 40 },
    });
    ratios.push(
      await page.evaluate(
        (b64) =>
          new Promise<number>((resolve) => {
            const img = new Image();
            img.onload = () => {
              const canvas = document.createElement("canvas");
              canvas.width = img.width;
              canvas.height = img.height;
              const ctx = canvas.getContext("2d");
              if (!ctx) return resolve(-1);
              ctx.drawImage(img, 0, 0);
              const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
              const channel = (v: number) => {
                const c = v / 255;
                return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
              };
              const lums: number[] = [];
              for (let p = 0; p < data.length; p += 4) {
                lums.push(
                  0.2126 * channel(data[p]!) +
                    0.7152 * channel(data[p + 1]!) +
                    0.0722 * channel(data[p + 2]!),
                );
              }
              lums.sort((a, b) => a - b);
              const at = (q: number) => lums[Math.floor(q * (lums.length - 1))]!;
              // p60 is the brightest ground the text ever has to sit on.
              resolve((1.05) / (at(0.6) + 0.05));
            };
            img.onerror = () => resolve(-1);
            img.src = "data:image/png;base64," + b64;
          }),
        shot.toString("base64"),
      ),
    );
  }

  expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
});

test("print keeps the figures and drops the console", async ({ page }) => {
  await page.goto("/simulator");
  await page.emulateMedia({ media: "print" });

  // The console is `no-print`: a question box is useless on paper, and the
  // aurora would be a solid block of ink.
  await expect
    .poll(() => page.locator(".simconsole").evaluate((el) => getComputedStyle(el).display))
    .toBe("none");

  await expect(page.getByText("Assumptions")).toBeVisible();
});

test("the wait shows the levers it may move, and only those", async ({ page }) => {
  // Held open so the thinking state can be inspected. The real wait is 13 to
  // 46 seconds against the live model, which is what this state exists for.
  await page.route("**/v1/simulate/ask", async (route) => {
    await new Promise((r) => setTimeout(r, 4000));
    const body = route.request().postDataJSON() as { inputs: Record<string, number> };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...PATCH, inputs: body.inputs, result: null }),
    });
  });

  await page.goto("/simulator");
  await ask(page).fill("what if demand drops 20%?");
  await askButton(page).click();

  const scan = page.locator(".sim-scan-chip");
  await expect(scan.first()).toBeVisible();

  /**
   * EVERY CHIP IS A REAL PATCHABLE FIELD.
   *
   * The state claims "it only ever changes these". A chip for something the
   * model cannot touch would make that claim false, and it is the sort of
   * drift a label map invites — this is the second time in this feature that
   * a hand-written vocabulary disagreed with the engine's.
   */
  await expect(scan).toHaveCount(PATCHABLE_FIELDS.length);
  await expect(page.getByText("It only ever changes these")).toBeVisible();

  // A metaphor for choosing, never a progress bar: there are no callbacks from
  // the model, so anything that looked like measured progress would measure
  // nothing.
  await expect(page.getByText("Choosing which of these to move")).toBeVisible();
});

test("the chips the answer keeps are the ones the patch names", async ({ page }) => {
  await stubPatch(page);
  await page.goto("/simulator");
  await ask(page).fill("what if demand drops 20%?");
  await askButton(page).click();

  // The payoff: the reader watched these being considered, and now sees which
  // one was chosen. One operation in the patch, one chip left lit.
  const picked = page.locator(".sim-ops li.sim-op-picked");
  await expect(picked).toHaveCount(1);
  await expect(picked.first()).toContainText("Customers / day");
  await expect(page.locator(".sim-scan-chip")).toHaveCount(0);
});

test("every panel answers before it shows, with the API unreachable", async ({ page }) => {
  // The ledes are derived from the result object and the engine runs in the
  // browser, so they must render with nothing reachable at all.
  await page.route("**/v1/**", (route) => route.abort());
  await page.goto("/simulator");

  const ledes = page.locator(".panel-lede");
  await expect(ledes).toHaveCount(4);
  await expect(ledes.first()).toContainText(/out of pocket/);
  await expect(page.getByText(/just covers the fixed costs/)).toBeVisible();
  await expect(page.getByText(/moves the answer more than anything else/)).toBeVisible();
});

test("the cost lines are folded but still tally", async ({ page }) => {
  await page.route("**/v1/**", (route) => route.abort());
  await page.goto("/simulator");

  // Folded, so the panel stops reading as a ledger.
  await expect(page.locator(".cost-working:not([open])")).toBeVisible();

  await page.getByText("Show every line").click();

  /**
   * Folded, NEVER trimmed. Showing only the largest lines would break the
   * tally, and a partial list that still looked like a total would be worse
   * than a table nobody opens.
   */
  // Scoped to the body: the header cell reads "% of revenue", so a bare text
  // filter for "Revenue" matches it too.
  const rows = page.locator(".cost-working table tbody tr");
  await expect(rows.first()).toContainText("Revenue");
  await expect(rows.last()).toContainText("Profit");
  await expect(rows.last()).toHaveClass(/total/);

  /**
   * AND IT REALLY TALLIES.
   *
   * `toHaveCount(await rows.count())` was the first version of this line and it
   * is a tautology — it asserts a number against itself. What "the table has to
   * tally" actually means is that its profit row equals the profit figure the
   * page shows above it, so that is what gets checked: the same number reached
   * two different ways.
   */
  const headline = (await page.getByTestId("headline-profit").textContent())!.trim();
  await expect(rows.last()).toContainText(headline);
});

test("the sweep stops under reduced motion", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.route("**/v1/simulate/ask", async (route) => {
    await new Promise((r) => setTimeout(r, 4000));
    await route.abort();
  });
  await page.goto("/simulator");
  await ask(page).fill("what if demand drops 20%?");
  await askButton(page).click();
  await expect(page.locator(".sim-scan-chip").first()).toBeVisible();

  const animated = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".sim-scan-chip")].filter(
      (el) => getComputedStyle(el).animationName !== "none",
    ).length,
  );
  expect(animated).toBe(0);
  await context.close();
});

test.describe("the Spotential mark, thinking", () => {
  const hold = (page: Page) =>
    page.route("**/v1/simulate/ask", async (route) => {
      await new Promise((r) => setTimeout(r, 12000));
      await route.abort();
    });

  test("the real artwork carries the wait, on a disc that keeps it legible", async ({ page }) => {
    await hold(page);
    await page.goto("/simulator");
    await ask(page).fill("what if demand drops 20%?");
    await askButton(page).click();

    await expect(page.locator(".st-disc")).toBeVisible();

    /**
     * ON A DISC, not bare on the navy. The mark's own darkest navy is the same
     * family as the console behind it, so the S loses its edge without a light
     * ground — the same reason the navbar gives the logo a chip.
     */
    await expect
      .poll(() => page.locator(".st-disc").evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe("rgb(255, 255, 255)");

    // The real file, never a trace of it.
    const src = await page.locator(".st-mark").getAttribute("src");
    expect(src).toMatch(/spotential-mark/);
  });

  test("particles orbit and return, so the loop closes", async ({ page }) => {
    await hold(page);
    await page.goto("/simulator");
    await ask(page).fill("what if demand drops 20%?");
    await askButton(page).click();
    await expect(page.locator(".st").first()).toBeVisible();

    const reach = async () =>
      page.locator(".st-dot").first().evaluate((el) => {
        const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
        return { x: Math.round(m.m41), opacity: Number(getComputedStyle(el).opacity) };
      });

    // Out.
    await expect.poll(async () => (await reach()).x, { timeout: 9000 }).toBeGreaterThan(20);
    // And home again, which is what makes a 4.5s loop join invisibly.
    await expect.poll(async () => (await reach()).opacity, { timeout: 9000 }).toBeLessThan(0.1);
  });

  test("the light travels through the artwork, not across a box", async ({ page }) => {
    await hold(page);
    await page.goto("/simulator");
    await ask(page).fill("what if demand drops 20%?");
    await askButton(page).click();
    await expect(page.locator(".st-sweep")).toBeAttached();

    /**
     * Masked by the PNG's own alpha. That is the whole reason a raster logo
     * was not a blocker for this brief: without the mask the sweep would be a
     * rectangle sliding over the disc.
     */
    const mask = await page
      .locator(".st-sweep")
      .evaluate((el) => getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage);
    expect(mask).toContain("spotential-mark");
  });

  test("it holds still for anyone who asked for less motion", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await hold(page);
    await page.goto("/simulator");
    await ask(page).fill("what if demand drops 20%?");
    await askButton(page).click();
    await expect(page.locator(".st-disc")).toBeVisible();

    // The mark stays and stays the brand; it simply does not move.
    const spinning = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".st-ring")].filter(
        (el) => getComputedStyle(el).animationName !== "none",
      ).length,
    );
    expect(spinning).toBe(0);

    await expect(page.locator(".st-mark")).toBeVisible();
    await context.close();
  });
});

test.describe("the console's motion identity", () => {
  const hold = (page: Page) =>
    page.route("**/v1/simulate/ask", async (route) => {
      await new Promise((r) => setTimeout(r, 25000));
      await route.abort();
    });

  test("one signature curve carries the console", async ({ page }) => {
    await page.goto("/simulator");

    /**
     * The Premium archetype: `cubic-bezier(0.4, 0, 0.2, 1)`, no overshoot.
     * The first build used four unrelated easings, which is why it read as
     * assembled rather than designed. One curve is the point.
     */
    /**
     * Compared as NUMBERS, not as a string. The minifier serialises the token
     * as `cubic-bezier(.4, 0, .2, 1)` — the identical curve with the leading
     * zeros stripped — so a literal string match tests the build's formatting
     * rather than the motion.
     */
    const points = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);

    const token = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--ease-premium").trim(),
    );
    expect(points(token)).toEqual([0.4, 0, 0.2, 1]);

    const easings = await page.evaluate(() =>
      [".aurora", ".sim-ask"].map((sel) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).transitionTimingFunction : "missing";
      }),
    );
    for (const e of easings) expect(points(e)).toEqual([0.4, 0, 0.2, 1]);
  });

  test("no more than a third of the particles move at once", async ({ page }) => {
    await hold(page);
    await page.goto("/simulator");
    await ask(page).fill("what if demand drops 20%?");
    await askButton(page).click();
    await expect(page.locator(".st").first()).toBeVisible();

    /**
     * IN TRANSIT means x is CHANGING, not that the dot is on screen. The first
     * version of this measurement counted dots parked at full radius, which is
     * ambient orbit rather than a transition competing for attention — it
     * reported 8 of 8 and sent me looking for a bug that was in the ruler.
     *
     * Three waves that do not overlap is what keeps this inside the 1/3 rule.
     */
    const xs = () =>
      page.evaluate(() =>
        [...document.querySelectorAll(".st-dot")].map(
          (d) => new DOMMatrixReadOnly(getComputedStyle(d).transform).m41,
        ),
      );

    let worst = 0;
    for (let i = 0; i < 26; i += 1) {
      const before = await xs();
      await page.waitForTimeout(120);
      const after = await xs();
      worst = Math.max(worst, before.filter((v, k) => Math.abs(after[k]! - v) > 1.5).length);
    }
    expect(worst).toBeLessThanOrEqual(3);
  });

  test("the breath stays inside the waiting band", async ({ page }) => {
    await hold(page);
    await page.goto("/simulator");
    await ask(page).fill("what if demand drops 20%?");
    await askButton(page).click();
    await expect(page.locator(".st-mark")).toBeVisible();

    // 0.98 to 1.02 for a waiting state. Past ±5% the skill calls a pulse
    // attention-demanding, and this one is meant to keep company, not nag.
    const scales: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      scales.push(
        await page
          .locator(".st-mark")
          .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a),
      );
      await page.waitForTimeout(200);
    }
    expect(Math.max(...scales)).toBeLessThanOrEqual(1.02);
    expect(Math.min(...scales)).toBeGreaterThanOrEqual(0.98);
  });

  test("the aurora has depth: its layers travel different distances", async ({ page }) => {
    await page.goto("/simulator");
    await expect(page.locator(".aurora i").first()).toBeAttached();

    const at = () =>
      page.evaluate(() =>
        [...document.querySelectorAll(".aurora i")].map((el) => {
          const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
          return { x: m.m41, y: m.m42 };
        }),
      );

    const before = await at();
    await page.waitForTimeout(4000);
    const after = await at();
    const travel = before.map((s, i) => Math.hypot(after[i]!.x - s.x, after[i]!.y - s.y));

    /**
     * Three blobs drifting the same distance is a flat wash, which is what
     * this was. Parallax is the difference between a background and a field.
     */
    expect(travel[0]!).toBeGreaterThan(travel[1]!);
    expect(travel[1]!).toBeGreaterThan(travel[2]!);
  });
});
