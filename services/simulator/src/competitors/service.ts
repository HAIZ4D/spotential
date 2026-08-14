import {
  bucketRadius,
  densityByBand,
  isTruncated,
  summarise,
  withDistance,
  type BusinessCategory,
  type Competitor,
  type CompetitorSummary,
  type CompetitorWithDistance,
  type DensityBand,
  type LatLng,
} from "@spotential/sim-engine";
import { cacheKey, type CompetitorStore } from "./store.js";

/**
 * Cache-first competitor lookup.
 *
 * The Places call is the last resort, not the first step: check the cache,
 * and only pay if it misses. The `fetchPlaces` dependency is injected so the
 * whole flow is testable without spending money or needing a network.
 */

export interface CompetitorResult {
  competitors: CompetitorWithDistance[];
  summary: CompetitorSummary;
  density: DensityBand[];
  fromCache: boolean;
  fetchedAt: number;
  radiusMetres: number;
  /** Places hit its 20-result cap, so this is the nearest 20 and not all of them. */
  truncated: boolean;
  /**
   * How far out the result set is actually complete.
   *
   * Without this, a truncated search looks like a finding rather than a limit:
   * "0 competitors between 250m and 500m" reads as an opportunity when in
   * reality we never looked past 114m. Null when nothing was truncated.
   */
  completeToMetres: number | null;
}

export type FetchPlaces = (
  centre: LatLng,
  radiusMetres: number,
  category: BusinessCategory,
) => Promise<Competitor[]>;

export async function findCompetitors(
  store: CompetitorStore,
  fetchPlaces: FetchPlaces,
  centre: LatLng,
  requestedRadius: number,
  category: BusinessCategory,
  options: { allowFetch?: boolean } = {},
): Promise<CompetitorResult> {
  // Search at the bucketed radius, not the requested one. Two searches at
  // 480m and 500m then share a cache entry instead of billing twice; the
  // exact requested radius is applied when filtering below.
  const searchRadius = bucketRadius(requestedRadius);

  const cached = await store.find(centre, searchRadius, category);
  if (cached) {
    return assemble(cached.competitors, centre, requestedRadius, true, cached.fetchedAt);
  }

  // The caller can refuse to spend — used when the daily uncached-call ceiling
  // has been hit. Better an empty result labelled as such than a surprise bill.
  if (options.allowFetch === false) {
    return assemble([], centre, requestedRadius, false, Date.now());
  }

  const competitors = await fetchPlaces(centre, searchRadius, category);
  const fetchedAt = Date.now();

  await store.save({
    key: cacheKey(centre, searchRadius, category),
    centre,
    radiusMetres: searchRadius,
    category,
    competitors,
    fetchedAt,
    // Recorded so a later, narrower request knows whether this set can be
    // safely reused or whether it stops short of the radius being asked for.
    truncated: isTruncated(competitors),
  });

  return assemble(competitors, centre, requestedRadius, false, fetchedAt);
}

function assemble(
  competitors: Competitor[],
  centre: LatLng,
  radiusMetres: number,
  fromCache: boolean,
  fetchedAt: number,
): CompetitorResult {
  const all = withDistance(competitors, centre);
  const inRange = all.filter((c) => c.distanceMetres <= radiusMetres);

  // Measured against the FULL fetched set, not the filtered one: the cap was
  // applied by Places before we narrowed anything.
  const truncated = isTruncated(competitors);
  const farthest = all[all.length - 1]?.distanceMetres ?? null;

  return {
    competitors: inRange,
    summary: summarise(inRange),
    density: densityByBand(inRange),
    fromCache,
    fetchedAt,
    radiusMetres,
    truncated,
    completeToMetres: truncated ? farthest : null,
  };
}
