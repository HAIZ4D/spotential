import {
  CATEGORY_PRESETS,
  analyseOpportunity,
  type BusinessCategory,
  type CategorySupply,
  type LatLng,
  type OpportunityAnalysis,
} from "@spotential/sim-engine";
import { findCompetitors, type FetchPlaces } from "./service.js";
import type { CompetitorStore } from "./store.js";

/**
 * Opportunity Gap Detection — one search per category, all through the same
 * Firestore cache 1b already built.
 *
 * A genuinely new area costs six Places calls. Every look after that, and
 * every click within ~110m, costs nothing: the cache key rounds coordinates
 * and buckets radii, so the six documents are shared across the whole
 * neighbourhood.
 */

export interface GapResult extends OpportunityAnalysis {
  radiusMetres: number;
  /** True only when EVERY category came from cache — i.e. nothing was billed. */
  fromCache: boolean;
  /** How many categories needed a live Places call. Zero is the good case. */
  categoriesFetched: number;
  fetchedAt: number;
}

const ALL_CATEGORIES = Object.keys(CATEGORY_PRESETS) as BusinessCategory[];

export async function detectGaps(
  store: CompetitorStore,
  fetchPlaces: FetchPlaces,
  centre: LatLng,
  radiusMetres: number,
  options: { allowFetch?: boolean } = {},
): Promise<GapResult> {
  const supplies: CategorySupply[] = [];
  let categoriesFetched = 0;

  // Sequential, not parallel. Six concurrent Places calls would race past the
  // spend ceiling before any of them recorded against it, and the cache reads
  // are fast enough that the latency saving is not worth that.
  for (const category of ALL_CATEGORIES) {
    const result = await findCompetitors(
      store,
      fetchPlaces,
      centre,
      radiusMetres,
      category,
      options,
    );
    if (!result.fromCache) categoriesFetched += 1;

    supplies.push({
      category,
      competitors: result.competitors,
      // Carried through so a capped category is scored as "at least 20" and
      // never compared as an exact figure against a genuine handful.
      truncated: result.truncated,
    });
  }

  return {
    ...analyseOpportunity(supplies),
    radiusMetres,
    fromCache: categoriesFetched === 0,
    categoriesFetched,
    fetchedAt: Date.now(),
  };
}
