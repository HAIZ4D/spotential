import type { BusinessCategory } from "./types.js";
import { PLACES_MAX_RESULTS, type CompetitorWithDistance } from "./competitors.js";
import { CATEGORY_PRESETS } from "./presets/categories.js";
import { r2, r4 } from "./basis.js";

/**
 * Opportunity Gap Detection — supply against demand, per category.
 *
 * THE HONEST PROBLEM: there is no demand data yet. Feature 1c brings DOSM
 * demographics; until then the only demand signal available is review volume,
 * and it is treated as the proxy it is.
 *
 * The metric is REVIEWS PER OUTLET. Many outlets each with few reviews means
 * the trade is thinly spread — saturated. Few outlets each carrying heavy
 * review counts means the existing operators are busy, so demand is outrunning
 * supply. That ratio is the closest defensible thing to demand in the data we
 * hold.
 *
 * Everything is scored RELATIVE to the other categories at this same point.
 * The claim is "underserved compared with what else trades on this street",
 * which the data supports. "Underserved in Malaysia" would not be.
 */

export type GapVerdict = "underserved" | "balanced" | "saturated" | "no-presence";

export interface CategorySupply {
  category: BusinessCategory;
  competitors: CompetitorWithDistance[];
  /** Places capped this category's search — the true count is higher. */
  truncated: boolean;
}

export interface CategoryGap {
  category: BusinessCategory;
  label: string;
  outlets: number;
  /** True when `outlets` is a floor, not an exact count. Render as "20+". */
  outletsAreMinimum: boolean;
  totalReviews: number;
  averageRating: number | null;
  /** The demand proxy. Null when there is nothing to divide by. */
  reviewsPerOutlet: number | null;
  demandIndex: number;
  saturationIndex: number;
  /** 0..1. Only meaningful for categories that actually have a presence. */
  gapScore: number;
  verdict: GapVerdict;
}

export interface OpportunityAnalysis {
  /** Categories with a presence, best opportunity first. */
  ranked: CategoryGap[];
  /**
   * Categories with zero outlets, kept OUT of the ranking.
   *
   * Zero competitors is not an opportunity signal: it could mean untapped
   * demand, or that nobody here wants it, and this data cannot tell the two
   * apart. Ranking them top would be the most dangerous false positive in the
   * feature — an SME could sign a lease on the absence of evidence.
   */
  noPresence: CategoryGap[];
  /** The single best-supported opportunity, or null when nothing qualifies. */
  topOpportunity: CategoryGap | null;
}

/** Above this share of the best gap score, a category reads as underserved. */
const UNDERSERVED_AT = 0.66;

/**
 * Outlets before a category counts as crowded, in ABSOLUTE terms.
 *
 * Deliberately not the relative saturationIndex. That is normalised against
 * the densest category present, so whichever category has the most outlets
 * always scores 1 — which would brand a category "saturated" for having five
 * outlets when the only other one has four. Crowding is a property of the
 * street, not of the comparison set.
 *
 * Known simplification: this does not scale with the search radius. Ten
 * outlets within 250m is far denser than ten within 2km. Most searches run at
 * the 500m default, where ten is a reasonable line.
 */
const SATURATED_OUTLETS = 10;

function normalise(value: number, max: number): number {
  return max > 0 ? value / max : 0;
}

export function analyseOpportunity(supplies: CategorySupply[]): OpportunityAnalysis {
  const rows = supplies.map((supply) => {
    const outlets = supply.competitors.length;
    const totalReviews = supply.competitors.reduce((acc, c) => acc + c.reviewCount, 0);
    const rated = supply.competitors.filter((c) => typeof c.rating === "number");

    return {
      category: supply.category,
      label: CATEGORY_PRESETS[supply.category].label,
      outlets,
      // A capped search means "at least 20", never exactly 20. Comparing a
      // capped category against one with a genuine 3 as though both were exact
      // would understate how crowded the first really is.
      outletsAreMinimum: supply.truncated || outlets >= PLACES_MAX_RESULTS,
      totalReviews,
      averageRating:
        rated.length > 0
          ? r2(rated.reduce((acc, c) => acc + (c.rating ?? 0), 0) / rated.length)
          : null,
      reviewsPerOutlet: outlets > 0 ? r2(totalReviews / outlets) : null,
    };
  });

  const present = rows.filter((r) => r.outlets > 0);
  const maxReviewsPerOutlet = Math.max(...present.map((r) => r.reviewsPerOutlet ?? 0), 0);
  const maxOutlets = Math.max(...present.map((r) => r.outlets), 0);

  /**
   * The opportunity ratio: demand per outlet, divided again by how many
   * outlets there are. Busy trade spread over few operators scores high.
   *
   * An earlier formulation multiplied demand by (1 − saturation) with
   * saturation normalised against the busiest category. That looked
   * reasonable and was badly wrong: the category with the most outlets always
   * had saturation exactly 1, so it always scored exactly 0 — a category with
   * five outlets averaging 1,000 reviews each would rank BELOW one with four
   * outlets averaging ten. The ratio has no such artefact.
   */
  const ratioOf = (row: (typeof rows)[number]): number =>
    row.outlets > 0 ? (row.reviewsPerOutlet ?? 0) / row.outlets : 0;

  // A capped category's real outlet count is unknown and higher, so it is
  // treated as saturated outright rather than scored on a floor of 20.
  const maxRatio = Math.max(...present.filter((r) => !r.outletsAreMinimum).map(ratioOf), 0);

  const scored: CategoryGap[] = rows.map((row) => {
    if (row.outlets === 0) {
      return {
        ...row,
        demandIndex: 0,
        saturationIndex: 0,
        gapScore: 0,
        verdict: "no-presence" as const,
      };
    }

    const demandIndex = r4(normalise(row.reviewsPerOutlet ?? 0, maxReviewsPerOutlet));
    const saturationIndex = row.outletsAreMinimum ? 1 : r4(normalise(row.outlets, maxOutlets));
    const gapScore = row.outletsAreMinimum ? 0 : r4(normalise(ratioOf(row), maxRatio));

    return { ...row, demandIndex, saturationIndex, gapScore, verdict: "balanced" as const };
  });

  const withPresence = scored.filter((r) => r.verdict !== "no-presence");
  const bestScore = Math.max(...withPresence.map((r) => r.gapScore), 0);

  for (const row of withPresence) {
    if (row.outletsAreMinimum || row.outlets >= SATURATED_OUTLETS) {
      row.verdict = "saturated";
    } else if (bestScore > 0 && row.gapScore >= bestScore * UNDERSERVED_AT) {
      row.verdict = "underserved";
    }
  }

  const ranked = [...withPresence].sort((a, b) => b.gapScore - a.gapScore);
  const noPresence = scored.filter((r) => r.verdict === "no-presence");

  const best = ranked[0];

  return {
    ranked,
    noPresence,
    /**
     * "Nothing here stands out" is a legitimate answer and a far better one
     * than crowning a loser. Three ways to get null:
     *
     *  - no category has any presence at all
     *  - the best score is zero, so nothing separates them
     *  - the best candidate is itself SATURATED, which happens in dense city
     *    centres where every category is crowded. Recommending the least
     *    crowded of six crowded categories, while the panel labels it
     *    "saturated", is a contradiction an SME could act on.
     */
    topOpportunity:
      best && best.gapScore > 0 && best.verdict !== "saturated" ? best : null,
  };
}
