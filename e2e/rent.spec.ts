import { expect, test, type Page } from "@playwright/test";
import { openSection } from "./sections.js";

/**
 * Rental market — Feature 1e.
 *
 * The panel's job is to be useful without being believed too much: a
 * researched benchmark must never read as a quote, and a rent the user typed
 * must visibly outrank one that was inferred.
 *
 * As everywhere else, Maps and Places are blocked. Rent resolution is a pure
 * table lookup, so it needs neither.
 */

const MAPS = "https://maps.googleapis.com/**";

/** KLCC — RM15/sqft benchmark, and a Korean restaurant takes 1,200 sqft. */
const AT_KLCC = "/analysis?lat=3.1578&lng=101.7123&q=KLCC";
/** Kuantan — outside every benchmark's applicable radius. */
const AT_KUANTAN = "/analysis?lat=3.8077&lng=103.3260&q=Kuantan";

async function stub(page: Page) {
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

  for (const path of ["**/v1/opportunity-gaps", "**/v1/demographics", "**/v1/properties*"]) {
    await page.route(path, (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
    );
  }
}

const rentPanel = (page: Page) => page.locator("section.card", { hasText: "Rental market" });

test.beforeEach(async ({ page }) => {
  await stub(page);
});

test("infers the benchmark and shows the break-even it implies", async ({ page }) => {
  await page.goto(AT_KLCC);
  await openSection(page, "Rent");
  const panel = rentPanel(page);

  // RM15/sqft x 1,200 sqft, and the hand-computed break-even for that rent.
  await expect(panel.getByText("RM 18,000")).toBeVisible();
  await expect(panel.getByText("93/day", { exact: true })).toBeVisible();
});

test("labels an inferred figure as inferred, with its source and date", async ({ page }) => {
  await page.goto(AT_KLCC);
  await openSection(page, "Rent");
  const panel = rentPanel(page);

  await expect(panel.getByText("Inferred, not quoted.")).toBeVisible();
  await expect(panel.getByText(/Benchmark for KLCC, KL/)).toBeVisible();
  await expect(panel.getByText(/reviewed 2026-08-13/)).toBeVisible();
  await expect(panel.getByText(/Benchmarks are researched estimates/)).toBeVisible();
});

test("says so plainly where no benchmark covers the pin", async ({ page }) => {
  await page.goto(AT_KUANTAN);
  await openSection(page, "Rent");
  const panel = rentPanel(page);

  await expect(panel.getByText(/No rent benchmark covers this spot/)).toBeVisible();

  /**
   * And the score must show an empty axis rather than a zero. The dimension
   * NOTE saying so now sits inside the score working, which is a disclosure —
   * so the test opens it exactly as a reader would, rather than asserting
   * against text the page deliberately folds away.
   */
  await openSection(page, "Overview");
  await page.locator(".score-working > summary").click();
  await expect(
    page.getByRole("main").getByText(/enter the rent you were quoted/i).first(),
  ).toBeVisible();
});

test("a typed rent replaces the benchmark and is labelled as the user's own", async ({ page }) => {
  await page.goto(AT_KLCC);
  await openSection(page, "Rent");
  const panel = rentPanel(page);
  await expect(panel.getByText("Inferred, not quoted.")).toBeVisible();

  await panel.getByLabel("Rent you were quoted (RM/month)").fill("9000");

  await expect(panel.getByText("Your figure.")).toBeVisible();
  await expect(panel.getByText("Inferred, not quoted.")).toHaveCount(0);
  await expect(panel.getByText("RM 9,000")).toBeVisible();
  // Half the rent: fixed costs 16,596 + 9,000 = 25,596, over 372.30 -> 69/day.
  await expect(panel.getByText("69/day", { exact: true })).toBeVisible();
});

test("clearing the rent falls back to the benchmark rather than scoring zero rent", async ({
  page,
}) => {
  await page.goto(AT_KLCC);
  await openSection(page, "Rent");
  const panel = rentPanel(page);
  const field = panel.getByLabel("Rent you were quoted (RM/month)");

  await field.fill("9000");
  await expect(panel.getByText("Your figure.")).toBeVisible();

  // Number("") is 0, and a free shop would top the rent dimension.
  await field.fill("");
  await expect(panel.getByText("Inferred, not quoted.")).toBeVisible();
  await expect(panel.getByText("RM 18,000")).toBeVisible();
});

test("an unpayable rent turns the light red without breaking the page", async ({ page }) => {
  await page.goto(AT_KLCC);
  await openSection(page, "Rent");
  const panel = rentPanel(page);

  await panel.getByLabel("Rent you were quoted (RM/month)").fill("400000");

  await expect(panel.getByText("Very exposed")).toBeVisible();
  // The rest of the page survives an absurd input — the score still renders.
  await expect(page.getByRole("img", { name: /Success score/ })).toBeVisible();
});

test("the rent survives a reload through the link", async ({ page }) => {
  await page.goto(AT_KLCC);
  await openSection(page, "Rent");
  const panel = rentPanel(page);

  await panel.getByLabel("Rent you were quoted (RM/month)").fill("9000");
  await panel.getByLabel("Unit size (sqft)").fill("1100");
  await expect(panel.getByText("Your figure.")).toBeVisible();

  // Both params are debounced separately, so waiting only for `rent` can
  // reload before `sqft` has been written and lose it.
  await expect
    .poll(() => {
      const params = new URL(page.url()).searchParams;
      return `${params.get("rent")}/${params.get("sqft")}`;
    })
    .toBe("9000/1100");

  await page.reload();
  // The section is UI state, not part of the link, so a reload lands on
  // Overview. What has to survive is the rent itself.
  await openSection(page, "Rent");
  await expect(rentPanel(page).getByLabel("Rent you were quoted (RM/month)")).toHaveValue("9000");
  await expect(rentPanel(page).getByLabel("Unit size (sqft)")).toHaveValue("1100");
});

test("hands the rent to the simulator", async ({ page }) => {
  await page.goto(AT_KLCC);
  await openSection(page, "Rent");
  const link = rentPanel(page).getByRole("link", { name: /Open in simulator/ });

  await expect(link).toHaveAttribute("href", /rent=18000/);
  await expect(link).toHaveAttribute("href", /district=klcc/);
});

test("the rent axis joins the score without displacing the others", async ({ page }) => {
  await page.goto(AT_KLCC);
  await openSection(page, "Overview");

  /**
   * "Location profile" as a card heading is gone: the tab above it already
   * says Overview, and the page was naming itself twice. The table is behind
   * the score working now, so this opens it the way a reader would.
   */
  await page.locator(".score-working > summary").click();
  const table = page.getByRole("table").first();

  await expect(table.getByText("Rent sensitivity")).toBeVisible();
  // Still all five dimensions, and competition still the heaviest.
  await expect(table.getByText("Competition")).toBeVisible();
  await expect(table.getByText("Est. monthly demand")).toBeVisible();
});

/**
 * Available properties — the spec's last unbuilt Rent item.
 *
 * Links out rather than listing: PropertyGuru's terms prohibit data mining,
 * they actively block, and republishing agents' listings is a copyright
 * question on top. A live search is also simply better than a copy that goes
 * stale. CI never requests the portals — these read hrefs, the same way the
 * Maps assertions work.
 */

/** Demographics resolving, so the state-scoped Mudah link has what it needs. */
async function withDistrict(page: Page, district: string, state: string) {
  await page.route("**/v1/demographics", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        matched: true,
        resolution: "district",
        demographics: { district, state, total: 500_000, age: {}, ethnicity: {} },
        vintage: "2025",
        reviewed: "2026-08-12",
        sourceNote: "CC BY 4.0",
        catchment: null,
      }),
    }),
  );
}

test("links to the retail search for the benchmark area", async ({ page }) => {
  await withDistrict(page, "Kuala Lumpur", "W.P. Kuala Lumpur");
  await page.goto(AT_KLCC);
  await openSection(page, "Rent");
  const panel = rentPanel(page);

  // The retail PATH, not a property_type parameter — PropertyGuru rewrites
  // that one to isCommercial=false and serves residential.
  await expect(panel.getByRole("link", { name: /PropertyGuru/ })).toHaveAttribute(
    "href",
    "https://www.propertyguru.com.my/retail-shops-for-rent?freetext=KLCC",
  );

  // Mudah searches by region: its category is itself a freetext query, so
  // adding the area ANDs the two and collapses the results.
  await expect(panel.getByRole("link", { name: /Mudah/ })).toHaveAttribute(
    "href",
    "https://www.mudah.my/kuala-lumpur/shop-office-for-rent",
  );
  await expect(panel.getByText(/statewide/)).toBeVisible();
});

test("every outbound link is safe to open", async ({ page }) => {
  await withDistrict(page, "Kuala Lumpur", "W.P. Kuala Lumpur");
  await page.goto(AT_KLCC);
  await openSection(page, "Rent");

  const links = rentPanel(page).locator("a.portal-link");
  await expect(links).toHaveCount(2);

  for (const link of await links.all()) {
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(link).toHaveAttribute("rel", /noreferrer/);
    await expect(link).toHaveAttribute("href", /^https:\/\//);
  }
});

test("says the listings are the portals', not ours", async ({ page }) => {
  await withDistrict(page, "Kuala Lumpur", "W.P. Kuala Lumpur");
  await page.goto(AT_KLCC);
  await openSection(page, "Rent");

  await expect(rentPanel(page).getByText(/Listings live on the portals/)).toBeVisible();
  await expect(rentPanel(page).getByText(/Asking prices, not/)).toBeVisible();
});

test("falls back to the district when no benchmark covers the pin", async ({ page }) => {
  // Kuantan has no rent benchmark, but demographics still resolve a district.
  await withDistrict(page, "Kuantan", "Pahang");
  await page.goto(AT_KUANTAN);
  await openSection(page, "Rent");

  await expect(rentPanel(page).getByRole("link", { name: /PropertyGuru/ })).toHaveAttribute(
    "href",
    /freetext=Kuantan$/,
  );
  await expect(rentPanel(page).getByRole("link", { name: /Mudah/ })).toHaveAttribute(
    "href",
    /\/pahang\/shop-office-for-rent$/,
  );
});

test("drops the region link rather than guessing when demographics fail", async ({ page }) => {
  // The default stub 503s demographics, so there is no state. The area-based
  // search still works; the region-based one has nothing honest to point at.
  await page.goto(AT_KLCC);
  await openSection(page, "Rent");

  await expect(rentPanel(page).getByRole("link", { name: /PropertyGuru/ })).toBeVisible();
  await expect(rentPanel(page).getByRole("link", { name: /Mudah/ })).toHaveCount(0);
});

test("shows nothing rather than a national search when no area resolves", async ({ page }) => {
  // Offshore: no benchmark and no district. A link claiming to be "near here"
  // would be worse than none.
  await page.goto("/analysis?lat=3.8077&lng=103.3260&q=Nowhere");
  await openSection(page, "Rent");

  await expect(rentPanel(page).getByText("Available properties")).toHaveCount(0);
});

/**
 * Real PropertyGuru listings in the Rent tab.
 *
 * CI never requests PropertyGuru — the route is stubbed, exactly as Maps and
 * Places are. What is tested is our handling: that the cards render the facts,
 * that every one links back, and above all that the panel survives the source
 * being unavailable, which it will be sooner or later.
 */
const LISTING = {
  id: "501793412",
  url: "https://www.propertyguru.com.my/property-listing/klcc-501793412",
  title: "KLCC",
  address: "KLCC, KL City Centre, Kuala Lumpur",
  monthlyRent: 70000,
  rentLabel: "RM 70,000 /mo",
  psfLabel: "RM 7.00 psf",
  floorSqft: 10000,
  sizeLabel: "10,000 sqft",
  propertyType: "Retail Space",
  thumbnailUrl: "https://my1-cdn.pgimgs.com/listing/1.jpg",
  postedLabel: "13 Aug 2026",
  transitLabel: "4 min (330 m) from Persiaran KLCC",
};

async function withListings(page: Page, count: number) {
  await page.route("**/v1/properties*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        listings: Array.from({ length: count }, (_, i) => ({
          ...LISTING,
          id: `listing-${i}`,
          rentLabel: `RM ${(i + 1) * 1000} /mo`,
        })),
        available: true,
        reason: null,
        fromCache: true,
        area: "KLCC",
      }),
    }),
  );
  // The thumbnails point at PropertyGuru's CDN; CI must not fetch them.
  await page.route("https://my1-cdn.pgimgs.com/**", (route) => route.abort());
}

test("shows real units with the figures an SME screens on", async ({ page }) => {
  await withListings(page, 5);
  await page.goto(AT_KLCC);
  await openSection(page, "Rent");
  const panel = rentPanel(page);

  await expect(panel.locator(".plist-card")).toHaveCount(5);
  await expect(panel.getByText("RM 7.00 psf").first()).toBeVisible();
  await expect(panel.getByText("Retail Space").first()).toBeVisible();
  await expect(panel.getByText(/10,000 sqft/).first()).toBeVisible();
  await expect(panel.getByText(/5 on the market near KLCC/)).toBeVisible();
});

test("every unit links back to the listing it came from", async ({ page }) => {
  await withListings(page, 5);
  await page.goto(AT_KLCC);
  await openSection(page, "Rent");

  const cards = rentPanel(page).locator("a.plist-card");
  await expect(cards).toHaveCount(5);

  for (const card of await cards.all()) {
    await expect(card).toHaveAttribute("href", /propertyguru\.com\.my\/property-listing\//);
    await expect(card).toHaveAttribute("target", "_blank");
    await expect(card).toHaveAttribute("rel", /noopener/);
    await expect(card).toHaveAttribute("rel", /noreferrer/);
  }
});

test("says these are asking prices and not part of the score", async ({ page }) => {
  await withListings(page, 5);
  await page.goto(AT_KLCC);
  await openSection(page, "Rent");

  await expect(rentPanel(page).getByText(/Asking prices advertised on PropertyGuru/)).toBeVisible();
  await expect(rentPanel(page).getByText(/not used in the Success Score/)).toBeVisible();
});

test("keeps the portal links alongside the cards", async ({ page }) => {
  await withListings(page, 5);
  await page.goto(AT_KLCC);
  await openSection(page, "Rent");

  // Six cards are never the whole market, so "see all" has to stay reachable.
  await expect(rentPanel(page).getByRole("link", { name: /See all on PropertyGuru/ })).toBeVisible();
});

/**
 * The failure that will actually happen in production: PropertyGuru blocks a
 * datacentre IP, or changes their payload. The Rent tab predates listings and
 * has to keep working without them.
 */
test("falls back to plain portal links when the source is unavailable", async ({ page }) => {
  await page.route("**/v1/properties*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        listings: [],
        available: false,
        reason: "http_403",
        fromCache: false,
        area: "KLCC",
      }),
    }),
  );

  await page.goto(AT_KLCC);
  await openSection(page, "Rent");
  const panel = rentPanel(page);

  await expect(panel.locator(".plist-card")).toHaveCount(0);
  await expect(panel.getByRole("link", { name: /PropertyGuru/ })).toBeVisible();
  await expect(panel.getByText(/Listings live on the portals/)).toBeVisible();
  // The break-even is the panel's real job and must be untouched by any of this.
  await expect(panel.getByText("93/day", { exact: true })).toBeVisible();
});

test("survives the route erroring outright", async ({ page }) => {
  await page.route("**/v1/properties*", (route) => route.fulfill({ status: 500, body: "{}" }));

  await page.goto(AT_KLCC);
  await openSection(page, "Rent");

  await expect(rentPanel(page).getByRole("link", { name: /PropertyGuru/ })).toBeVisible();
  await expect(rentPanel(page).getByText("RM 18,000")).toBeVisible();
});

test("shows the two that exist rather than padding to five", async ({ page }) => {
  await withListings(page, 2);
  await withDistrict(page, "Kuantan", "Pahang");
  await page.goto(AT_KUANTAN);
  await openSection(page, "Rent");

  await expect(rentPanel(page).locator(".plist-card")).toHaveCount(2);
  await expect(rentPanel(page).getByText(/2 on the market near Kuantan/)).toBeVisible();
});
