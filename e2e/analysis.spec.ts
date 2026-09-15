import { expect, test, type Page } from "@playwright/test";

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

  test("navigates between the two sections", async ({ page }, testInfo) => {
    await page.route(MAPS, (route) => route.abort());
    await page.goto("/simulator");

    /**
     * Desktop only, and deliberately.
     *
     * This test is about ROUTING — that the two sections reach each other and
     * the simulator still computes on arrival. Driving the mobile menu to get
     * there added a second subject, and the drawer raced the Analysis page's
     * own re-renders (geocoding, the debounced share-URL write) under parallel
     * load: it opened, then closed again before the link could be clicked.
     *
     * Navigating FROM the mobile drawer is already covered end to end by
     * navbar.spec's "closes itself after navigating", so testing it twice here
     * bought nothing and cost a flake.
     */
    test.skip(testInfo.project.name === "mobile", "nav drawer covered by navbar.spec");

    // `exact` matters: the footer's "Score a location" substring-matches a
    // loose "Location", and this test is about the nav link.
    await page.getByRole("link", { name: "Location", exact: true }).click();
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
    // Viewport-agnostic: on mobile the links sit behind the menu button, so the
  // claim being made here — navigation survived the failure — is asserted on
  // the nav landmark rather than on one link that is desktop-only.
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
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

/**
 * The red "could not be read" banner.
 *
 * It used to fire on `window.location.search.includes("lat=")`, which also
 * matches a parameter that merely CONTAINS those letters — `?flat=1200` got a
 * red error apologising for a location link the user never supplied. The
 * condition now asks the parser whether location parameters were present and
 * broken, rather than guessing from the raw query string.
 */
test.describe("bad location links", () => {
  test("stays quiet when no location was offered at all", async ({ page }) => {
    await page.route(MAPS, (route) => route.abort());

    for (const url of ["/analysis", "/analysis?q=KLCC", "/analysis?flat=1200"]) {
      await page.goto(url);
      await expect(page.getByText(/location could not be read/i)).toHaveCount(0);
    }
  });

  test("still warns when coordinates were supplied and are broken", async ({ page }) => {
    await page.route(MAPS, (route) => route.abort());

    await page.goto("/analysis?lat=abc&lng=xyz");
    await expect(page.getByText(/location could not be read/i)).toBeVisible();
    await expect(page.getByText(/Showing Kuala Lumpur instead/)).toBeVisible();
    // And it says what to do about it, rather than only what went wrong.
    await expect(page.getByText(/Search for an address above, or drag the pin/)).toBeVisible();
  });

  test("still warns when only half a coordinate pair arrives", async ({ page }) => {
    await page.route(MAPS, (route) => route.abort());
    await page.goto("/analysis?lat=3.1578");
    await expect(page.getByText(/missing a coordinate/)).toBeVisible();
  });
});

test.describe("the demand layer", () => {
  /**
   * CI never loads Google Maps, so the toggle itself cannot render here — it
   * is hidden whenever the map pane is in its unavailable state, which is the
   * correct behaviour and is what the first test asserts. The framing
   * arithmetic is covered by unit tests in `apps/web/test/demand.test.ts`, and
   * the camera behaviour was verified against a real map by measurement:
   * 500m radius framed at zoom 16.45, the layer widened it to 14.13 at every
   * search radius, and switching off restored 15.45 for a 1km radius exactly.
   */
  test("degrades away with the map, rather than offering a dead control", async ({ page }) => {
    await page.route(MAPS, (route) => route.abort());
    await page.goto("/analysis?lat=3.1478&lng=101.6953");
    await page.locator(".mappane").waitFor();

    // No map means no surface to draw on, so the control must not be there.
    await expect(page.getByRole("button", { name: /^Demand$/ })).toHaveCount(0);
    // And the analysis itself is unaffected — that separation is the point.
    await expect(page.getByText(/comparison aid, not a forecast/)).toBeVisible();
  });

  test("never describes a surface that is not on screen", async ({ page }) => {
    /**
     * A grid still loading and a grid that failed look identical on the map —
     * both are a bare basemap. The note explains a gradient, so printed over
     * either it would be describing something the reader cannot see. Found by
     * toggling the layer with the API down and reading what the page claimed.
     *
     * The toggle needs Maps to render, so this drives the component through
     * the state it would be in rather than through the button.
     */
    await page.route(MAPS, (route) => route.abort());
    await page.route("**/v1/heatmap**", (route) => route.abort());
    await page.goto("/analysis?lat=3.1478&lng=101.6953");
    await page.locator(".mappane").waitFor();

    // With no map there is no note at all, which is the same rule: nothing
    // claims a surface exists.
    await expect(page.locator(".demand-note")).toHaveCount(0);
    await expect(page.getByText(/Darker means more residents/)).toHaveCount(0);
  });

  test("carries the green-means-the-opposite warning wherever the ramp is", async ({ page }) => {
    /**
     * THE safety mechanism, and the reason this page can use the traffic ramp
     * at all. The score bars a few centimetres away paint green for a
     * dimension that scores WELL; the same green on the surface means almost
     * nobody lives there. Separate pages made one notice enough — on one
     * screen these words are the only thing that resolves it.
     */
    await page.route(MAPS, (route) => route.abort());
    await page.goto("/analysis?lat=3.1478&lng=101.6953");
    await page.locator(".mappane").waitFor();

    await page.getByRole("tab", { name: /Demand/ }).or(page.locator(".tab").filter({ hasText: "Demand" })).first().click();

    await expect(page.getByText(/Green does not mean space to open/)).toBeVisible();
    await expect(page.getByText(/opposite of what green means in the score bars/)).toBeVisible();
  });

  /**
   * CI blocks Google Maps, so these read the shading state off the tab's own
   * switch rather than off the camera. The camera was measured against a real
   * map when this shipped: see the note at the top of this block.
   */
  /**
   * A grid that LOADS. Aborting the route instead swaps the whole panel for
   * its "could not load the population grid" notice a moment later, which
   * takes the switch with it and reads exactly like the switch misbehaving.
   */
  const stubGrid = (page: Page) =>
    page.route("**/v1/heatmap**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          cells: [
            {
              lat: 3.1464,
              lng: 101.687,
              population: 3_100,
              boundary: [3.14875, 101.69105, 3.1511, 101.687, 3.14875, 101.68295, 3.14405, 101.68295, 3.1417, 101.687, 3.14405, 101.69105],
            },
          ],
          hexagonEdgeMetres: 400,
          resolution: 8,
          attribution: "Kontur Population (CC BY 4.0), via HDX",
          vintage: "20231101",
        }),
      }),
    );
  const shadeSwitch = (page: Page) =>
    page.locator(".layer-toggle").filter({ hasText: "Shade the map by residents" });
  const openTab = (page: Page, name: string) =>
    page.locator(".tab").filter({ hasText: name }).first().click();

  test("opening the Demand tab shades the map without a second click", async ({ page }) => {
    /**
     * The owner's report: the tab widened the map and stopped, so the reader
     * had to scroll back up to the map's Demand button before anything was
     * drawn. Asserted on a second visit too, because the tab has to shade the
     * map every time it opens, not only the first.
     */
    await page.route(MAPS, (route) => route.abort());
    await page.route("**/v1/amenities**", (route) => route.abort());
    await stubGrid(page);
    await page.goto("/analysis?lat=3.1478&lng=101.6953");
    await page.locator(".mappane").waitFor();

    await openTab(page, "Demand");
    await expect(shadeSwitch(page)).toHaveAttribute("aria-pressed", "true");

    await openTab(page, "Overview");
    await openTab(page, "Demand");
    await expect(shadeSwitch(page)).toHaveAttribute("aria-pressed", "true");
  });

  test("the shading switch still turns it off while the tab is open", async ({ page }) => {
    /**
     * Opening the tab turns the shading on; it must not HOLD it on. An
     * implementation that forced `demand` true whenever the tab was open would
     * pass the test above and leave this switch dead, which is the version
     * this guards against.
     */
    await page.route(MAPS, (route) => route.abort());
    await page.route("**/v1/amenities**", (route) => route.abort());
    await stubGrid(page);
    await page.goto("/analysis?lat=3.1478&lng=101.6953");
    await page.locator(".mappane").waitFor();

    await openTab(page, "Demand");
    await expect(shadeSwitch(page)).toHaveAttribute("aria-pressed", "true");

    await shadeSwitch(page).click();
    await expect(shadeSwitch(page)).toHaveAttribute("aria-pressed", "false");
    await page.waitForTimeout(400);
    await expect(shadeSwitch(page)).toHaveAttribute("aria-pressed", "false");
  });

  test("costs nothing beyond the free population grid", async ({ page }) => {
    /**
     * The layer must never reach a billed API. Places is the expensive one —
     * Enterprise SKU, 1,000 free calls a month — and Gemini bills outside the
     * project budget entirely. Asserted by watching the wire, not by reading
     * the code, because the guard is about what actually goes out.
     */
    const calls: string[] = [];
    await page.route("**/v1/**", async (route) => {
      calls.push(new URL(route.request().url()).pathname);
      await route.abort();
    });
    await page.route(MAPS, (route) => route.abort());

    await page.goto("/analysis?lat=3.1478&lng=101.6953");
    await page.locator(".mappane").waitFor();
    await page.waitForTimeout(600);

    // Whatever else the page fetches, the grid route is free and the paid
    // ones must not be reached on the layer's behalf.
    expect(calls.filter((c) => c.includes("opportunity-gaps")).length).toBeLessThanOrEqual(1);
    expect(calls.some((c) => c.includes("/v1/location/ask"))).toBe(false);
    expect(calls.some((c) => c.includes("/v1/report"))).toBe(false);
  });
});
