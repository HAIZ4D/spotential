import {
  CATEGORY_PRESETS,
  analyseOpportunity,
  type BusinessCategory,
  type BusinessSector,
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
  /** Which sector was compared. Shown on the panel so the scope is visible. */
  sector: BusinessSector;
  fetchedAt: number;
}

/**
 * SCOPED TO ONE SECTOR, and this is a cost decision as much as a product one.
 *
 * Every category searched is one Places call, and Places is on the Enterprise
 * SKU: $35/1,000 with 1,000 free a month. Searching all fifteen categories
 * would cut free gap analyses from about 166 a month to 66 and take the cost
 * of each one beyond that from roughly RM 0.99 to RM 2.47 — against a MYR 45
 * budget that is already the binding constraint on this project.
 *
 * It is also the better ranking. A Korean restaurant competes with other
 * F&B for the same lunch spend; it does not compete with a barbershop, and
 * putting the two in one league table was never meaningful.
 */
export function categoriesFor(sector: BusinessSector): BusinessCategory[] {
  return (Object.keys(CATEGORY_PRESETS) as BusinessCategory[]).filter(
    (id) => CATEGORY_PRESETS[id].sector === sector,
  );
}

export async function detectGaps(
  store: CompetitorStore,
  fetchPlaces: FetchPlaces,
  centre: LatLng,
  radiusMetres: number,
  options: { allowFetch?: boolean; sector?: BusinessSector } = {},
): Promise<GapResult> {
  const supplies: CategorySupply[] = [];
  let categoriesFetched = 0;

  const sector = options.sector ?? "fnb";
  const categories = categoriesFor(sector);

  // Sequential, not parallel. Concurrent Places calls would race past the
  // spend ceiling before any of them recorded against it, and the cache reads
  // are fast enough that the latency saving is not worth that.
  for (const category of categories) {
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
    sector,
    fromCache: categoriesFetched === 0,
    categoriesFetched,
    fetchedAt: Date.now(),
  };
}
