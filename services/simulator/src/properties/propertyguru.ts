/**
 * Retail listings from PropertyGuru — the Rent tab's "Available properties".
 *
 * WHY THIS EXISTS AND WHERE THE LINE IS.
 *
 * The previous version of this feature linked out rather than fetching, and
 * the reasoning is still on the record. It was reversed deliberately, with the
 * boundary moved rather than removed:
 *
 *   PropertyGuru  — their robots.txt enumerates disallowed paths and
 *                   /retail-shops-for-rent is NOT among them, so this path is
 *                   crawl-permitted. Their Terms of Service still prohibit
 *                   data mining, which is a business-risk decision the product
 *                   owner made knowingly. They can block us, and the listing
 *                   photos belong to the agents.
 *
 *   Mudah         — NOT fetched, and this is not an oversight. Their
 *                   robots.txt opens, before any rule, with:
 *                     "It is expressly forbidden to use spiders or other
 *                      automated methods to access mudah.my."
 *                   That is a refusal of automated access stated in the file
 *                   that exists to state exactly that. Mudah stays a link.
 *
 * HOW WE BEHAVE. We identify ourselves honestly (see USER_AGENT) rather than
 * impersonating a browser, so PropertyGuru can block us on purpose if they
 * choose to; results are cached for a day, so a given area is fetched at most
 * once in that window; and we copy facts, a thumbnail URL and a link back —
 * never the listing prose, the photo carousel, or agent contact details.
 */

/**
 * Honest identification, with a contact URL. Verified to return 200.
 *
 * A plain `curl/8.0` is refused with a 403, so SOMETHING has to be sent — but
 * that does not mean it has to be a lie. This was tested against the real site
 * before being chosen: they accept a self-described bot, so there is no reason
 * to pretend to be Chrome.
 */
export const USER_AGENT = "SpotentialBot/1.0 (+https://spotential-app.web.app)";

/** Enough for a slow page; short enough that the Rent tab never hangs on it. */
export const FETCH_TIMEOUT_MS = 8_000;

/** PropertyGuru returns 20 per page; the panel shows a handful. */
export const MAX_LISTINGS = 6;

export interface PropertyListing {
  id: string;
  /** Canonical listing page. Every card links here. */
  url: string;
  title: string;
  address: string;
  /** RM per month. Null when the listing quotes something unparseable. */
  monthlyRent: number | null;
  rentLabel: string;
  /** "RM 7.00 psf" — their own figure, not ours, and not always present. */
  psfLabel: string | null;
  floorSqft: number | null;
  sizeLabel: string | null;
  /** "Retail Space", "Shop House" — as PropertyGuru classifies it. */
  propertyType: string | null;
  thumbnailUrl: string | null;
  postedLabel: string | null;
  /** "4 min (330 m) from Persiaran KLCC". A genuine differentiator for retail. */
  transitLabel: string | null;
}

/**
 * The search URL.
 *
 * The PATH form, not `property-for-rent?...&property_type=C`. That one looks
 * equivalent and is not: PropertyGuru 301s it and rewrites the parameter to
 * `isCommercial=false` — the inverse of what was asked — returning residential
 * rentals. Caught only by reading url_effective after following the redirect.
 * If this ever changes, re-check it the same way.
 */
export function searchUrl(area: string): string {
  return `https://www.propertyguru.com.my/retail-shops-for-rent?freetext=${encodeURIComponent(area)}`;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Pull one listing out of PropertyGuru's card payload.
 *
 * Every field is optional on purpose. This is someone else's undocumented
 * internal shape; the correct response to a missing field is a card with one
 * less line on it, never a thrown error that takes out the panel.
 */
function toListing(raw: unknown): PropertyListing | null {
  const ld = asRecord(raw);
  if (!ld) return null;

  const id = num(ld.id) ?? text(ld.externalId);
  const url = text(ld.url);
  if (id === null || !url) return null;

  const price = asRecord(ld.price);
  const area = asRecord(ld.area);
  const mrt = asRecord(ld.mrt);
  const postedOn = asRecord(ld.postedOn);
  const property = asRecord(ld.property);

  // Their badge is the friendliest label ("Retail Space"); subTypeText is the
  // same string by another route, and is the fallback when badges are absent.
  const badges = Array.isArray(ld.badges) ? ld.badges : [];
  const unitBadge = badges.map(asRecord).find((b) => b && text(b.text));
  const propertyType =
    (unitBadge ? text(unitBadge.text) : null) ?? (property ? text(property.subTypeText) : null);

  return {
    id: String(id),
    url,
    title: text(ld.localizedTitle) ?? text(ld.shortAddress) ?? "Retail unit",
    address: text(ld.shortAddress) ?? text(ld.fullAddress) ?? "",
    monthlyRent: price ? num(price.value) : null,
    rentLabel: (price ? text(price.pretty) : null) ?? "Price on request",
    psfLabel: text(ld.psfText),
    floorSqft: num(ld.floorArea),
    sizeLabel: area ? text(area.localeStringValue) : null,
    propertyType,
    thumbnailUrl: text(ld.thumbnail),
    postedLabel: postedOn ? text(postedOn.text) : null,
    transitLabel: mrt ? text(mrt.nearbyText) : null,
  };
}

/**
 * Extract listings from a search page.
 *
 * PropertyGuru is a Next.js app, so the cards are already structured JSON in
 * `__NEXT_DATA__` — there is no HTML to scrape and no markup to break. What
 * CAN change is the shape of that JSON, so every step here is defensive and
 * the failure mode is an empty array. The panel falls back to plain links, and
 * a fixture test plus a deployed smoke check are what actually notice.
 */
export function parseListings(html: string, limit = MAX_LISTINGS): PropertyListing[] {
  const match = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!match?.[1]) return [];

  let data: unknown;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return [];
  }

  const pageData = asRecord(data)?.props;
  const listings = asRecord(asRecord(asRecord(asRecord(pageData)?.pageProps)?.pageData)?.data)
    ?.listingsData;
  if (!Array.isArray(listings)) return [];

  const parsed: PropertyListing[] = [];
  for (const entry of listings) {
    if (parsed.length >= limit) break;
    const listing = toListing(asRecord(entry)?.listingData);
    if (listing) parsed.push(listing);
  }
  return parsed;
}

export type Fetcher = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface FetchOutcome {
  listings: PropertyListing[];
  /** False when we could not reach or read the source at all. */
  available: boolean;
  reason: string | null;
}

/**
 * Fetch and parse one area's listings.
 *
 * Never throws. The Rent tab works without this, so a portal being slow, down,
 * blocking our IP, or having changed its payload must all degrade to the same
 * quiet fallback rather than an error state on a panel about rent.
 */
export async function fetchListings(
  area: string,
  limit = MAX_LISTINGS,
  fetcher: Fetcher = globalThis.fetch as unknown as Fetcher,
): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetcher(searchUrl(area), {
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-MY,en;q=0.9",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      // 403 here most likely means their bot protection refused our
      // datacentre IP, which is their prerogative and not a bug to route
      // around. Reported, not retried.
      return { listings: [], available: false, reason: `http_${response.status}` };
    }

    const listings = parseListings(await response.text(), limit);
    return {
      listings,
      available: true,
      reason: listings.length === 0 ? "no_listings" : null,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { listings: [], available: false, reason: aborted ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
