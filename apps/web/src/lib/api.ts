import type {
  BusinessCategory,
  CategoryGap,
  CompetitorSummary,
  CompetitorWithDistance,
  DensityBand,
  ScenarioInputs,
  SimulationResult,
} from "@spotential/sim-engine";
import type { EventListing, EventScore, VendorProfile } from "@spotential/sim-engine";
import { authHeaders } from "./firebase.js";

/**
 * The Cloud Run client.
 *
 * Nothing on the deterministic path waits for this. The browser computes its
 * own result instantly; the server is called only to CONFIRM agreement (see
 * ParityBadge) and, from Checkpoint 4, to answer AI questions.
 */

export const SIMULATOR_URL: string = (
  import.meta.env["VITE_SIMULATOR_URL"] ?? "http://localhost:8080"
).replace(/\/$/, "");

export interface SimulateResponse {
  result: SimulationResult;
  engineVersion: string;
  presetVersion: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: string[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function postSimulate(
  inputs: ScenarioInputs,
  signal?: AbortSignal,
): Promise<SimulateResponse> {
  const response = await fetch(`${SIMULATOR_URL}/v1/simulate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ inputs }),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
      details?: string[];
    };
    throw new ApiError(
      body.message ?? `Request failed with ${response.status}`,
      response.status,
      body.details,
    );
  }

  return (await response.json()) as SimulateResponse;
}

export type AskResponse =
  | {
      kind: "patch";
      label: string;
      rationale: string;
      operations: { field: string; op: string; value: number }[];
      changedFields: string[];
      inputs: ScenarioInputs;
      result: SimulationResult;
      narration: string;
    }
  | { kind: "clarification"; question: string }
  | { kind: "declined"; reason: string; suggestion: string };

export async function postAsk(
  inputs: ScenarioInputs,
  question: string,
  clarified: boolean,
  signal?: AbortSignal,
): Promise<AskResponse> {
  const response = await fetch(`${SIMULATOR_URL}/v1/simulate/ask`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ inputs, question, clarified }),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(
      body.message ?? "The assistant could not be reached.",
      response.status,
    );
  }

  return (await response.json()) as AskResponse;
}

export interface CompetitorsResponse {
  competitors: CompetitorWithDistance[];
  summary: CompetitorSummary;
  density: DensityBand[];
  fromCache: boolean;
  fetchedAt: number;
  radiusMetres: number;
  /** Places capped the result set — this is the nearest 20, not all of them. */
  truncated: boolean;
  /** How far out the data is actually complete. Null when nothing was capped. */
  completeToMetres: number | null;
  searchSkipped: boolean;
  placesConfigured: boolean;
}

export async function postCompetitors(
  body: { lat: number; lng: number; radiusMetres: number; category: BusinessCategory },
  signal?: AbortSignal,
): Promise<CompetitorsResponse> {
  const response = await fetch(`${SIMULATOR_URL}/v1/competitors`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(
      payload.message ?? "Could not load competitors.",
      response.status,
    );
  }

  return (await response.json()) as CompetitorsResponse;
}

export interface GapsResponse {
  ranked: CategoryGap[];
  /** Which sector was compared, so the panel can say so. */
  sector?: "fnb" | "retail" | "services";
  noPresence: CategoryGap[];
  topOpportunity: CategoryGap | null;
  narrative: string;
  radiusMetres: number;
  fromCache: boolean;
  categoriesFetched: number;
  fetchedAt: number;
  searchSkipped: boolean;
  placesConfigured: boolean;
}

export async function postOpportunityGaps(
  // `category` selects the SECTOR to compare within. One Places call per
  // category searched, so this is the spend control as much as a filter.
  body: { lat: number; lng: number; radiusMetres: number; category?: BusinessCategory },
  signal?: AbortSignal,
): Promise<GapsResponse> {
  const response = await fetch(`${SIMULATOR_URL}/v1/opportunity-gaps`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(payload.message ?? "Could not analyse this area.", response.status);
  }

  return (await response.json()) as GapsResponse;
}

export interface DemographicsResponse {
  matched: boolean;
  resolution: "district" | "none";
  demographics: {
    district: string;
    state: string;
    total: number;
    age: Record<string, number>;
    ethnicity: Record<string, number>;
  } | null;
  vintage: string;
  reviewed: string;
  sourceNote: string;
  /**
   * Residents within the search radius, from the 400m population grid.
   *
   * The figure that actually matters. The district total above is context —
   * Kuala Lumpur district is over two million people and a walk-in catchment
   * is nothing like that. Null where the grid is not loaded.
   */
  catchment?: { radiusMetres: number; population: number; hexagons: number } | null;
  catchmentSource?: string;
  catchmentVintage?: string;
}

export async function postDemographics(
  // radiusMetres drives the catchment sum, so it must match the radius the
  // rest of the page is analysing at or the score and the panel disagree.
  body: { lat: number; lng: number; radiusMetres?: number },
  signal?: AbortSignal,
): Promise<DemographicsResponse> {
  const response = await fetch(`${SIMULATOR_URL}/v1/demographics`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(payload.message ?? "Could not load demographics.", response.status);
  }

  return (await response.json()) as DemographicsResponse;
}

/**
 * Retail listings for the Rent tab.
 *
 * A real unit someone is advertising, not a benchmark we researched. These are
 * ASKING prices from a third party and never reach the Success Score — the
 * rent dimension keeps using the dated, sourced benchmark.
 */
export interface PropertyListing {
  id: string;
  url: string;
  title: string;
  address: string;
  monthlyRent: number | null;
  rentLabel: string;
  psfLabel: string | null;
  floorSqft: number | null;
  sizeLabel: string | null;
  propertyType: string | null;
  thumbnailUrl: string | null;
  postedLabel: string | null;
  transitLabel: string | null;
}

export interface PropertiesResponse {
  listings: PropertyListing[];
  /** False when the source could not be reached, read, or was over quota. */
  available: boolean;
  reason: string | null;
  fromCache: boolean;
  area: string;
}

export async function getProperties(
  area: string,
  signal?: AbortSignal,
): Promise<PropertiesResponse> {
  const response = await fetch(
    `${SIMULATOR_URL}/v1/properties?area=${encodeURIComponent(area)}`,
    {
      headers: { ...(await authHeaders()) },
      ...(signal ? { signal } : {}),
    },
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(payload.message ?? "Could not load listings.", response.status);
  }

  return (await response.json()) as PropertiesResponse;
}

/**
 * The location chatbot — Feature 3.
 *
 * Grounded on the data already on the page: the same competitor summary and
 * demographics the panels are rendering go to the server, which rebuilds the
 * facts with the shared engine. An answer therefore cannot cite a figure the
 * page does not show — and a numeric guard on the server enforces that rather
 * than trusting the model.
 */
export type ChatTurn = { role: "user" | "model"; text: string };

export type ChatResponse =
  | { kind: "answer"; text: string }
  | { kind: "adjust"; category: BusinessCategory | null; radiusMetres: number | null; why: string }
  | { kind: "declined"; reason: string; suggestion: string }
  | { kind: "refused"; reason: string };

export async function postLocationAsk(
  body: {
    question: string;
    category: BusinessCategory;
    radiusMetres: number;
    location: ReportLocation;
    history: ChatTurn[];
  },
  signal?: AbortSignal,
): Promise<ChatResponse> {
  const response = await fetch(`${SIMULATOR_URL}/v1/location/ask`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(
      payload.message ?? "Could not reach the assistant. Your figures are unaffected.",
      response.status,
    );
  }

  return (await response.json()) as ChatResponse;
}

/**
 * PDF reports — Feature 4.
 *
 * Sends INPUTS, never results. The server recomputes every figure with the
 * same engine this browser is running, which is what makes the PDF and the
 * screen provably agree — and what stops a hand-edited request producing a
 * document with Spotential's name on numbers it did not compute.
 */
export interface ReportLocation {
  point: { lat: number; lng: number };
  label: string;
  competitors: CompetitorSummary;
  truncated: boolean;
  completeToMetres: number | null;
  density: DensityBand[];
  demographics?: DemographicsResponse["demographics"];
  rentOverride?: number | null;
  /**
   * The outlets themselves, for the report's "who is already there" table.
   *
   * Sent because the server cannot re-derive them without a paid Places call.
   * They populate one table and nothing scored — every computed figure in the
   * PDF is still recomputed server-side through the shared engine.
   */
  rivals?: CompetitorWithDistance[];
}

export type ReportRequestBody =
  | { kind: "scenario"; inputs: ScenarioInputs }
  | {
      kind: "location";
      category: BusinessCategory;
      radiusMetres: number;
      location: ReportLocation;
    }
  | {
      kind: "comparison";
      category: BusinessCategory;
      radiusMetres: number;
      locations: ReportLocation[];
    };

export interface ReportFile {
  blob: Blob;
  filename: string;
}

export async function postReport(
  body: ReportRequestBody,
  signal?: AbortSignal,
): Promise<ReportFile> {
  const response = await fetch(`${SIMULATOR_URL}/v1/report`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(payload.message ?? "Could not generate the report.", response.status);
  }

  // The server names the file; fall back only if the header is stripped by a
  // proxy, which would otherwise leave the browser saving "report".
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);

  return {
    blob: await response.blob(),
    filename: match?.[1] ?? `spotential-${body.kind}.pdf`,
  };
}

/** Save a generated report, then release the object URL. */
export function downloadReport({ blob, filename }: ReportFile): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * The city demand heatmap.
 *
 * A bounding-box read over a file the service loaded at startup — no Places,
 * no Gemini, nothing billable.
 *
 * Cells arrive with their TRUE H3 boundary, computed server-side. The map used
 * to draw squares of equivalent area, which cannot tile a hexagonal grid and
 * once left a visible gap between every cell. A city is only ~175 cells, so
 * carrying six vertices each costs about 16KB and saves the browser an H3
 * library entirely.
 */
export interface HeatmapCell {
  lat: number;
  lng: number;
  population: number;
  /** Twelve numbers: six lat/lng vertex pairs, in ring order. */
  boundary: number[];
}

export interface HeatmapResponse {
  cells: HeatmapCell[];
  hexagonEdgeMetres: number;
  resolution: number;
  attribution: string;
  vintage: string;
}

export async function getHeatmap(
  bounds: { west: number; south: number; east: number; north: number },
  signal?: AbortSignal,
): Promise<HeatmapResponse> {
  const params = new URLSearchParams({
    west: String(bounds.west),
    south: String(bounds.south),
    east: String(bounds.east),
    north: String(bounds.north),
  });

  const response = await fetch(`${SIMULATOR_URL}/v1/heatmap?${params}`, signal ? { signal } : {});
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(payload.message ?? "Could not load the population grid.", response.status);
  }

  return (await response.json()) as HeatmapResponse;
}

/**
 * Demand generators — OpenStreetMap, via our cache.
 *
 * Separate from the heatmap on purpose. The colour of the map stays one
 * measured quantity (residents); this is what's AROUND those residents, drawn
 * as toggleable layers rather than blended into an invented "demand index".
 *
 * Dense categories report a count but no points: 1,026 bus stops is a useful
 * number and a useless picture.
 */
export interface AmenityPoint {
  lat: number;
  lng: number;
  name?: string;
}

export interface AmenityLayer {
  id: string;
  label: string;
  count: number;
  points: AmenityPoint[];
  pinned: boolean;
}

export interface AmenitiesResponse {
  layers: AmenityLayer[];
  places: { lat: number; lng: number; name: string }[];
  available: boolean;
  reason: string | null;
  fromCache: boolean;
  /** ODbL requires this wherever the data is shown. Render it. */
  attribution?: string;
}

export async function getAmenities(
  bounds: { west: number; south: number; east: number; north: number },
  signal?: AbortSignal,
): Promise<AmenitiesResponse> {
  const params = new URLSearchParams({
    west: String(bounds.west),
    south: String(bounds.south),
    east: String(bounds.east),
    north: String(bounds.north),
  });

  const response = await fetch(`${SIMULATOR_URL}/v1/amenities?${params}`, {
    headers: { ...(await authHeaders()) },
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(payload.message ?? "Could not load nearby amenities.", response.status);
  }

  return (await response.json()) as AmenitiesResponse;
}

export async function getHealth(signal?: AbortSignal): Promise<{
  status: string;
  engineVersion: string;
  presetVersion: string;
}> {
  // /health, not /healthz — Cloud Run's front end reserves the latter.
  const response = await fetch(`${SIMULATOR_URL}/health`, signal ? { signal } : {});
  if (!response.ok) throw new ApiError("Health check failed", response.status);
  return (await response.json()) as { status: string; engineVersion: string; presetVersion: string };
}

/**
 * Events — the opportunity marketplace.
 *
 * Browsing, filtering and ranking are FREE to serve: the catalogue is a file
 * in the Cloud Run image and the score is arithmetic in the shared engine, so
 * none of these calls touch Places or Gemini. They send App Check headers
 * anyway (harmless, and consistent), but the routes do not require them —
 * which means discovery keeps working even where reCAPTCHA is blocked.
 */

export interface EventsResponse {
  events: EventListing[];
  total: number;
  matched: number;
  vintage: string;
}

export async function getEvents(
  filters: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<EventsResponse> {
  const params = new URLSearchParams(filters);
  const query = params.toString();

  const response = await fetch(
    `${SIMULATOR_URL}/v1/events${query ? `?${query}` : ""}`,
    signal ? { signal } : {},
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(payload.message ?? "Could not load events.", response.status);
  }

  return (await response.json()) as EventsResponse;
}

export interface EventDetailResponse {
  event: EventListing;
  days: number;
  entryPriceRm: number | null;
  /** Null means the population grid has no coverage — NOT zero residents. */
  venueCatchment: number | null;
  catchmentRadiusMetres: number;
}

export async function getEvent(id: string, signal?: AbortSignal): Promise<EventDetailResponse> {
  const response = await fetch(
    `${SIMULATOR_URL}/v1/events/${encodeURIComponent(id)}`,
    signal ? { signal } : {},
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(payload.message ?? "Could not load that event.", response.status);
  }

  return (await response.json()) as EventDetailResponse;
}

export interface RankedEvent {
  eventId: string;
  score: EventScore;
}

export async function rankEventsFor(
  vendor: VendorProfile,
  filters: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<{ ranked: RankedEvent[]; matched: number }> {
  const response = await fetch(`${SIMULATOR_URL}/v1/events/rank`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ vendor, filters }),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(payload.message ?? "Could not rank events.", response.status);
  }

  return (await response.json()) as { ranked: RankedEvent[]; matched: number };
}

export interface ApplyPayload {
  packageId: string | null;
  businessName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  productDescription: string;
  consentToShare: boolean;
}

export type ApplyResult =
  | { kind: "applied"; applicationId: string }
  | { kind: "sample"; message: string }
  | { kind: "signin"; message: string }
  | { kind: "invalid"; errors: string[] };

/**
 * Apply for a booth.
 *
 * Sends BOTH header sets: App Check ("is this our app?") and the account
 * bearer token ("who is this?"). The server needs both and they are not
 * interchangeable.
 *
 * Outcomes are modelled rather than thrown, because three of the four are
 * things the form should explain rather than errors — a sample listing, a
 * missing sign-in and a validation failure all have a sensible next step.
 */
export async function applyForBooth(
  eventId: string,
  payload: ApplyPayload,
  signal?: AbortSignal,
): Promise<ApplyResult> {
  const { accountHeaders } = await import("./firebase.js");

  const response = await fetch(
    `${SIMULATOR_URL}/v1/events/${encodeURIComponent(eventId)}/apply`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(await authHeaders()),
        ...(await accountHeaders()),
      },
      body: JSON.stringify({ eventId, ...payload }),
      ...(signal ? { signal } : {}),
    },
  );

  const body = (await response.json().catch(() => ({}))) as {
    message?: string;
    details?: string[];
    application?: { id: string };
    error?: string;
  };

  if (response.ok && body.application) {
    return { kind: "applied", applicationId: body.application.id };
  }

  if (body.error === "sample_event") {
    return { kind: "sample", message: body.message ?? "This is a sample listing." };
  }
  if (response.status === 401 || response.status === 403) {
    return { kind: "signin", message: body.message ?? "Sign in to apply." };
  }
  if (response.status === 400) {
    return { kind: "invalid", errors: body.details ?? ["The application was not accepted."] };
  }

  throw new ApiError(body.message ?? "Could not send that application.", response.status);
}
