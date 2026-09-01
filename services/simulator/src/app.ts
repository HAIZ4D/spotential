import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import {
  ENGINE_VERSION,
  PRESET_VERSION,
  applyPatch,
  changedFields,
  parseScenarioInputs,
  simulate,
  validateOperations,
} from "@spotential/sim-engine";
import { CATEGORY_PRESETS, isValidLatLng, sectorOf } from "@spotential/sim-engine";
import {
  byStartDate,
  entryPrice,
  eventDays,
  filterEvents,
  isPast,
  rankEvents,
  type EventFilters,
  type EventListing,
  type EventType,
  type MalaysianState,
  type VendorProfile,
} from "@spotential/sim-engine";
import type { BusinessCategory } from "@spotential/sim-engine";
import { extractPatch, narrate, narrateGaps, type GeminiConfig } from "./gemini.js";
import { QuotaTracker } from "./quota.js";
import { searchNearby, type PlacesConfig } from "./places.js";
import { findCompetitors } from "./competitors/service.js";
import { detectGaps } from "./competitors/gaps.js";
import { InMemoryCompetitorStore, type CompetitorStore } from "./competitors/store.js";
import type { DemographicsLookup } from "./demographics.js";
import { AppCheckVerifier, callerIdOf, type AppCheckConfig } from "./appcheck.js";
import { NO_MAP, StaticMapFetcher } from "./staticmap.js";
import {
  buildComparisonReport,
  buildLocationReport,
  buildScenarioReport,
  renderReport,
} from "./report/index.js";
import {
  categoryOf,
  filenameOf,
  locationOf,
  parseReportRequest,
  pointsOf,
  radiusOf,
} from "./report/request.js";
import { MAX_HISTORY_TURNS, askAboutLocation, type ChatTurn } from "./chat/ask.js";
import type { PopulationGrid } from "./population.js";
import type { LocationReportInput } from "./report/model.js";
import { H3_RESOLUTION, toCells } from "./hexagons.js";
import { ATTRIBUTION as OSM_ATTRIBUTION, type AmenitiesResult, type Bounds } from "./amenities/overpass.js";
import { InMemoryAmenitiesStore, loadAmenities, type AmenitiesStore } from "./amenities/store.js";
import type { AmenitiesSeed } from "./amenities/seed.js";
import { MAX_LISTINGS, type FetchOutcome } from "./properties/propertyguru.js";
import { InMemoryListingsStore, loadListings, type ListingsStore } from "./properties/store.js";
import { AuthVerifier, userOf, type AuthConfig } from "./auth.js";
import type { EventCatalogue } from "./events/catalogue.js";
import { parseApplyRequest } from "./events/apply.js";
import {
  applicationId,
  type ApplicationStore,
  type BoothApplication,
} from "./events/store.js";

/**
 * The simulator service.
 *
 * Deliberately thin. It imports the exact same engine package the browser
 * imports, so this endpoint is the authority without being a second
 * implementation — there is nothing here that can drift from the client.
 *
 * v1 carries no AI. That lands in Checkpoint 4, behind App Check and a
 * per-UID quota. Shipping the deterministic route first is the point: it
 * proves the deploy pipeline while there is almost nothing to debug — and it
 * already earned its keep by catching the /healthz interception below.
 */

export interface AppOptions {
  /** Comma-separated origins. Defaults to permissive, which is fine pre-deploy. */
  allowedOrigins?: string | undefined;
  logger?: boolean;
  /** Omitted means the AI route reports itself unavailable rather than 500ing. */
  gemini?: GeminiConfig | undefined;
  quota?: QuotaTracker | undefined;
  /** Omitted means the competitors route serves cache only and never spends. */
  places?: PlacesConfig | undefined;
  /** Defaults to in-memory, which is correct for tests and local development. */
  competitorStore?: CompetitorStore | undefined;
  /** Separate ceiling from the AI quota: this one guards Places spend. */
  placesQuota?: QuotaTracker | undefined;
  /**
   * Which backend each subsystem actually resolved to, reported on /health.
   *
   * Exists because a silent downgrade to an in-memory cache ran in production
   * undetected and re-billed Places on every cold start. Making the live
   * backend observable turns that class of failure into a testable assertion.
   */
  backends?: Record<string, string | null> | undefined;
  /** Omitted means /v1/demographics reports itself unavailable. */
  demographics?: DemographicsLookup | undefined;
  /**
   * Omitted means the paid routes are UNGATED. Only acceptable in tests and
   * local development — production always sets this.
   */
  appCheck?: AppCheckConfig | undefined;
  /**
   * Omitted means reports render without a map and say so. The only part of a
   * PDF that costs money, so its configured state is reported on /health.
   */
  staticMaps?: StaticMapFetcher | undefined;
  /**
   * The 400m population grid. Omitted means /v1/heatmap reports itself
   * unavailable and the catchment falls back to the district proxy.
   */
  population?: PopulationGrid | undefined;
  /**
   * Cache for the PropertyGuru listings shown in the Rent tab. Defaults to
   * in-memory, which is correct for tests but would mean re-fetching a third
   * party on every cold start in production — hence it is on /health.
   */
  listingsStore?: ListingsStore | undefined;
  /** Bounds how often we may fetch PropertyGuru. Separate from Places spend. */
  listingsQuota?: QuotaTracker | undefined;
  /** Omitted means the listings route reports itself unavailable. */
  listingsFetcher?: ((area: string) => Promise<FetchOutcome>) | undefined;
  /** Cache for OpenStreetMap demand generators. Defaults to in-memory. */
  amenitiesStore?: AmenitiesStore | undefined;
  /** Bounds how often we may query Overpass, which is a volunteer service. */
  amenitiesQuota?: QuotaTracker | undefined;
  /** Omitted means the amenities route reports itself unavailable. */
  amenitiesFetcher?: ((bounds: Bounds) => Promise<AmenitiesResult>) | undefined;
  /**
   * Bundled snapshot for the cities we ship. Answers without touching
   * Overpass at all, which is both reliable and the polite default.
   */
  amenitiesSeed?: AmenitiesSeed | undefined;
  /**
   * The bundled event catalogue. Omitted means /v1/events reports itself
   * unavailable rather than serving an empty list that looks like a filter
   * matching nothing.
   */
  events?: EventCatalogue | undefined;
  /**
   * Omitted means applying is refused outright. There is deliberately no
   * ungated fallback: an application route without identity verification
   * would write records owned by nobody.
   */
  auth?: AuthConfig | undefined;
  /** Defaults to in-memory, which is correct for tests only. */
  applicationStore?: ApplicationStore | undefined;
}

const MAX_SEARCH_RADIUS_METRES = 2_000;

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    // A scenario is a few dozen short numbers. Nothing legitimate is large.
    bodyLimit: 64 * 1024,
  });

  const origins = options.allowedOrigins
    ?.split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  void app.register(cors, {
    origin: origins && origins.length > 0 ? origins : true,
    methods: ["GET", "POST"],
    // content-disposition is NOT a CORS-safelisted response header, and the
    // browser app is on a different origin to this service. Without this the
    // client can never read the filename the report route chose, and every
    // download silently falls back to a generic name.
    exposedHeaders: ["content-disposition"],
  });

  // NOT /healthz. Cloud Run's front end intercepts that path and answers it
  // itself with an HTML 404 — the request never reaches the container. Verified
  // on the first deploy: GET / returned our JSON 404 while GET /healthz returned
  // Google's HTML one. Do not "fix" this back.
  app.get("/health", async () => ({
    status: "ok",
    engineVersion: ENGINE_VERSION,
    presetVersion: PRESET_VERSION,
    backends: options.backends ?? {
      gemini: options.gemini ? options.gemini.transport.name : "none",
      geminiModel: options.gemini?.transport.model ?? null,
      competitorCache: options.competitorStore ? "provided" : "in-memory",
      places: options.places?.apiKey ? "configured" : "none",
      demographics: options.demographics ? `districts:${options.demographics.districtCount}` : "none",
      appCheck: options.appCheck ? "enforced" : "off",
      staticMaps: options.staticMaps ? "configured" : "none",
      population: options.population ? `hexagons:${options.population.hexagonCount}` : "none",
      listingsCache: options.listingsStore ? "provided" : "in-memory",
      listings: options.listingsFetcher ? "propertyguru" : "none",
      amenitiesCache: options.amenitiesStore ? "provided" : "in-memory",
      amenities: options.amenitiesFetcher ? "overpass" : "none",
      amenitiesSeed: options.amenitiesSeed ? `cities:${options.amenitiesSeed.cityCount}` : "none",
      events: options.events ? `seed:${options.events.size}` : "none",
      auth: options.auth ? "firebase" : "off",
      applications: options.applicationStore ? "provided" : "in-memory",
    },
  }));

  app.post("/v1/simulate", async (request, reply) => {
    const body = request.body as { inputs?: unknown } | undefined;

    // Every request body is untrusted. The same guard runs on decoded share
    // URLs and on AI patches, so there is one definition of "valid scenario".
    const parsed = parseScenarioInputs(body?.inputs);
    if (!parsed.ok) {
      return reply.status(400).send({
        error: "invalid_scenario",
        message: "The scenario did not pass validation.",
        details: parsed.errors,
      });
    }

    return {
      result: simulate(parsed.value),
      engineVersion: ENGINE_VERSION,
      presetVersion: PRESET_VERSION,
    };
  });

  // App Check gates the routes that cost money. Built once; each protected
  // route attaches it as a preHandler.
  const appCheck = options.appCheck ? new AppCheckVerifier(options.appCheck) : null;
  const paidRoute = appCheck ? { preHandler: appCheck.guard() } : {};

  const quota = options.quota ?? new QuotaTracker();

  /**
   * SPEC §8 — the AI route.
   *
   * The order matters: quota before Gemini so a rate-limited caller costs
   * nothing, and patch validation before the engine so a bad tool call cannot
   * reach the maths or the UI.
   */
  app.post("/v1/simulate/ask", paidRoute, async (request, reply) => {
    const body = request.body as { inputs?: unknown; question?: unknown; clarified?: unknown };

    const parsed = parseScenarioInputs(body?.inputs);
    if (!parsed.ok) {
      return reply
        .status(400)
        .send({ error: "invalid_scenario", message: "The scenario did not pass validation.", details: parsed.errors });
    }

    const question = typeof body?.question === "string" ? body.question.trim() : "";
    if (question.length === 0 || question.length > 500) {
      return reply
        .status(400)
        .send({ error: "invalid_question", message: "Ask a question between 1 and 500 characters." });
    }

    if (!options.gemini) {
      return reply
        .status(503)
        .send({ error: "ai_unavailable", message: "The assistant is not configured on this deployment." });
    }

    const callerId = callerIdOf(request);
    const allowed = quota.check(callerId);
    if (!allowed.allowed) {
      return reply.status(429).send({ error: "quota_exceeded", message: allowed.reason });
    }
    quota.record(callerId);

    let outcome;
    try {
      outcome = await extractPatch(
        options.gemini,
        question,
        parsed.value,
        body?.clarified === true,
      );
    } catch (error) {
      // The deterministic core must never be brought down by the AI layer.
      // The user still has correct figures on screen.
      request.log.error({ err: error }, "gemini extract failed");
      return reply
        .status(502)
        .send({ error: "ai_failed", message: "Could not reach the assistant. Your figures are unaffected." });
    }

    if (outcome.kind === "clarification") {
      return { kind: "clarification", question: outcome.question };
    }
    if (outcome.kind === "declined") {
      return { kind: "declined", reason: outcome.reason, suggestion: outcome.suggestion };
    }

    // Validate before anything reaches the engine or crosses back to the UI.
    // This is also the prompt-injection defence: a jailbroken model still
    // cannot name a field outside the allow-list.
    const operations = validateOperations(outcome.operations);
    if (!operations.ok) {
      request.log.warn({ errors: operations.errors }, "rejected model patch");
      return reply.status(422).send({
        error: "invalid_patch",
        message: "The assistant proposed a change that did not make sense. Nothing was applied.",
        details: operations.errors,
      });
    }

    const before = simulate(parsed.value);
    const nextInputs = applyPatch(parsed.value, operations.operations);
    const after = simulate(nextInputs);

    // Narration is handed the already-computed diff. It describes numbers, it
    // never produces them, so the chat cannot contradict the panel.
    const narration = await narrate(options.gemini, question, outcome.label, before, after);

    return {
      kind: "patch",
      label: outcome.label,
      rationale: outcome.rationale,
      operations: operations.operations,
      changedFields: changedFields(parsed.value, nextInputs),
      inputs: nextInputs,
      result: after,
      narration,
      engineVersion: ENGINE_VERSION,
      presetVersion: PRESET_VERSION,
    };
  });

  const competitorStore = options.competitorStore ?? new InMemoryCompetitorStore();
  // Deliberately separate from the AI quota, and it counts only UNCACHED
  // searches — a cache hit costs nothing, so rate-limiting it would just make
  // the product worse for no saving.
  const placesQuota =
    options.placesQuota ?? new QuotaTracker({ perCallerPerDay: 60, globalPerDay: 1_000 });

  const listingsStore = options.listingsStore ?? new InMemoryListingsStore();

  /**
   * Deliberately tighter than the Places ceiling.
   *
   * This one is not protecting our budget — it is protecting somebody else's
   * server. With a 24h cache, 400 fetches a day is 400 distinct areas, far
   * more than this product legitimately looks at.
   */
  const listingsQuota =
    options.listingsQuota ?? new QuotaTracker({ perCallerPerDay: 20, globalPerDay: 400 });

  const amenitiesStore = options.amenitiesStore ?? new InMemoryAmenitiesStore();

  /**
   * The tightest ceiling in the app, and the one that matters most ethically.
   *
   * Overpass is run by volunteers. With a 7-day cache the whole product needs
   * about four queries a week, so a hundred a day is already enormous headroom
   * and exists only to bound a bug.
   */
  const amenitiesQuota =
    options.amenitiesQuota ?? new QuotaTracker({ perCallerPerDay: 10, globalPerDay: 100 });

  app.post("/v1/competitors", paidRoute, async (request, reply) => {
    const body = request.body as
      | { lat?: unknown; lng?: unknown; radiusMetres?: unknown; category?: unknown }
      | undefined;

    const lat = Number(body?.lat);
    const lng = Number(body?.lng);
    if (!isValidLatLng({ lat, lng })) {
      return reply
        .status(400)
        .send({ error: "invalid_location", message: "lat and lng must be valid coordinates." });
    }

    const radiusMetres = Number(body?.radiusMetres);
    if (!Number.isFinite(radiusMetres) || radiusMetres <= 0 || radiusMetres > MAX_SEARCH_RADIUS_METRES) {
      return reply.status(400).send({
        error: "invalid_radius",
        message: `radiusMetres must be between 1 and ${MAX_SEARCH_RADIUS_METRES}.`,
      });
    }

    const category = body?.category;
    if (typeof category !== "string" || !(category in CATEGORY_PRESETS)) {
      return reply
        .status(400)
        .send({ error: "invalid_category", message: "Unknown business category." });
    }

    // Cache hits are free, so the ceiling only gates whether we may SPEND.
    // Over the limit we still serve whatever is cached rather than erroring.
    const callerId = callerIdOf(request);
    const allowFetch = Boolean(options.places?.apiKey) && placesQuota.check(callerId).allowed;

    try {
      const result = await findCompetitors(
        competitorStore,
        async (centre, radius, cat) => {
          placesQuota.record(callerId);
          return searchNearby(options.places!, centre, radius, cat);
        },
        { lat, lng },
        radiusMetres,
        category as BusinessCategory,
        { allowFetch },
      );

      return {
        ...result,
        // Tell the client why a result is empty, so the UI can distinguish
        // "nothing here" from "we chose not to look".
        searchSkipped: !result.fromCache && !allowFetch,
        placesConfigured: Boolean(options.places?.apiKey),
      };
    } catch (error) {
      request.log.error({ err: error }, "competitor search failed");
      return reply.status(502).send({
        error: "places_failed",
        message: "Could not reach the competitor data source.",
      });
    }
  });

  /**
   * Opportunity Gap Detection.
   *
   * Six category searches through the same cache as /v1/competitors, then
   * deterministic scoring, then — only if all of that succeeded — a Gemini Pro
   * write-up. The table is the product; the prose is a bonus that must never
   * be able to take the analysis down with it.
   */
  app.post("/v1/opportunity-gaps", paidRoute, async (request, reply) => {
    const body = request.body as
      | { lat?: unknown; lng?: unknown; radiusMetres?: unknown; category?: unknown }
      | undefined;

    const lat = Number(body?.lat);
    const lng = Number(body?.lng);
    if (!isValidLatLng({ lat, lng })) {
      return reply
        .status(400)
        .send({ error: "invalid_location", message: "lat and lng must be valid coordinates." });
    }

    const radiusMetres = Number(body?.radiusMetres);
    if (
      !Number.isFinite(radiusMetres) ||
      radiusMetres <= 0 ||
      radiusMetres > MAX_SEARCH_RADIUS_METRES
    ) {
      return reply.status(400).send({
        error: "invalid_radius",
        message: `radiusMetres must be between 1 and ${MAX_SEARCH_RADIUS_METRES}.`,
      });
    }

    /**
     * The sector to compare within, derived from the caller's category.
     *
     * This is the spend control: one Places call per category searched, so
     * scoping to a sector is what stops fifteen categories costing 2.5x what
     * six did. Defaults to F&B, which is what every existing caller means.
     */
    const gapCategory = body?.category;
    const sector =
      typeof gapCategory === "string" && gapCategory in CATEGORY_PRESETS
        ? sectorOf(gapCategory as BusinessCategory)
        : "fnb";

    const callerId = callerIdOf(request);
    const allowFetch = Boolean(options.places?.apiKey) && placesQuota.check(callerId).allowed;

    try {
      const analysis = await detectGaps(
        competitorStore,
        async (centre, radius, cat) => {
          placesQuota.record(callerId);
          return searchNearby(options.places!, centre, radius, cat);
        },
        { lat, lng },
        radiusMetres,
        { allowFetch, sector },
      );

      // Only worth a Pro call if there is actually something to write about.
      const narrative =
        options.gemini && analysis.topOpportunity
          ? await narrateGaps(options.gemini, analysis)
          : "";

      return {
        ...analysis,
        narrative,
        searchSkipped: !analysis.fromCache && !allowFetch,
        placesConfigured: Boolean(options.places?.apiKey),
      };
    } catch (error) {
      request.log.error({ err: error }, "gap detection failed");
      return reply
        .status(502)
        .send({ error: "gaps_failed", message: "Could not analyse this area." });
    }
  });

  /**
   * District demographics.
   *
   * Costs nothing per call — two static files loaded once per instance, then
   * pure point-in-polygon. No Places, no Gemini, no cache needed.
   */
  app.post("/v1/demographics", async (request, reply) => {
    const body = request.body as { lat?: unknown; lng?: unknown } | undefined;

    const lat = Number(body?.lat);
    const lng = Number(body?.lng);
    if (!isValidLatLng({ lat, lng })) {
      return reply
        .status(400)
        .send({ error: "invalid_location", message: "lat and lng must be valid coordinates." });
    }

    if (!options.demographics) {
      return reply.status(503).send({
        error: "demographics_unavailable",
        message: "Demographic data is not loaded on this deployment.",
      });
    }

    const radius = radiusOf((request.body as Record<string, unknown> | undefined)?.["radiusMetres"]);

    /**
     * The catchment is the figure that actually matters, and it is a different
     * claim from the district total: residents within walking distance rather
     * than across a whole federal territory. Both are returned, labelled, so
     * the UI can show the district as context without it being mistaken for a
     * customer base.
     */
    const catchment = options.population
      ? options.population.catchment({ lat, lng }, radius ?? 500)
      : null;

    return {
      ...options.demographics.find({ lat, lng }),
      catchment,
      ...(options.population
        ? {
            catchmentSource: options.population.attribution,
            catchmentVintage: options.population.vintage,
          }
        : {}),
    };
  });

  /**
   * Demand generators for the city heatmap — OpenStreetMap, via Overpass.
   *
   * GATED, like every route that reaches outside. Overpass is run by
   * volunteers rather than a company, so an ungated route here would turn us
   * into an open proxy pointed at a commons. The 7-day cache means the whole
   * product needs roughly four queries a week.
   *
   * The population map works perfectly well without this, so nothing here is
   * allowed to fail loudly.
   */
  app.get("/v1/amenities", paidRoute, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const num = (value: string | undefined) => {
      const parsed = Number(value);
      return value !== undefined && value.trim() !== "" && Number.isFinite(parsed) ? parsed : null;
    };

    const west = num(query["west"]);
    const south = num(query["south"]);
    const east = num(query["east"]);
    const north = num(query["north"]);

    if (west === null || south === null || east === null || north === null) {
      return reply
        .status(400)
        .send({ error: "invalid_bounds", message: "west, south, east and north are required." });
    }
    if (east <= west || north <= south) {
      return reply
        .status(400)
        .send({ error: "invalid_bounds", message: "The bounding box is inverted or empty." });
    }

    // Much tighter than the heatmap's cap: a huge Overpass box is slow for
    // them, not just for us.
    const MAX_SPAN_DEGREES = 0.3;
    if (east - west > MAX_SPAN_DEGREES || north - south > MAX_SPAN_DEGREES) {
      return reply.status(400).send({
        error: "bounds_too_large",
        message: `Request at most ${MAX_SPAN_DEGREES} degrees per side, about 33km.`,
      });
    }

    /**
     * The snapshot first, and for the shipped cities that is the whole story.
     *
     * Checked before the cache and before any fetch: it is already the freshest
     * thing we have for these boxes, it cannot fail, and preferring it means a
     * user's page load never depends on a volunteer service being healthy.
     */
    const seeded = options.amenitiesSeed?.find({ west, south, east, north });
    if (seeded) {
      return {
        layers: seeded.layers,
        places: seeded.places,
        available: true,
        reason: null,
        fromCache: true,
        source: "bundled",
        vintage: options.amenitiesSeed?.vintage ?? null,
        attribution: OSM_ATTRIBUTION,
      };
    }

    if (!options.amenitiesFetcher) {
      return { layers: [], places: [], available: false, reason: "not_configured", fromCache: false };
    }

    const callerId = callerIdOf(request);
    const allowFetch = amenitiesQuota.check(callerId).allowed;

    try {
      const result = await loadAmenities(
        amenitiesStore,
        { west, south, east, north },
        async (bounds) => {
          amenitiesQuota.record(callerId);
          return options.amenitiesFetcher!(bounds);
        },
        { allowFetch },
      );

      // Named, not swallowed. A third-party fetch that fails silently is how
      // the competitor cache spent a day quietly re-billing Places.
      if (!result.available) {
        request.log.warn(
          { reason: result.reason, detail: (result as { detail?: string }).detail },
          "overpass unavailable",
        );
      }

      // ODbL requires attribution wherever the data is shown, so it travels
      // with the data rather than being remembered separately by the client.
      const { detail: _detail, ...safe } = result as typeof result & { detail?: string };
      return { ...safe, source: "overpass", attribution: OSM_ATTRIBUTION };
    } catch (error) {
      request.log.error({ err: error }, "amenities lookup failed");
      return { layers: [], places: [], available: false, reason: "cache_failed", fromCache: false };
    }
  });

  /**
   * Retail listings for the Rent tab.
   *
   * GATED even though it spends nothing on a paid API. An ungated route that
   * fetches a third party on demand is an open scraping proxy pointed at
   * PropertyGuru, and that is the abuse worth closing off — the cost here is
   * somebody else's server, not our bill.
   *
   * Never 5xxs. The Rent tab is about rent; it worked before listings existed
   * and must keep working when they are unavailable, so every failure returns
   * 200 with `available: false` and the client falls back to portal links.
   */
  app.get("/v1/properties", paidRoute, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;

    const area = (query["area"] ?? "").trim();
    if (area === "" || area.length > 80) {
      return reply
        .status(400)
        .send({ error: "invalid_area", message: "area must be a non-empty place name." });
    }

    const requested = Number(query["limit"]);
    const limit =
      Number.isFinite(requested) && requested >= 1
        ? Math.min(Math.floor(requested), MAX_LISTINGS)
        : MAX_LISTINGS;

    if (!options.listingsFetcher) {
      return { listings: [], available: false, reason: "not_configured", fromCache: false, area };
    }

    const callerId = callerIdOf(request);
    const allowFetch = listingsQuota.check(callerId).allowed;

    try {
      const result = await loadListings(
        listingsStore,
        area,
        async (searchArea) => {
          listingsQuota.record(callerId);
          return options.listingsFetcher!(searchArea);
        },
        { allowFetch },
      );

      return { ...result, listings: result.listings.slice(0, limit), area };
    } catch (error) {
      // Only a cache backend can get us here — the fetcher swallows its own
      // failures. Still not fatal to the panel.
      request.log.error({ err: error }, "listings lookup failed");
      return { listings: [], available: false, reason: "cache_failed", fromCache: false, area };
    }
  });

  /**
   * The city heatmap — population density at 400m.
   *
   * Costs nothing to serve: a bounding-box read over a file loaded at startup,
   * no Places, no Gemini. Ungated for the same reason /v1/demographics is.
   *
   * It maps DEMAND, not opportunity. Competition is the half that bills, and
   * it is deliberately absent rather than approximated — see the panel copy.
   */
  app.get("/v1/heatmap", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const num = (value: string | undefined) => {
      const parsed = Number(value);
      return value !== undefined && value.trim() !== "" && Number.isFinite(parsed) ? parsed : null;
    };

    const west = num(query["west"]);
    const south = num(query["south"]);
    const east = num(query["east"]);
    const north = num(query["north"]);

    if (west === null || south === null || east === null || north === null) {
      return reply
        .status(400)
        .send({ error: "invalid_bounds", message: "west, south, east and north are required." });
    }
    if (east <= west || north <= south) {
      return reply
        .status(400)
        .send({ error: "invalid_bounds", message: "The bounding box is inverted or empty." });
    }

    // A whole-country box would be 147,936 hexagons and several megabytes.
    // Capped so one request cannot become a denial of service by accident.
    const MAX_SPAN_DEGREES = 1.5;
    if (east - west > MAX_SPAN_DEGREES || north - south > MAX_SPAN_DEGREES) {
      return reply.status(400).send({
        error: "bounds_too_large",
        message: `Request at most ${MAX_SPAN_DEGREES} degrees per side, about 165km.`,
      });
    }

    if (!options.population) {
      return reply.status(503).send({
        error: "heatmap_unavailable",
        message: "The population grid is not loaded on this deployment.",
      });
    }

    /**
     * True H3 boundaries, not squares.
     *
     * A city view is only ~175 cells, so expanding each to its six vertices
     * takes the payload from about 4KB to 20KB — cheap enough that the client
     * needs no H3 library and the browser bundle is untouched.
     */
    return {
      cells: toCells(options.population.within({ west, south, east, north })),
      hexagonEdgeMetres: 400,
      resolution: H3_RESOLUTION,
      attribution: options.population.attribution,
      vintage: options.population.vintage,
    };
  });

  /**
   * PDF reports — Feature 4.
   *
   * App Check'd because it burns real CPU and, where a map key is configured,
   * one billable Static Maps call. It calls neither Places nor Gemini: the
   * competitor summary rides in from the client's already-cached fetch, and
   * every number is recomputed here by the shared engine.
   */
  app.post("/v1/report", paidRoute, async (request, reply) => {
    const parsed = parseReportRequest(request.body);
    if (!parsed.ok) {
      return reply.status(400).send({ error: parsed.error, message: parsed.message });
    }

    /**
     * Catchment is MEASURED here, from the service's own grid — never read
     * from the request body. A client asserting its own catchment could put
     * any population it liked on a document carrying Spotential's name.
     */
    const withCatchment = (location: LocationReportInput): LocationReportInput => ({
      ...location,
      catchment:
        options.population?.catchment(location.point, location.radiusMetres).population ?? null,
    });

    if (parsed.value.kind === "location") {
      parsed.value.location = withCatchment(parsed.value.location);
    } else if (parsed.value.kind === "comparison") {
      parsed.value.locations = parsed.value.locations.map(withCatchment);
    }

    const callerId = callerIdOf(request);
    const points = pointsOf(parsed.value);

    // Never lets a map problem fail the report — see staticmap.ts.
    const map =
      points.length > 0 && options.staticMaps
        ? await options.staticMaps.fetch(points, callerId)
        : points.length > 0
          ? NO_MAP
          : { dataUri: null, note: null };

    try {
      const model =
        parsed.value.kind === "scenario"
          ? buildScenarioReport(parsed.value.inputs, map)
          : parsed.value.kind === "location"
            ? buildLocationReport(parsed.value.location, map)
            : buildComparisonReport(
                parsed.value.category,
                parsed.value.radiusMetres,
                parsed.value.locations,
                map,
              );

      const pdf = await renderReport(model);

      return reply
        .header("content-type", "application/pdf")
        .header("content-disposition", `attachment; filename="${filenameOf(parsed.value)}"`)
        // The report is derived entirely from the request body, so there is
        // nothing for a shared cache to key on usefully.
        .header("cache-control", "no-store")
        .send(pdf);
    } catch (error) {
      request.log.error({ error }, "report rendering failed");
      return reply
        .status(500)
        .send({ error: "report_failed", message: "Could not generate the report." });
    }
  });

  /**
   * The location chatbot — Feature 3.
   *
   * Grounded on a fact sheet built here by the shared engine, so an answer
   * cannot cite a figure the panels did not produce — enforced by a numeric
   * guard, not by asking the model nicely. Costs one Gemini call and nothing
   * else: it never touches Places.
   */
  app.post("/v1/location/ask", paidRoute, async (request, reply) => {
    const body = request.body as Record<string, unknown> | undefined;
    const raw = body ?? {};

    const question = typeof raw["question"] === "string" ? raw["question"].trim() : "";
    if (question.length === 0 || question.length > 500) {
      return reply
        .status(400)
        .send({ error: "invalid_question", message: "Ask a question between 1 and 500 characters." });
    }

    const category = categoryOf(raw["category"]);
    const radiusMetres = radiusOf(raw["radiusMetres"]);
    if (!category || radiusMetres === null) {
      return reply
        .status(400)
        .send({ error: "invalid_context", message: "A valid business type and radius are required." });
    }

    const location = locationOf(raw["location"], category, radiusMetres);
    if (!location) {
      return reply
        .status(400)
        .send({ error: "invalid_location", message: "location.point must be a valid coordinate." });
    }

    if (!options.gemini) {
      return reply.status(503).send({
        error: "ai_unavailable",
        message: "The assistant is not configured on this deployment.",
      });
    }

    const callerId = callerIdOf(request);
    const allowed = quota.check(callerId);
    if (!allowed.allowed) {
      return reply.status(429).send({ error: "quota_exceeded", message: allowed.reason });
    }
    quota.record(callerId);

    // Bounded here as well as in the client: history arrives over the wire and
    // is what makes a request expensive.
    const history: ChatTurn[] = Array.isArray(raw["history"])
      ? (raw["history"] as unknown[])
          .filter(
            (turn): turn is ChatTurn =>
              typeof turn === "object" &&
              turn !== null &&
              ((turn as ChatTurn).role === "user" || (turn as ChatTurn).role === "model") &&
              typeof (turn as ChatTurn).text === "string",
          )
          .slice(-MAX_HISTORY_TURNS)
          .map((turn) => ({ role: turn.role, text: turn.text.slice(0, 1_000) }))
      : [];

    // Measured server-side, same as the report route.
    const grounded: LocationReportInput = {
      ...location,
      catchment: options.population?.catchment(location.point, radiusMetres).population ?? null,
    };

    try {
      return await askAboutLocation(options.gemini, question, grounded, history);
    } catch (error) {
      // Same posture as the simulator's ask panel: the AI layer failing must
      // never suggest the figures on screen are wrong.
      request.log.error({ err: error }, "location chat failed");
      return reply.status(502).send({
        error: "ai_failed",
        message: "Could not reach the assistant. Every figure on the page is unaffected.",
      });
    }
  });


  /**
   * Events — the opportunity marketplace.
   *
   * NOT App Check'd, and that is a cost decision as much as a policy one:
   * browsing and scoring touch neither Places nor Gemini. The catalogue is a
   * file in the image and the score is pure arithmetic in the shared engine,
   * so the entire discovery experience — list, filter, rank, ROI — costs
   * exactly nothing to serve. Gating it would only make it fail for anyone
   * whose reCAPTCHA is blocked, for no saving at all.
   *
   * Applying IS gated, by authentication rather than App Check, because that
   * is where a person's contact details start existing.
   */
  const events = options.events;

  /** Query strings arrive as strings; only pass through what the engine knows. */
  function parseFilters(query: Record<string, string | undefined>): EventFilters {
    const filters: EventFilters = {};

    const q = query["q"]?.trim();
    if (q) filters.query = q;

    if (query["state"]) filters.state = query["state"] as MalaysianState;
    if (query["type"]) filters.eventType = query["type"] as EventType;
    if (query["category"]) filters.category = query["category"] as BusinessCategory;
    if (query["sectorMatch"] === "true") filters.sectorMatch = true;
    if (query["availableOnly"] === "true") filters.availableOnly = true;
    if (query["startsAfter"]) filters.startsAfter = query["startsAfter"];
    if (query["endsBefore"]) filters.endsBefore = query["endsBefore"];

    /**
     * An explicit empty/undefined check, never a falsy one: `maxPrice=0` is a
     * real request for free booths, and treating it as "no filter" is the same
     * class of bug as `Number("")` being 0 in the share URLs.
     */
    const maxPrice = query["maxPrice"];
    if (maxPrice !== undefined && maxPrice.trim() !== "") {
      const parsed = Number(maxPrice);
      if (Number.isFinite(parsed) && parsed >= 0) filters.maxBoothPriceRm = parsed;
    }

    return filters;
  }

  /**
   * Residents around a venue, from the free 400m grid.
   *
   * The same grid and the same function the Success Score uses. Fixed at 500m
   * here because an event has no radius control, so it matches /analysis at
   * that page's default; a user who widens the analysis radius is asking a
   * different question and correctly gets a different number.
   */
  const CATCHMENT_RADIUS_M = 500;
  function venueCatchment(event: EventListing): number | null {
    if (!options.population) return null;
    const result = options.population.catchment(event.point, CATCHMENT_RADIUS_M);
    return result?.population ?? null;
  }

  app.get("/v1/events", async (request, reply) => {
    if (!events) {
      return reply.status(503).send({
        error: "events_unavailable",
        message: "The event catalogue is not loaded on this deployment.",
      });
    }

    const query = request.query as Record<string, string | undefined>;
    const filtered = filterEvents(events.all(), parseFilters(query));

    /**
     * `total` counts what is LISTED, which is not the size of the catalogue.
     *
     * It was `events.size`, so an event whose run had finished still counted
     * toward it while being correctly dropped from the array — the route
     * answered `total: 8` beside seven events the day after one ended. Every
     * consumer reads it as "listed": the hero says "8 events listed right
     * now", and the empty state says "the cheapest booth in the 8 listed
     * events", both of which were then wrong by one and unfalsifiable from
     * the page. Filters stay out of it — that is what `matched` is for.
     */
    const listable = events.all().filter((event) => !isPast(event));

    return {
      events: byStartDate(filtered),
      total: listable.length,
      matched: filtered.length,
      vintage: events.vintage,
    };
  });

  /**
   * Rank the catalogue for one vendor.
   *
   * A POST because a vendor profile is a structured object rather than a
   * handful of query parameters — but it is still free, still deterministic,
   * and still makes no external call.
   */
  app.post("/v1/events/rank", async (request, reply) => {
    if (!events) {
      return reply.status(503).send({
        error: "events_unavailable",
        message: "The event catalogue is not loaded on this deployment.",
      });
    }

    const body = request.body as { vendor?: unknown; filters?: EventFilters } | undefined;
    const vendor = parseVendorProfile(body?.vendor);

    if (!vendor) {
      return reply.status(400).send({
        error: "invalid_vendor",
        message: "A vendor profile needs at least a known business category.",
      });
    }

    const filtered = filterEvents(events.all(), body?.filters ?? {});

    // Catchments come from the in-image grid, so scoring the whole list is a
    // few hundred arithmetic operations rather than a paid lookup per venue.
    const catchments = new Map<string, number>();
    for (const event of filtered) {
      const population = venueCatchment(event);
      if (population !== null) catchments.set(event.id, population);
    }

    return {
      ranked: rankEvents(filtered, vendor, catchments).map(({ event, score }) => ({
        eventId: event.id,
        score,
      })),
      matched: filtered.length,
    };
  });

  app.get("/v1/events/:id", async (request, reply) => {
    if (!events) {
      return reply.status(503).send({
        error: "events_unavailable",
        message: "The event catalogue is not loaded on this deployment.",
      });
    }

    const { id } = request.params as { id: string };
    const event = events.byId(id);

    if (!event) {
      return reply.status(404).send({ error: "event_not_found", message: "No such event." });
    }

    const catchment = venueCatchment(event);

    return {
      event,
      days: eventDays(event),
      entryPriceRm: entryPrice(event),
      /**
       * Location intelligence, free of charge. Null where the grid has no
       * coverage — which is honest, and different from zero residents.
       */
      venueCatchment: catchment,
      catchmentRadiusMetres: CATCHMENT_RADIUS_M,
    };
  });

  /**
   * Apply for a booth.
   *
   * Two independent gates, answering two different questions: App Check asks
   * whether this came from our app, and auth asks who is asking. The uid is
   * taken from the verified token and NEVER from the body — accepting a
   * client-supplied uid would let anyone write a record owned by someone else.
   */
  const auth = options.auth ? new AuthVerifier(options.auth) : null;

  /**
   * NO in-memory default, unlike every cache in this service.
   *
   * A cache that silently downgrades to memory costs money — that already
   * happened here and is why backends are reported on /health. An APPLICATION
   * that silently downgrades to memory is worse than expensive: the vendor
   * sees a confirmation, the record dies with the instance, and the organizer
   * never learns they applied. So an absent store makes the route refuse
   * rather than accept something it cannot keep.
   */
  const applications = options.applicationStore ?? null;

  app.post(
    "/v1/events/:id/apply",
    auth ? { preHandler: auth.guard() } : {},
    async (request, reply) => {
      if (!auth || !applications) {
        // No ungated fallback and no volatile one. A route without identity
        // would write records owned by nobody; a route without durable storage
        // would lose them. Either way, being down is the honest outcome.
        return reply.status(503).send({
          error: "applications_unavailable",
          message: "Applications are not available on this deployment.",
        });
      }
      if (!events) {
        return reply.status(503).send({
          error: "events_unavailable",
          message: "The event catalogue is not loaded on this deployment.",
        });
      }

      const user = userOf(request);
      if (!user) {
        return reply.status(401).send({ error: "sign_in_required", message: "Sign in to apply." });
      }

      const parsed = parseApplyRequest(request.body);
      if (!parsed.ok) {
        return reply.status(400).send({
          error: "invalid_application",
          message: "The application did not pass validation.",
          details: parsed.errors,
        });
      }

      const { id } = request.params as { id: string };
      const event = events.byId(id);
      if (!event) {
        return reply.status(404).send({ error: "event_not_found", message: "No such event." });
      }

      /**
       * A sample listing is not a real booking, and must never behave like
       * one. Letting a vendor believe they applied to an event that does not
       * exist is the single most harmful thing this feature could do, so it is
       * refused at the route rather than merely discouraged in the UI.
       */
      if (event.source === "seed") {
        return reply.status(409).send({
          error: "sample_event",
          message:
            "This is a sample listing used to demonstrate scoring, not a live booking. " +
            "Applications open when a real organizer publishes an event.",
        });
      }

      const application: BoothApplication = {
        id: applicationId(user.uid, event.id),
        uid: user.uid,
        eventId: event.id,
        eventName: event.name,
        packageId: parsed.value.packageId,
        businessName: parsed.value.businessName,
        contactName: parsed.value.contactName,
        contactEmail: parsed.value.contactEmail,
        contactPhone: parsed.value.contactPhone,
        productDescription: parsed.value.productDescription,
        status: "submitted",
        submittedAt: Date.now(),
      };

      await applications.save(application);

      return { application, applied: true };
    },
  );

  /** A vendor's own applications, and only ever their own. */
  app.get(
    "/v1/events/applications",
    auth ? { preHandler: auth.guard() } : {},
    async (request, reply) => {
      if (!auth || !applications) {
        return reply.status(503).send({
          error: "applications_unavailable",
          message: "Applications are not available on this deployment.",
        });
      }

      const user = userOf(request);
      if (!user) {
        return reply.status(401).send({ error: "sign_in_required", message: "Sign in first." });
      }

      // Scoped by the VERIFIED uid, so there is no filter a client could widen.
      return { applications: await applications.listForUser(user.uid) };
    },
  );

  app.setNotFoundHandler(async (_request, reply) =>
    reply.status(404).send({ error: "not_found" }),
  );

  return app;
}

/**
 * A vendor profile off the wire.
 *
 * Everything except the category is optional, and an absent field stays null
 * rather than being defaulted — a vendor who has not said their budget must
 * see that axis go unavailable, not have a number invented for them.
 */
function parseVendorProfile(value: unknown): VendorProfile | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;

  const category = raw["category"];
  if (typeof category !== "string" || !(category in CATEGORY_PRESETS)) return null;

  const base = isValidLatLng(raw["base"]) ? raw["base"] : null;

  /**
   * `Number("")` is 0, and a booth budget of 0 is not "no budget" — it is a
   * vendor who will only take free stalls. Both are legitimate and they score
   * completely differently, so an empty field must become null, not zero.
   */
  const budget = raw["boothBudgetRm"];
  const boothBudgetRm =
    typeof budget === "number" && Number.isFinite(budget) && budget >= 0 ? budget : null;

  const travel = raw["maxTravelKm"];
  const maxTravelKm =
    typeof travel === "number" && Number.isFinite(travel) && travel > 0 ? travel : null;

  return {
    category: category as BusinessCategory,
    base,
    boothBudgetRm,
    maxTravelKm,
  };
}
