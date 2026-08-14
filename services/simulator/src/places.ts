import {
  CATEGORY_PLACE_TYPES,
  type BusinessCategory,
  type Competitor,
  type LatLng,
} from "@spotential/sim-engine";

/**
 * Places API (New) client — Feature 1b.
 *
 * Server-side only. The browser never calls Places: it is the expensive API,
 * results are worth sharing between users, and the competitor data has to be
 * stored anyway for Opportunity Gap Detection later.
 *
 * COST IS A DESIGN CONSTRAINT HERE. The New API bills by tier according to
 * which fields the mask requests, so the mask below is deliberately minimal —
 * enough for the list, the scatter and the gap detection, and nothing from the
 * expensive tiers. Adding a field to this string costs money on every call;
 * treat it as a budget line, not a convenience.
 */

const ENDPOINT = "https://places.googleapis.com/v1/places:searchNearby";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.primaryType",
  "places.priceLevel",
  "places.businessStatus",
].join(",");

/** Places caps this at 20; asking for more is silently ignored. */
const MAX_RESULTS = 20;

export interface PlacesConfig {
  apiKey: string;
  timeoutMs?: number;
}

interface PlacesResponse {
  places?: {
    id?: string;
    displayName?: { text?: string };
    location?: { latitude?: number; longitude?: number };
    rating?: number;
    userRatingCount?: number;
    primaryType?: string;
    priceLevel?: string;
    businessStatus?: string;
  }[];
}

export async function searchNearby(
  config: PlacesConfig,
  centre: LatLng,
  radiusMetres: number,
  category: BusinessCategory,
): Promise<Competitor[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 15_000);

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": config.apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      signal: controller.signal,
      body: JSON.stringify({
        includedTypes: CATEGORY_PLACE_TYPES[category],
        maxResultCount: MAX_RESULTS,
        locationRestriction: {
          circle: {
            center: { latitude: centre.lat, longitude: centre.lng },
            radius: radiusMetres,
          },
        },
        rankPreference: "DISTANCE",
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      // Never let an upstream error body carry the key into our logs.
      throw new Error(
        `Places responded ${response.status}: ${detail.slice(0, 200).replace(config.apiKey, "[REDACTED]")}`,
      );
    }

    const json = (await response.json()) as PlacesResponse;
    return (json.places ?? []).flatMap(toCompetitor);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Places omits fields rather than nulling them — a place nobody has reviewed
 * has no `rating` key at all. Normalise here so the rest of the system never
 * has to think about it, and drop anything without coordinates since it cannot
 * be placed on a map or measured.
 */
function toCompetitor(place: NonNullable<PlacesResponse["places"]>[number]): Competitor[] {
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  if (typeof lat !== "number" || typeof lng !== "number" || !place.id) return [];

  return [
    {
      id: place.id,
      name: place.displayName?.text ?? "Unnamed",
      lat,
      lng,
      rating: typeof place.rating === "number" ? place.rating : null,
      reviewCount: place.userRatingCount ?? 0,
      primaryType: place.primaryType ?? null,
      priceLevel: place.priceLevel ?? null,
      businessStatus: place.businessStatus ?? null,
    },
  ];
}
