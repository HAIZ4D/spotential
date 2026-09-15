import { expect, test, type Page } from "@playwright/test";

/**
 * Vendor accounts, the redesigned event page, and applying.
 *
 * What is worth pinning here is not the layout. It is the four places this
 * feature could quietly start doing something it should not:
 *
 *   1. ASKING FOR MORE THAN IT NEEDS. The supplied design wanted a scan of the
 *      SSM certificate uploaded. The registration number alone is what makes a
 *      business checkable, and a bucket of identity documents is a security
 *      and retention surface this product has never opened. The absence of a
 *      file input is therefore a decision, and a test is how it stays one.
 *   2. TREATING CONSENT AS A DEFAULT. The box is unticked, it gates the
 *      button, and the server refuses without it.
 *   3. LETTING A CURATED LISTING LOOK BOOKABLE. Stated before the form, never
 *      discovered after submitting.
 *   4. LOSING A CAVEAT IN A REDESIGN. Folding content into a hero moves text,
 *      and text that moves is text that can vanish. The turnout attribution
 *      and the source note are asserted on the new page as well as the old.
 *
 * SIGNED IN IS NOT REACHABLE FROM CI, and deliberately so. The E2E bundle
 * carries no Firebase config, which is the same property `appcheck.spec` runs
 * on, so every assertion below is the signed-out half. The prefill and the
 * send are verified by hand against the deployed providers.
 */

const MAPS = "https://maps.googleapis.com/**";

const SEEDED = {
  id: "evt-1",
  slug: "terang-malam-market",
  name: "Terang Malam Market",
  summary: "Evening pop-up bazaar by the lake.",
  eventType: "bazaar",
  venueName: "Setia Ecohill Walk",
  address: "Semenyih, Selangor",
  state: "Selangor",
  point: { lat: 2.95, lng: 101.84 },
  startDate: "2099-09-25",
  endDate: "2099-09-27",
  dailyHours: "17:00 to 23:00",
  wantedCategories: ["cafe_coffee_shop", "bubble_tea_dessert"],
  packages: [
    {
      id: "std",
      label: "Standard lot",
      priceRm: 650,
      sizeLabel: "3m x 3m",
      slots: 45,
      slotsAvailable: 12,
      includes: ["Power point"],
    },
  ],
  totalSlots: 45,
  availableSlots: 12,
  expectedVisitors: 18_000,
  vendorRequirements: ["Own canopy", "Food handler certification"],
  organizerName: "Ecohill Community Events",
  source: "seed",
  sourceNote: "Sample listing curated to demonstrate scoring. NOT a live booking.",
  reviewed: "2026-08-31",
};

/**
 * The case the whole apply flow exists for, and the one no listing in the
 * shipped catalogue is yet: an event an organizer published themselves.
 */
const PUBLISHED = {
  ...SEEDED,
  // A REAL catalogue id, so `posterFor` resolves the bundled artwork and the
  // image path gets exercised. The seeded stub above deliberately keeps a
  // made-up id so the generated-cover path is covered too.
  id: "evt-santai-arabia",
  slug: "pasar-pagi-ttdi",
  name: "Pasar Pagi TTDI",
  organizerName: "TTDI Residents Association",
  source: "organizer",
  sourceNote: "Submitted by the organizer and reviewed before listing.",
};

async function stub(page: Page) {
  await page.route(MAPS, (route) => route.abort());

  for (const event of [SEEDED, PUBLISHED]) {
    await page.route(`**/v1/events/${event.slug}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          event,
          days: 3,
          entryPriceRm: event.packages[0]?.priceRm ?? null,
          venueCatchment: 3_100,
          catchmentRadiusMetres: 500,
        }),
      }),
    );
  }
}

/* ------------------------------------------------------------------ *
 * Registration                                                        *
 * ------------------------------------------------------------------ */

test("asks for the SSM number and never for a copy of the certificate", async ({ page }) => {
  await page.goto("/register");

  await expect(page.getByRole("heading", { name: "Join as an event vendor" })).toBeVisible();
  await expect(page.getByLabel(/SSM registration number/)).toBeVisible();

  /**
   * The deliberate omission. The number is a public-registry identifier and is
   * what an organizer needs to check a business is real; storing scans of
   * identity documents means a bucket to secure, a retention policy to honour
   * and a deletion obligation to answer. Asserted so it cannot quietly return.
   */
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.getByText(/never a copy of the certificate/)).toBeVisible();
});

test("will not submit until the details are complete and consent is given", async ({ page }) => {
  await page.goto("/register");

  const submit = page.getByRole("button", { name: "Create vendor account" });
  await expect(submit).toBeDisabled();

  await page.getByLabel("Full name").fill("Aina Rahim");
  await page.getByLabel("Email address").fill("aina@example.com");
  await page.getByLabel("Phone number").fill("+60123456789");
  await page.getByLabel("Password", { exact: true }).fill("a-long-enough-one");
  await page.getByLabel("Confirm password").fill("a-long-enough-one");
  await page.getByLabel("Company name").fill("Rahim Bakes");
  await page.getByLabel(/SSM registration number/).fill("202501234567");
  await page.getByLabel(/What you sell/).fill("Sourdough and filter coffee.");

  // Everything typed, consent still untouched. The box is the last gate, and
  // it is unticked by default because it is the moment a vendor's contact
  // details become shareable with a stranger.
  await expect(submit).toBeDisabled();

  await page.getByRole("checkbox").check();
  await expect(submit).toBeEnabled();
});

test("says so when the two passwords disagree, rather than failing at the server", async ({
  page,
}) => {
  await page.goto("/register");

  await page.getByLabel("Password", { exact: true }).fill("a-long-enough-one");
  await page.getByLabel("Confirm password").fill("a-different-one");

  await expect(page.getByText("Those two passwords do not match.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create vendor account" })).toBeDisabled();
});

test("the two account pages reach each other", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();

  await page.getByRole("link", { name: "Create a vendor account" }).click();
  await expect(page).toHaveURL(/\/register/);

  await page.getByRole("link", { name: "Log in" }).first().click();
  await expect(page).toHaveURL(/\/login/);
});

/* ------------------------------------------------------------------ *
 * The redesigned event page                                           *
 * ------------------------------------------------------------------ */

test("leads with the poster, and the poster is the biggest thing on the stage", async ({
  page,
}) => {
  await stub(page);
  await page.goto("/events/terang-malam-market");

  const stage = page.locator(".evx-stage");
  await expect(stage).toBeVisible();

  const stageBox = (await stage.boundingBox())!;
  expect(stageBox.y).toBeLessThan(400);

  /**
   * The whole point of the rebuild. The previous version squeezed the poster
   * into a 208px column beside the title, which made the only part of the page
   * an organizer actually designed the smallest element in it.
   *
   * WIDTH-AWARE, because the right answer differs. A phone gives the poster a
   * large share of a narrow screen; a desktop gives it a fixed column beside
   * the type. Asserting the desktop number everywhere failed on mobile at
   * exactly the cap the stylesheet sets, which is the design working.
   */
  const poster = (await page.locator(".evx-poster").boundingBox())!;
  const narrow = (page.viewportSize()?.width ?? 0) < 720;

  expect(poster.width).toBeGreaterThan(240);
  if (narrow) {
    // Dominant on a phone: most of the usable width, with a margin either side.
    expect(poster.width).toBeGreaterThan(stageBox.width * 0.6);
  } else {
    expect(poster.width).toBeGreaterThan(320);
  }

  // And it is shown WHOLE. A poster cropped to a landscape strip loses its
  // title, which is the part a vendor scans for.
  expect(poster.height).toBeGreaterThan(poster.width);

  await expect(stage.getByRole("heading", { name: "Terang Malam Market" })).toBeVisible();
  // Scoped to the dates-and-venue list: this listing has no artwork, so the
  // BUILT cover is what renders, and that carries the venue name too. Two
  // elements agreeing is not one element found twice.
  await expect(stage.locator(".evx-when").getByText(/Setia Ecohill Walk/)).toBeVisible();
});

test("shows a real poster whole where the organizer supplied one", async ({ page }) => {
  await stub(page);
  await page.goto("/events/pasar-pagi-ttdi");

  /**
   * The stub above borrows a real catalogue id, so the bundled artwork
   * resolves and this exercises the IMAGE path rather than the generated
   * cover. Both paths matter and only one of them was covered.
   */
  const img = page.locator(".evx-poster img");
  await expect(img).toBeVisible();

  // Declared dimensions, so the stage reserves the right box before the file
  // arrives instead of jolting when it lands.
  await expect(img).toHaveAttribute("width", /\d+/);
  await expect(img).toHaveAttribute("height", /\d+/);

  // Shown WHOLE. `object-fit: cover` here would behead the title, which is the
  // part a vendor scans for.
  const fit = await img.evaluate((el) => getComputedStyle(el).objectFit);
  expect(fit).not.toBe("cover");
});

test("puts the score below the poster and lays it out horizontally", async ({ page }) => {
  await stub(page);
  await page.goto("/events/terang-malam-market");

  const stage = (await page.locator(".evx-stage").boundingBox())!;
  const score = (await page.locator(".evx-score").boundingBox())!;
  // Below, not beside. It used to live in a right rail.
  expect(score.y).toBeGreaterThan(stage.y + stage.height - 1);

  /**
   * ACROSS, not stacked. Measured as a real row rather than by reading the
   * grid rule: the dimensions have to share horizontal bands, which is what
   * lets them be compared at a glance instead of scanned top to bottom.
   *
   * The invariant holds at every width and the exact shape does not: six in a
   * row on a desktop, three rows of two on a phone. Six distinct tops would
   * mean a stacked column, which is the thing this replaced.
   */
  const tops = await page
    .locator(".evx-meter")
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  expect(tops.length).toBe(6);

  const rows = new Set(tops).size;
  expect(rows).toBeLessThan(6);
  if ((page.viewportSize()?.width ?? 0) >= 1000) expect(rows).toBe(1);
});

test("never truncates a dimension label into nonsense", async ({ page }) => {
  await stub(page);
  await page.goto("/events/terang-malam-market");

  /**
   * The shared `.dim-bar-label` rule truncates with an ellipsis, which is
   * right in the narrow rail it was written for and wrong in this band.
   * "Booth affordab..." is not a label. Measured on the rendered box, because
   * the accessible name is unaffected by a visual clip and every other
   * assertion in this suite is name-based.
   */
  const clipped = await page.locator(".evx-meter .dim-bar-label").evaluateAll((els) =>
    els
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent ?? ""),
  );
  expect(clipped).toEqual([]);
});

test("keeps the fit score off the navy, where its own verdict colour would fail", async ({
  page,
}) => {
  await stub(page);
  await page.goto("/events/terang-malam-market");

  /**
   * `bandFor` paints the ring green, gold or red. Measured against the stage's
   * navy those are 3.6:1 and 2.5:1, so the one part of the ring that has to be
   * unmistakable is the part that fails. Keeping the score band on a light
   * ground is what makes that a non-issue, and this asserts the ground is
   * actually light rather than trusting a rule is still in the stylesheet.
   */
  const ground = await page.locator(".evx-score").evaluate((el) => {
    const rgb = getComputedStyle(el).backgroundColor.match(/\d+(\.\d+)?/g)!.map(Number);
    const lin = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(rgb[0]!) + 0.7152 * lin(rgb[1]!) + 0.0722 * lin(rgb[2]!);
  });

  // Navy sits at 0.039. Anything above 0.5 is unambiguously a light ground.
  expect(ground).toBeGreaterThan(0.5);
});

test("carries the turnout attribution and the source note through the redesign", async ({
  page,
}) => {
  await stub(page);
  await page.goto("/events/terang-malam-market");

  // Folding content into a hero moves text, and text that moves is text that
  // can vanish. Both of these are the page's honesty, not its decoration.
  await expect(page.getByText(/organizer's estimate/)).toBeVisible();

  /**
   * The boxed Provenance section was removed at the owner's request; the NOTE
   * it carried was not. It is the disclosure that the booth pricing is an
   * estimate rather than published terms, and that matters MORE now that
   * applications really send. A quiet line is not a box.
   */
  await expect(page.locator(".evx-sourceline")).toBeVisible();
  await expect(page.getByText(/NOT a live booking/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Where this listing came from" })).toHaveCount(0);
});

test("says what the organizer is recruiting in a sentence, not a field list", async ({ page }) => {
  await stub(page);
  await page.goto("/events/terang-malam-market");

  await expect(
    page.getByRole("heading", { name: "What this is, and who it wants" }),
  ).toBeVisible();
  await expect(page.getByText(/Ecohill Community Events is running/)).toBeVisible();
  // The categories are chips rather than a sentence fragment, and the reader's
  // own is marked so they can see at a glance whether they are wanted here.
  await expect(page.locator(".evx-wanted li")).not.toHaveCount(0);
  await expect(page.locator(".evx-wanted li.is-you")).toHaveCount(1);
});

/* ------------------------------------------------------------------ *
 * Applying                                                            *
 * ------------------------------------------------------------------ */

test("gates a real listing behind an account, and says why", async ({ page }) => {
  await stub(page);
  await page.goto("/events/pasar-pagi-ttdi");

  const apply = page.locator(".card.apply");
  await expect(apply.getByRole("heading", { name: "Apply for a booth" })).toBeVisible();

  // No form at all while signed out, not a disabled one: there is nothing
  // useful to type before there is somebody for the organizer to reply to.
  await expect(apply.getByRole("button", { name: /Send application/ })).toHaveCount(0);
  await expect(apply.getByRole("link", { name: "Join as a vendor" })).toBeVisible();
  await expect(apply.getByRole("link", { name: "I already have an account" })).toBeVisible();

  // And it names what still works without one, because almost everything does.
  await expect(apply.getByText(/never ask who you are/)).toBeVisible();
});

test("offers the same route in on a curated listing as on a published one", async ({ page }) => {
  await stub(page);
  await page.goto("/events/terang-malam-market");

  /**
   * This asserted the opposite until the owner reversed the rule: a curated
   * listing used to show no form AND no sign-in, because there was nothing to
   * apply to. Both kinds of listing now take applications, so both offer the
   * same way in, and what differs is the record and the copy rather than the
   * availability.
   */
  const apply = page.locator(".card.apply");
  await expect(apply.getByRole("link", { name: "Join as a vendor" })).toBeVisible();
  await expect(apply.getByRole("button", { name: /Send application/ })).toHaveCount(0);
});

test("the account gate clears the touch-target floor", async ({ page }) => {
  await stub(page);
  await page.goto("/events/pasar-pagi-ttdi");

  /**
   * The coarse-pointer specificity trap has now cost six controls in this
   * codebase. These two state `min-height` in their own base rule rather than
   * relying on the shared block, which sidesteps it, but the only check that
   * has ever caught the trap is measuring a real box.
   */
  for (const name of ["Join as a vendor", "I already have an account"]) {
    const box = (await page.getByRole("link", { name }).boundingBox())!;
    expect(box.height, name).toBeGreaterThanOrEqual(44);
  }
});

/* ------------------------------------------------------------------ *
 * Copy                                                                *
 * ------------------------------------------------------------------ */

test("no em or en dash on the new pages", async ({ page }) => {
  await stub(page);

  // `copy.spec` walks the four routes that existed when it was written. Three
  // new ones arrived with this feature, and a rule nothing checks is a rule
  // that lasts until the next paragraph anyone writes.
  for (const route of ["/register", "/login", "/events/terang-malam-market"]) {
    await page.goto(route);
    await page.waitForTimeout(600);
    const offenders = await page.evaluate(() =>
      document.body.innerText
        .split("\n")
        .filter((line) => /[–—]/.test(line))
        .map((line) => line.trim().slice(0, 120)),
    );
    expect(offenders, `dashes rendered on ${route}`).toEqual([]);
  }
});

/* ------------------------------------------------------------------ *
 * The rules, and whose voice they are in                              *
 * ------------------------------------------------------------------ */

test("keeps the organizer's requirements and our guidance in separate voices", async ({
  page,
}) => {
  await stub(page);
  await page.goto("/events/terang-malam-market");

  /**
   * THE ASSERTION THIS SECTION EXISTS FOR. The page prints the organizer's
   * real requirements verbatim a few centimetres from advice we wrote. If the
   * two ever read as one list, a vendor deciding whether to pay that organizer
   * would take our suggestions for their terms.
   */
  const theirs = page.locator(".evx-rulecard.organizer");
  await expect(theirs.getByText("Own canopy")).toBeVisible();
  await expect(theirs.getByText("their terms")).toBeVisible();
  await expect(theirs.getByRole("heading", { name: /Ecohill Community Events requires/ })).toBeVisible();

  const ours = page.locator(".evx-rulecard.ask");
  await expect(ours.getByText(/Spotential's guidance, not the organizer's terms/)).toBeVisible();
});

test("derives the do and do not lists from this event rather than printing a stock list", async ({
  page,
}) => {
  await stub(page);
  await page.goto("/events/terang-malam-market");

  await expect(page.getByRole("heading", { name: "Do, and do not" })).toBeVisible();
  // The label has to be on this block too, not only on the questions above it.
  await expect(
    page.locator("#do-dont").getByText(/Spotential's guidance, not the organizer's terms/),
  ).toBeVisible();

  /**
   * The stub event requires a canopy and trades to 23:00, so both the outdoor
   * and the after-dark items must be present. A static list would pass a
   * "renders something" check and fail this one.
   */
  const doCol = page.locator(".evx-dd-col.do");
  await expect(doCol.getByText(/Weight your canopy down/)).toBeVisible();
  await expect(doCol.getByText(/Bring your own light/)).toBeVisible();

  // Three days, so the stock-splitting item applies.
  await expect(doCol.getByText(/Split your stock across the days/)).toBeVisible();

  // And the page never claims to be able to confirm anything.
  await expect(page.getByText(/Spotential is not a party to any of it/)).toBeVisible();
});

test("counts the trading hours rather than leaving a reader to do it", async ({ page }) => {
  await stub(page);
  await page.goto("/events/terang-malam-market");

  // 17:00 to 23:00 across three days. Derived, so it cannot disagree with the
  // hours printed above it.
  const glance = page.locator("#glance");
  await expect(glance.getByText("18h")).toBeVisible();
  await expect(glance.getByText("6h")).toBeVisible();
});

test("never pushes the event page sideways", async ({ page }) => {
  await stub(page);

  /**
   * BOTH listings, and that is the whole point of the test.
   *
   * The seeded stub has no artwork, so it renders the BUILT cover, and that is
   * the case that overflowed: a grid item's `min-width` is `auto`, so the
   * cover's min-content pushed the stage to 456px inside a 412px phone
   * viewport and the page scrolled sideways. `overflow: hidden` on the stage
   * hid nothing, because the stage itself was the thing that had grown.
   *
   * The first probe I wrote checked only the listing WITH a poster and came
   * back clean, which is why the route-level guard checks both.
   */
  for (const slug of ["terang-malam-market", "pasar-pagi-ttdi"]) {
    await page.goto(`/events/${slug}`);
    await page.locator(".evx-stage").waitFor();

    const overflow = await page.evaluate(
      () => document.body.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, slug).toBeLessThanOrEqual(0);

    // And the stage itself fits, not merely the document. A stage wider than
    // the viewport with the overflow clipped elsewhere would still be wrong.
    const stage = (await page.locator(".evx-stage").boundingBox())!;
    const viewport = page.viewportSize()!.width;
    expect(stage.width, slug).toBeLessThanOrEqual(viewport);
  }
});

/* ------------------------------------------------------------------ *
 * The score band                                                      *
 * ------------------------------------------------------------------ */

test("lines every meter up on one baseline", async ({ page }) => {
  await stub(page);
  await page.goto("/events/terang-malam-market");

  /**
   * THE COMPLAINT THIS FIXES, measured rather than eyeballed.
   *
   * Each meter used to carry its own one-line explanation, and because those
   * lines were different lengths the bars and numbers never lined up: the band
   * read as unfinished. The notes moved into a disclosure and the meters share
   * the parent's rows, so every bar sits on one line whatever its label does.
   */
  // `evaluateAll` does not auto-wait, exactly like `count()`. Without this it
  // reads an empty list off a page React has not finished rendering.
  await expect(page.locator(".evx-meter")).toHaveCount(6);

  const bars = await page
    .locator(".evx-meter .dim-bar-track")
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));

  expect(bars.length).toBe(6);
  const rows = new Set(bars).size;
  // One row on a desktop, three rows of two on a phone. Never six.
  expect(rows).toBeLessThan(6);

  // Within a row, every bar is on exactly the same line.
  const widest = (page.viewportSize()?.width ?? 0) >= 1000;
  if (widest) expect(rows).toBe(1);
});

test("folds the reasoning away without losing it", async ({ page }) => {
  await stub(page);
  await page.goto("/events/terang-malam-market");

  const working = page.locator(".evx-working");
  await expect(working).toBeVisible();
  // Closed by default: the figures are the control, the reasoning is the
  // appendix. Same treatment the Location page gives its score working.
  await expect(working.getByText(/beyond their own doorstep/)).toBeHidden();

  await working.locator("summary").click();
  await expect(working.getByText(/beyond their own doorstep/)).toBeVisible();
  // Every dimension is explained, not just the ones that scored.
  await expect(working.locator("li")).toHaveCount(6);
});
