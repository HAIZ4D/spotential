import { expect, test, type Page } from "@playwright/test";

/**
 * City demand heatmap.
 *
 * The assertions are mostly about what this page refuses to claim. It maps
 * where people live, not where to open — competition is the half that costs
 * money and it is absent. A page that let someone read "green means open here"
 * would be worse than not shipping it.
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

test("says plainly that it maps people, not opportunity", async ({ page }) => {
  await stub(page);
  await page.goto("/heatmap");

  await expect(page.getByText(/where people live/)).toBeVisible();
  await expect(page.getByText(/knows nothing about competition/)).toBeVisible();
  // The specific misreading it must head off.
  await expect(page.getByText(/may already be saturated/)).toBeVisible();
});

test("credits both free data sources", async ({ page }) => {
  await stub(page);
  await page.goto("/heatmap");

  // CC BY and ODbL both oblige attribution, and it is also the answer to
  // "what did this cost".
  await expect(page.getByText(/Kontur Population \(CC BY 4\.0\)/)).toBeVisible();
  await expect(page.getByText(/20231101/)).toBeVisible();
  await expect(page.getByText(/OpenStreetMap contributors \(ODbL\)/)).toBeVisible();
});

test("shows a density legend calibrated nationally, not a good-to-bad ramp", async ({ page }) => {
  await stub(page);
  await page.goto("/heatmap");

  await expect(page.getByText("Top 5% nationally")).toBeVisible();
  await expect(page.getByText("Median", { exact: true })).toBeVisible();
  await expect(page.getByText(/means the same thing in every city/)).toBeVisible();
});

const card = (page: Page, title: string) =>
  page.locator("section.card").filter({ hasText: title });

test("summarises what was actually loaded", async ({ page }) => {
  await stub(page);
  await page.goto("/heatmap");

  // Three cells totalling 13,320 people, median 3,100, densest 9,800.
  const summary = card(page, "In view");
  await expect(summary.getByText("13,320")).toBeVisible();
  await expect(summary.getByText("3,100")).toBeVisible();
  await expect(summary.getByText("9,800")).toBeVisible();
  await expect(summary.getByText(/3 hexagons of 400m/)).toBeVisible();
});

test("ranks the densest areas by name, not by coordinate", async ({ page }) => {
  await stub(page);
  await page.goto("/heatmap");

  // Names come free from OpenStreetMap place nodes; reverse geocoding is billable.
  const top = page.getByRole("button", { name: /Bukit Bintang/ });
  await expect(top).toBeVisible();
  await expect(page.getByRole("button", { name: /Chow Kit/ })).toBeVisible();
});

test("counts the dense layers but refuses to draw them", async ({ page }) => {
  await stub(page);
  await page.goto("/heatmap");

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
  await page.goto("/heatmap");

  // Free — the benchmarks already ship in the bundle. Demand and cost together
  // is the actual decision.
  await expect(page.getByRole("button", { name: /Rent benchmarks/ })).toBeVisible();
});

test("invites a cell inspection before one is chosen", async ({ page }) => {
  await stub(page);
  await page.goto("/heatmap");

  await expect(page.getByText(/Click any hexagon/)).toBeVisible();
});

test("keeps the population map working when OpenStreetMap is busy", async ({ page }) => {
  await stub(page, { amenities: "throttled" });
  await page.goto("/heatmap");

  await expect(page.getByText(/OpenStreetMap is busy right now/)).toBeVisible();
  // The thing that must survive: the density surface and its summary.
  await expect(card(page, "In view").getByText("13,320")).toBeVisible();
  await expect(page.getByText(/where people live/)).toBeVisible();
});

test("keeps working when the amenities route errors outright", async ({ page }) => {
  await stub(page, { amenities: "error" });
  await page.goto("/heatmap");

  await expect(card(page, "In view").getByText("13,320")).toBeVisible();
  await expect(page.getByText(/where people live/)).toBeVisible();
});

test("requests only a bounded box around the chosen city", async ({ page }) => {
  await stub(page);
  let url = "";
  page.on("request", (request) => {
    if (request.url().includes("/v1/heatmap")) url = request.url();
  });

  await page.goto("/heatmap");
  await expect(card(page, "In view").getByText("13,320")).toBeVisible();

  const params = new URL(url).searchParams;
  const span = Number(params.get("east")) - Number(params.get("west"));
  // Well under the server's 1.5-degree cap: one city core, not the country.
  expect(span).toBeGreaterThan(0);
  expect(span).toBeLessThan(0.2);
});

test("switching city refetches for the new box", async ({ page }) => {
  await stub(page);
  const boxes: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/v1/heatmap")) {
      boxes.push(new URL(request.url()).searchParams.get("west")!);
    }
  });

  await page.goto("/heatmap");
  await expect(card(page, "In view").getByText("13,320")).toBeVisible();

  await page.getByLabel("City").selectOption("George Town");
  await expect.poll(() => boxes.length).toBeGreaterThan(1);
  expect(boxes[0]).not.toBe(boxes[1]);
});

test("degrades to a notice when the grid is not loaded", async ({ page }) => {
  await stub(page, { fail: true });
  await page.goto("/heatmap");

  await expect(page.getByText(/Could not load the population grid/)).toBeVisible();
  await expect(page.getByText(/Every other page is unaffected/)).toBeVisible();
});

test("offers a way through to scoring an actual spot", async ({ page }) => {
  await stub(page);
  await page.goto("/heatmap");

  // Clicking a ranked area selects that cell, which exposes the analysis link.
  await page.getByRole("button", { name: /Bukit Bintang/ }).click();

  const link = page.getByRole("link", { name: /Score this spot/ });
  await expect(link).toHaveAttribute("href", /\/analysis\?lat=3\.1464/);
});

test("a selected cell reports its national percentile", async ({ page }) => {
  await stub(page);
  await page.goto("/heatmap");

  await page.getByRole("button", { name: /Bukit Bintang/ }).click();

  const inspector = card(page, "Selected cell");
  await expect(inspector.getByText("9,800")).toBeVisible();
  await expect(inspector.getByText(/residents in this 400m hexagon/)).toBeVisible();
  // The same scale the Success Score uses — one definition, so the map and the
  // score can never describe the same spot differently.
  await expect(inspector.getByText(/of where Malaysians live/)).toBeVisible();
  await expect(inspector.getByText(/same scale the Success Score uses/)).toBeVisible();
});
