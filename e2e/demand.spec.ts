import { expect, test, type Page } from "@playwright/test";

/**
 * The Demand panel, which absorbed the City Demand page.
 *
 * These assertions moved here rather than being deleted with that page. They
 * are mostly about what the surface refuses to claim: it maps where people
 * live, not where to open — competition is the half that costs money and it is
 * absent. Letting someone read "green means open here" would be worse than not
 * shipping it, and on THIS page the risk is higher, because green a few
 * centimetres away in the score bars means the opposite.
 *
 * Three tests did not survive the move, because the behaviour did not: the
 * city picker (you reach a city by moving the pin), the through-link to
 * scoring a spot (you are already on that page), and the inspector's
 * before-you-click empty state (it follows the pin, so there is nothing to
 * click first).
 *
 * CI calls neither Google Maps nor Overpass. Both are blocked and the page is
 * asserted to degrade, exactly as the Places rule already works.
 */

const MAPS = "https://maps.googleapis.com/**";
const OVERPASS = "https://overpass-api.de/**";

/**
 * Three cells with real hexagon boundaries: sparse, mid, dense.
 *
 * Boundaries matter now — the surface is drawn as its true H3 hexagon rather
 * than a square of equivalent area, because squares cannot tile a hexagonal
 * grid and once left a visible gap between every cell.
 */
const CELLS = [
  {
    lat: 3.139,
    lng: 101.687,
    population: 420,
    boundary: [3.14135, 101.69105, 3.1437, 101.687, 3.14135, 101.68295, 3.13665, 101.68295, 3.1343, 101.687, 3.13665, 101.69105],
  },
  {
    lat: 3.1427,
    lng: 101.687,
    population: 3_100,
    boundary: [3.14505, 101.69105, 3.1474, 101.687, 3.14505, 101.68295, 3.14035, 101.68295, 3.138, 101.687, 3.14035, 101.69105],
  },
  {
    lat: 3.1464,
    lng: 101.687,
    population: 9_800,
    boundary: [3.14875, 101.69105, 3.1511, 101.687, 3.14875, 101.68295, 3.14405, 101.68295, 3.1417, 101.687, 3.14405, 101.69105],
  },
];

const LAYERS = [
  { id: "rail", label: "Rail & metro", count: 108, pinned: true, points: [{ lat: 3.1464, lng: 101.6871, name: "KLCC" }] },
  { id: "mall", label: "Malls", count: 89, pinned: true, points: [{ lat: 3.1465, lng: 101.6872, name: "Suria" }] },
  { id: "bus", label: "Bus stops", count: 1_026, pinned: false, points: [] },
  { id: "office", label: "Offices", count: 1_018, pinned: false, points: [] },
];

const PLACES = [
  { lat: 3.1464, lng: 101.687, name: "Bukit Bintang" },
  { lat: 3.1427, lng: 101.687, name: "Chow Kit" },
  { lat: 3.139, lng: 101.687, name: "Brickfields" },
];

async function stub(
  page: Page,
  options: { fail?: boolean; amenities?: "ok" | "throttled" | "error" } = {},
) {
  await page.route(MAPS, (route) => route.abort());
  await page.route(OVERPASS, (route) => route.abort());

  await page.route("**/v1/heatmap*", (route) =>
    options.fail
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "heatmap_unavailable", message: "not loaded" }),
        })
      : route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            cells: CELLS,
            hexagonEdgeMetres: 400,
            resolution: 8,
            attribution: "Kontur Population (CC BY 4.0), via HDX",
            vintage: "20231101",
          }),
        }),
  );

  const mode = options.amenities ?? "ok";
  await page.route("**/v1/amenities*", (route) => {
    if (mode === "error") return route.fulfill({ status: 500, body: "{}" });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        layers: mode === "throttled" ? [] : LAYERS,
        places: mode === "throttled" ? [] : PLACES,
        available: mode === "ok",
        reason: mode === "throttled" ? "throttled" : null,
        fromCache: true,
        attribution: "© OpenStreetMap contributors (ODbL)",
      }),
    });
  });
}


/** Opens the Location page and switches to the Demand panel. */
async function openDemand(page: Page) {
  await page.goto("/analysis?lat=3.1478&lng=101.6953");
  await page.locator(".mappane").waitFor();
  await page.locator(".tab").filter({ hasText: "Demand" }).click();
}

test("says plainly that it maps people, not opportunity", async ({ page }) => {
  await stub(page);
  await openDemand(page);

  // Scoped to the warning notice deliberately. The phrase also appears in the
  // caption below it, and it is the NOTICE that has to carry this — a caption
  // is the part people skip.
  const warning = page.locator(".notice.warn");
  await expect(warning.getByText(/where people live/)).toBeVisible();
  await expect(warning.getByText(/knows nothing about competition/)).toBeVisible();
  // The specific misreading it must head off.
  await expect(warning.getByText(/may already be saturated/)).toBeVisible();
});

test("credits both free data sources", async ({ page }) => {
  await stub(page);
  await openDemand(page);

  // CC BY and ODbL both oblige attribution, and it is also the answer to
  // "what did this cost". The site footer carries these too, so this is
  // scoped to the page's OWN credit — the one that names the dataset
  // version, which the footer does not. footer.spec covers the other copy.
  // The page's own credit line, which names the dataset VERSION — the site
  // footer carries the licence names too, so a page-wide lookup matches both.
  // footer.spec covers that copy; this one is the heatmap's.
  const credit = page.locator(".tiny.muted").filter({ hasText: /Kontur Population/ });
  await expect(credit.getByText(/Kontur Population \(CC BY 4\.0\)/)).toBeVisible();
  await expect(credit.getByText(/20231101/)).toBeVisible();
  await expect(credit.getByText(/OpenStreetMap contributors \(ODbL\)/)).toBeVisible();
});

test("shows a density legend calibrated nationally, not a good-to-bad ramp", async ({ page }) => {
  await stub(page);
  await openDemand(page);

  await expect(page.getByText("top 5% nationally")).toBeVisible();
  await expect(page.getByText("national median")).toBeVisible();
  await expect(page.getByText(/means the same density in every city/)).toBeVisible();
});

/**
 * The safety mechanism for the green-to-red ramp.
 *
 * The owner chose the familiar heat gradient over the earlier navy-to-red
 * scale knowing the trade-off: on this map green means almost NOBODY LIVES
 * THERE, while looking exactly like the "space to open" colour. Nothing in the
 * rendering can fix that, so the words carry it — which makes them a feature
 * with a test, not caption copy.
 */
test("says in words which end of the ramp is which", async ({ page }) => {
  await stub(page);
  await openDemand(page);

  // Not swatches alone: both ends named in plain language, in the legend.
  const legend = page.locator(".legend");
  await expect(legend.getByText("Most people")).toBeVisible();
  await expect(legend.getByText("Few people")).toBeVisible();
  await expect(legend.getByText(/almost nobody lives here/)).toBeVisible();

  // The exact misreading the ramp invites, refused explicitly in the notice.
  const warning = page.locator(".notice.warn");
  await expect(warning.getByText(/Green does not mean space to open/)).toBeVisible();
  await expect(warning.getByText(/red is where the most people are/)).toBeVisible();
});

test("puts the hottest row of the legend first", async ({ page }) => {
  await stub(page);
  await openDemand(page);

  // Read top-down, the first thing anyone sees must be that red means most.
  const rows = page.locator(".legend-row");
  await expect(rows.first()).toContainText("Most people");
  await expect(rows.last()).toContainText("Few people");
});

const card = (page: Page, title: string) =>
  page.locator("section.card").filter({ hasText: title });

test("summarises what was actually loaded", async ({ page }) => {
  await stub(page);
  await openDemand(page);

  // Three cells totalling 13,320 people, median 3,100, densest 9,800.
  const summary = card(page, "In view");
  await expect(summary.getByText("13,320")).toBeVisible();
  await expect(summary.getByText("3,100")).toBeVisible();
  await expect(summary.getByText("9,800")).toBeVisible();
  await expect(summary.getByText(/3 hexagons of 400m/)).toBeVisible();
});

test("ranks the densest areas by name, not by coordinate", async ({ page }) => {
  await stub(page);
  await openDemand(page);

  // Names come free from OpenStreetMap place nodes; reverse geocoding is billable.
  const top = page.getByRole("button", { name: /Bukit Bintang/ });
  await expect(top).toBeVisible();
  await expect(page.getByRole("button", { name: /Chow Kit/ })).toBeVisible();
});

test("counts the dense layers but refuses to draw them", async ({ page }) => {
  await stub(page);
  await openDemand(page);

  // 1,026 bus stops is a useful number and a useless picture.
  const bus = page.getByRole("button", { name: /Bus stops/ });
  await expect(bus).toBeVisible();
  await expect(bus).toBeDisabled();
  await expect(page.getByText("1,026")).toBeVisible();

  // Sparse, high-signal layers stay toggleable.
  await expect(page.getByRole("button", { name: /Rail & metro/ })).toBeEnabled();
});

test("puts rent on the same screen as demand", async ({ page }) => {
  await stub(page);
  await openDemand(page);

  // Free — the benchmarks already ship in the bundle. Demand and cost together
  // is the actual decision.
  await expect(page.getByRole("button", { name: /Rent benchmarks/ })).toBeVisible();
});

test("keeps the population map working when OpenStreetMap is busy", async ({ page }) => {
  await stub(page, { amenities: "throttled" });
  await openDemand(page);

  await expect(page.getByText(/OpenStreetMap is busy right now/)).toBeVisible();
  // The thing that must survive: the density surface and its summary.
  await expect(card(page, "In view").getByText("13,320")).toBeVisible();
  await expect(page.locator(".notice.warn").getByText(/where people live/)).toBeVisible();
});

test("keeps working when the amenities route errors outright", async ({ page }) => {
  await stub(page, { amenities: "error" });
  await openDemand(page);

  await expect(card(page, "In view").getByText("13,320")).toBeVisible();
  await expect(page.locator(".notice.warn").getByText(/where people live/)).toBeVisible();
});

test("requests only a bounded box around the chosen city", async ({ page }) => {
  await stub(page);
  let url = "";
  page.on("request", (request) => {
    if (request.url().includes("/v1/heatmap")) url = request.url();
  });

  await openDemand(page);
  await expect(card(page, "In view").getByText("13,320")).toBeVisible();

  const params = new URL(url).searchParams;
  const span = Number(params.get("east")) - Number(params.get("west"));
  // Well under the server's 1.5-degree cap: one city core, not the country.
  expect(span).toBeGreaterThan(0);
  expect(span).toBeLessThan(0.2);
});

test("degrades to a notice when the grid is not loaded", async ({ page }) => {
  await stub(page, { fail: true });
  await openDemand(page);

  await expect(page.getByText(/Could not load the population grid/)).toBeVisible();
  await expect(page.getByText(/Every other page is unaffected/)).toBeVisible();
});

test("a selected cell reports its national percentile", async ({ page }) => {
  await stub(page);
  await openDemand(page);

  await page.getByRole("button", { name: /Bukit Bintang/ }).click();

  const inspector = card(page, "Selected cell");
  await expect(inspector.getByText("9,800")).toBeVisible();
  await expect(inspector.getByText(/residents in this 400m hexagon/)).toBeVisible();
  // The same scale the Success Score uses — one definition, so the map and the
  // score can never describe the same spot differently.
  await expect(inspector.getByText(/of where Malaysians live/)).toBeVisible();
  await expect(inspector.getByText(/same scale the Success Score uses/)).toBeVisible();
});

test("an old City Demand link still lands somewhere useful", async ({ page }) => {
  /**
   * The URL is this product's persistence layer — every view is a shareable
   * link — so `/heatmap` links are already out in the world. Removing the page
   * without a redirect would drop them through the catch-all onto the
   * simulator, which answers a completely different question.
   */
  await stub(page);
  await page.goto("/heatmap?lat=3.1478&lng=101.6953");

  await expect(page).toHaveURL(/\/analysis/);
  // The query string rides along, exactly as it does on the "/" redirect.
  await expect(page).toHaveURL(/lat=3\.1478/);
});

test("the page it replaced is gone from the navigation", async ({ page }) => {
  await stub(page);
  await page.goto("/analysis?lat=3.1478&lng=101.6953");

  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /City Demand/i })).toHaveCount(0);
  await expect(page.locator("footer").getByRole("link", { name: /City demand/i })).toHaveCount(0);
});
