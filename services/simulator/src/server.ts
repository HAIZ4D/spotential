import { setDefaultResultOrder } from "node:dns";
import { buildApp } from "./app.js";
import { aiStudioTransport, type GeminiTransport } from "./gemini.js";
import { StaticMapFetcher } from "./staticmap.js";
import { PopulationGrid } from "./population.js";
import { fetchListings } from "./properties/propertyguru.js";
import { fetchAmenities } from "./amenities/overpass.js";
import {
  VERTEX_DEFAULT_LOCATION,
  VERTEX_DEFAULT_MODEL,
  detectProjectId,
  vertexTransport,
} from "./vertex.js";

/**
 * Cloud Run has NO IPv6 EGRESS, and Node prefers AAAA records.
 *
 * Overpass resolves to both, so every outbound call tried 2a01:4f8:… first,
 * hung, and burned undici's 10-second connect budget before the IPv4 address
 * got a fair attempt — surfacing as `ConnectTimeoutError` and a permanently
 * "unreachable" amenities layer that worked perfectly from a laptop.
 *
 * `ipv4first` is process-wide and belongs in the entrypoint rather than in any
 * one client, because it is a property of where this runs, not of who it calls.
 * It applies to every outbound fetch, which is what we want.
 */
setDefaultResultOrder("ipv4first");

/**
 * Cloud Run entrypoint. Cloud Run supplies PORT and expects the process to
 * listen on 0.0.0.0 — binding to localhost makes the container start fine and
 * then fail every health check, which is a confusing way to lose an afternoon.
 */
const port = Number(process.env["PORT"] ?? 8080);
const host = "0.0.0.0";

/** Cloud Run sets this. GOOGLE_CLOUD_PROJECT is App Engine, not Cloud Run. */
const onCloudRun = Boolean(process.env["K_SERVICE"]);

/**
 * Choose the Gemini transport EXPLICITLY — never by fallback.
 *
 * Default is the AI Studio key, which is a deliberate COST decision: AI Studio
 * has a free tier and Vertex bills from the first token, so at this volume the
 * key is materially cheaper, often free.
 *
 * The trade accepted in exchange:
 *   - AI Studio bills OUTSIDE the GCP project, so Gemini spend does not appear
 *     in the project budget. Watch it separately in AI Studio.
 *   - A key is a bearer credential. It lives in Secret Manager, is mounted as
 *     a secretKeyRef, and never reaches the bundle or the repo — but anyone
 *     holding it can spend the quota, and rotation is manual.
 *   - Free-tier data-handling terms differ from paid/Vertex. Worth confirming
 *     before real users type business financials into it.
 *
 * Vertex remains fully implemented and one env var away: set
 * GEMINI_BACKEND=vertex. Keeping it live-able rather than deleting it, because
 * it is the likely pre-launch destination.
 *
 * There is deliberately no fallback between the two. If the chosen backend is
 * unavailable, the AI route reports itself unavailable and says so loudly.
 * Silently degrading to a second credential is how the Firestore cache spent
 * a day pretending to work.
 */
async function createGeminiTransport(): Promise<GeminiTransport | undefined> {
  const backend = process.env["GEMINI_BACKEND"] ?? "ai-studio";

  if (backend === "vertex") {
    const projectId = await detectProjectId();
    if (!projectId) {
      console.error("[gemini] GEMINI_BACKEND=vertex but no project id. AI route disabled.");
      return undefined;
    }
    const model = process.env["GEMINI_MODEL"] ?? VERTEX_DEFAULT_MODEL;
    const location = process.env["VERTEX_LOCATION"] ?? VERTEX_DEFAULT_LOCATION;
    console.log(`[gemini] Vertex AI via service identity (${location}, ${model}).`);
    return vertexTransport({ projectId, location, model });
  }

  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) {
    console.warn("[gemini] no GEMINI_API_KEY. AI route disabled.");
    return undefined;
  }
  const model = process.env["GEMINI_MODEL"] ?? undefined;
  console.log(`[gemini] AI Studio key (${model ?? "default model"}).`);
  return aiStudioTransport(apiKey, model);
}

const placesKey = process.env["PLACES_API_KEY"];
if (!placesKey) {
  console.warn("[places] PLACES_API_KEY not set. /v1/competitors serves cached results only.");
}

/**
 * Static Maps for PDF reports — the only billable part of a report.
 *
 * Falls back to the Places key: the same server-side key is extended to Static
 * Maps in the console, so a separate secret would be a second copy of one
 * credential. Absent either, reports render without a map and say so.
 */
const staticMapsKey = process.env["STATIC_MAPS_API_KEY"] ?? placesKey;
if (!staticMapsKey) {
  console.warn("[staticmap] no key set. PDF reports will render without a map.");
}
const staticMaps = staticMapsKey ? new StaticMapFetcher({ apiKey: staticMapsKey }) : undefined;

const appCheckProjectNumber = process.env["APP_CHECK_PROJECT_NUMBER"];
if (appCheckProjectNumber) {
  console.log(`[appcheck] enforced on paid routes (project ${appCheckProjectNumber}).`);
} else {
  // Loud, because an unguarded deployment means anyone can spend the Gemini
  // and Places budget by curling the URL.
  console.warn("[appcheck] NOT ENFORCED. Paid routes are open. Expected only in local dev.");
}

/**
 * Static reference data, read from disk once per instance. Failing to load it
 * disables the demographics route but must not take the service down — the
 * simulator and competitor analysis do not depend on it.
 */
async function createDemographics() {
  try {
    const { DemographicsLookup } = await import("./demographics.js");
    const lookup = await DemographicsLookup.load();
    console.log(
      `[demographics] loaded ${lookup.districtCount} districts, ${lookup.vintage} vintage.`,
    );
    return lookup;
  } catch (error) {
    console.error("[demographics] failed to load reference data:", error);
    return undefined;
  }
}

/**
 * The 400m population grid. Like the demographics files it is read from disk
 * once per instance, and failing to load it must not take the service down —
 * the catchment falls back to the district proxy and /health says so.
 */
/**
 * The bundled amenities snapshot. Missing it is not fatal — the route falls
 * through to a live Overpass fetch — but it IS the difference between a
 * reliable page and one that depends on a volunteer service, so /health says.
 */
async function createAmenitiesSeed() {
  try {
    const { AmenitiesSeed } = await import("./amenities/seed.js");
    const seed = await AmenitiesSeed.load();
    console.log(`[amenities] bundled snapshot for ${seed.cityCount} cities, ${seed.vintage}.`);
    return seed;
  } catch (error) {
    console.error("[amenities] no bundled snapshot; falling back to live Overpass:", error);
    return undefined;
  }
}

/**
 * The bundled event catalogue. Missing it is not fatal for the rest of the
 * service, but it does mean /v1/events reports itself unavailable rather than
 * serving an empty list that would look like a filter matching nothing.
 */
async function createEvents() {
  try {
    const { EventCatalogue } = await import("./events/catalogue.js");
    const catalogue = await EventCatalogue.load();
    console.log(`[events] loaded ${catalogue.size} listings, ${catalogue.vintage} vintage.`);
    return catalogue;
  } catch (error) {
    console.error("[events] no bundled catalogue:", error);
    return undefined;
  }
}

async function createPopulation() {
  try {
    const grid = await PopulationGrid.load();
    console.log(`[population] loaded ${grid.hexagonCount} hexagons, ${grid.vintage} vintage.`);
    return grid;
  } catch (error) {
    console.error("[population] failed to load the 400m grid:", error);
    return undefined;
  }
}

const [geminiTransport, stores, demographics, population, amenitiesSeed, events] =
  await Promise.all([
    createGeminiTransport(),
    createStores(),
    createDemographics(),
    createPopulation(),
    createAmenitiesSeed(),
    createEvents(),
  ]);

const { competitorStore, listingsStore, amenitiesStore, applicationStore, briefingStore } = stores;

/**
 * The Firebase project, used to verify ID tokens on the apply route.
 *
 * Same value the browser signs in against. Absent means applications report
 * themselves unavailable rather than accepting an unauthenticated write.
 */
const firebaseProjectId =
  process.env["FIREBASE_PROJECT_ID"] ??
  process.env["GOOGLE_CLOUD_PROJECT"] ??
  (onCloudRun ? "spotential-app" : undefined);

const app = buildApp({
  allowedOrigins: process.env["ALLOWED_ORIGINS"],
  logger: true,
  gemini: geminiTransport ? { transport: geminiTransport } : undefined,
  places: placesKey ? { apiKey: placesKey } : undefined,
  competitorStore,
  demographics,
  staticMaps,
  population,
  listingsStore,
  briefingStore,
  // The real network call. Kept out of buildApp so tests never touch a third
  // party, and so an unconfigured deployment reports "none" instead of
  // quietly reaching out to PropertyGuru from a test run.
  listingsFetcher: (area: string) => fetchListings(area),
  amenitiesStore,
  amenitiesFetcher: (bounds) => fetchAmenities(bounds),
  amenitiesSeed,
  events,
  /**
   * Real accounts, for applications only.
   *
   * Verified with `jose` against Google's public keys — no firebase-admin, so
   * no second gRPC stack and no second Firestore client. Absent means applying
   * is refused outright rather than falling back to something ungated.
   */
  auth: firebaseProjectId ? { projectId: firebaseProjectId } : undefined,
  applicationStore,
  // Gates the routes that cost money. Absent only in local development and
  // tests; production always sets APP_CHECK_PROJECT_NUMBER.
  appCheck: appCheckProjectNumber
    ? {
        projectNumber: appCheckProjectNumber,
        ...(process.env["SMOKE_KEY"] ? { smokeKey: process.env["SMOKE_KEY"] } : {}),
      }
    : undefined,
  // Surfaced on /health so a silent downgrade shows up as a failed assertion
  // rather than as a line on next month's bill.
  backends: {
    gemini: geminiTransport?.name ?? "none",
    geminiModel: geminiTransport?.model ?? null,
    competitorCache: competitorStore ? "firestore" : "in-memory",
    places: placesKey ? "configured" : "none",
    demographics: demographics ? `districts:${demographics.districtCount}` : "none",
    appCheck: appCheckProjectNumber ? "enforced" : "off",
    staticMaps: staticMaps ? "configured" : "none",
    population: population ? `hexagons:${population.hexagonCount}` : "none",
    listingsCache: listingsStore ? "firestore" : "in-memory",
    briefCache: briefingStore ? "firestore" : "in-memory",
    listings: "propertyguru",
    amenitiesCache: amenitiesStore ? "firestore" : "in-memory",
    amenities: "overpass",
    amenitiesSeed: amenitiesSeed ? `cities:${amenitiesSeed.cityCount}` : "none",
    events: events ? `seed:${events.size}` : "none",
    auth: firebaseProjectId ? "firebase" : "off",
    applications: applicationStore ? "firestore" : "in-memory",
  },
});

/**
 * Pick the cache backend for both caches, off ONE Firestore client.
 *
 * K_SERVICE is the marker Cloud Run sets. Gating on GOOGLE_CLOUD_PROJECT
 * silently sent production to the in-memory store, which re-billed Places on
 * every cold start while still reporting cache hits within its own warm
 * instance. That is why the choice is now reported on /health.
 *
 * The listings cache shares this client rather than constructing a second:
 * two Firestore instances means two gRPC channels and two credential
 * resolutions for no benefit, and it would double the ways this can silently
 * downgrade. They succeed or fail together, which is also easier to assert.
 */
async function createStores() {
  const explicitProject =
    process.env["GOOGLE_CLOUD_PROJECT"] ?? process.env["FIRESTORE_PROJECT_ID"];

  if (!onCloudRun && !explicitProject) {
    console.warn("[cache] not on Cloud Run and no project set. Using in-memory caches.");
    return {};
  }

  try {
    const { Firestore } = await import("@google-cloud/firestore");
    const { FirestoreCompetitorStore } = await import("./competitors/store.js");
    const { FirestoreListingsStore } = await import("./properties/store.js");
    const { FirestoreAmenitiesStore } = await import("./amenities/store.js");
    const { FirestoreApplicationStore } = await import("./events/store.js");
    const { FirestoreBriefingStore } = await import("./chat/store.js");
    const firestore = new Firestore(explicitProject ? { projectId: explicitProject } : {});
    // Do NOT read firestore.projectId here: it throws "Client is not yet ready
    // to issue requests" until credentials resolve, and the catch below would
    // swallow that into a silent in-memory fallback. The logging meant to
    // expose failures caused one.
    console.log("[cache] competitor, listings, amenities and briefing caches backed by Firestore.");
    return {
      competitorStore: new FirestoreCompetitorStore(firestore as never),
      listingsStore: new FirestoreListingsStore(firestore as never),
      amenitiesStore: new FirestoreAmenitiesStore(firestore as never),
      briefingStore: new FirestoreBriefingStore(firestore as never),
      // Not a cache. See the note in app.ts on why there is no in-memory
      // fallback for this one.
      applicationStore: new FirestoreApplicationStore(firestore as never),
    };
  } catch (error) {
    console.error("[cache] Firestore unavailable, falling back to in-memory:", error);
    return {};
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    app.log.info(`${signal} received, closing`);
    void app.close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
