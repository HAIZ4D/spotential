import type { BusinessCategory } from "./types.js";
import { distanceMetres, type LatLng } from "./geo.js";

/**
 * Competitor shapes and the pure analysis over them — Feature 1b.
 *
 * Deliberately in the engine: Opportunity Gap Detection and the 1d scoring
 * engine both consume these counts, and neither should re-derive them from
 * raw Places responses.
 */

export interface Competitor {
  /** Places resource id. Stable, so it doubles as the cache dedupe key. */
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Places omits rating entirely for places nobody has reviewed. */
  rating: number | null;
  reviewCount: number;
  primaryType: string | null;
  priceLevel: string | null;
  businessStatus: string | null;
}

export interface CompetitorWithDistance extends Competitor {
  distanceMetres: number;
}

/** Bands for the competition-density breakdown. */
export const DENSITY_BANDS = [250, 500, 1000] as const;

/**
 * Places returns at most 20 results per search, ranked by distance.
 *
 * This matters for cache reuse. A wider cached search is normally a superset
 * of a narrower one, so a 1km result can serve a 250m request for free — but
 * only if it was NOT truncated. A truncated search stops at some distance D,
 * and any request for a radius beyond D would silently under-report.
 */
export const PLACES_MAX_RESULTS = 20;

export function isTruncated(competitors: Competitor[]): boolean {
  return competitors.length >= PLACES_MAX_RESULTS;
}

/**
 * Places `includedTypes` per business category.
 *
 * These are Places API (New) Table A type names, which are NOT free-form — an
 * unrecognised one is rejected by the API rather than ignored, so a typo here
 * surfaces as a failed search rather than a quiet miss. The deployed smoke
 * check exercises one type from each sector for that reason.
 */
export const CATEGORY_PLACE_TYPES: Record<BusinessCategory, string[]> = {
  // Food and beverage
  korean_restaurant: ["korean_restaurant", "restaurant"],
  cafe_coffee_shop: ["cafe", "coffee_shop", "bakery"],
  casual_dining: ["restaurant", "meal_takeaway"],
  bubble_tea_dessert: ["cafe", "dessert_shop", "juice_shop"],
  fast_casual_takeaway: ["meal_takeaway", "fast_food_restaurant"],
  other_fnb: ["restaurant", "cafe"],

  // Retail
  clothing_fashion: ["clothing_store", "shoe_store"],
  convenience_store: ["convenience_store"],
  pharmacy_health: ["pharmacy", "drugstore"],
  phone_electronics: ["cell_phone_store", "electronics_store"],
  other_retail: ["store"],

  // Services
  salon_barber: ["hair_salon", "barber_shop", "beauty_salon"],
  laundry: ["laundry"],
  fitness_studio: ["gym", "fitness_center"],
  other_services: ["store"],
};

export function withDistance(
  competitors: Competitor[],
  centre: LatLng,
): CompetitorWithDistance[] {
  return competitors
    .map((c) => ({ ...c, distanceMetres: distanceMetres(centre, { lat: c.lat, lng: c.lng }) }))
    .sort((a, b) => a.distanceMetres - b.distanceMetres);
}

/** In-memory radius filter — the operation PostGIS will eventually take over. */
export function withinRadius(
  competitors: Competitor[],
  centre: LatLng,
  radiusMetres: number,
): CompetitorWithDistance[] {
  return withDistance(competitors, centre).filter((c) => c.distanceMetres <= radiusMetres);
}

export interface DensityBand {
  /** Upper bound of the band in metres. */
  upToMetres: number;
  count: number;
}

/** Counts per band. Bands are cumulative-exclusive: 0-250, 250-500, 500-1000. */
export function densityByBand(competitors: CompetitorWithDistance[]): DensityBand[] {
  let lower = 0;
  return DENSITY_BANDS.map((upToMetres) => {
    const count = competitors.filter(
      (c) => c.distanceMetres > lower && c.distanceMetres <= upToMetres,
    ).length;
    lower = upToMetres;
    return { upToMetres, count };
  });
}

export interface CompetitorSummary {
  total: number;
  /** Null when nobody in range has been rated — not zero, which reads as "terrible". */
  averageRating: number | null;
  ratedCount: number;
  totalReviews: number;
  nearestMetres: number | null;
  operational: number;
}

export function summarise(competitors: CompetitorWithDistance[]): CompetitorSummary {
  const rated = competitors.filter((c) => typeof c.rating === "number");
  const sumRatings = rated.reduce((acc, c) => acc + (c.rating ?? 0), 0);

  return {
    total: competitors.length,
    averageRating:
      rated.length > 0 ? Math.round((sumRatings / rated.length) * 100) / 100 : null,
    ratedCount: rated.length,
    totalReviews: competitors.reduce((acc, c) => acc + c.reviewCount, 0),
    nearestMetres: competitors[0]?.distanceMetres ?? null,
    operational: competitors.filter((c) => c.businessStatus !== "CLOSED_PERMANENTLY").length,
  };
}
