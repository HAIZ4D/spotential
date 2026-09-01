/**
 * Available properties — the spec's "Rent location → Available properties".
 *
 * TWO LAYERS, AND THEY ARE NOT INTERCHANGEABLE.
 *
 *   1. Real PropertyGuru units, fetched server-side and cached for a day.
 *      Their robots.txt permits /retail-shops-for-rent; their Terms prohibit
 *      data mining, which the product owner accepted knowingly. See
 *      services/simulator/src/properties/propertyguru.ts for what is and is
 *      not copied, and why we identify ourselves rather than posing as a
 *      browser.
 *
 *   2. Portal links, which never go away. They are the fallback when the
 *      fetch fails — and it can, since PropertyGuru may block a datacentre IP
 *      at any time — and the "see everything" route when it succeeds, because
 *      six cards are never the whole market.
 *
 * Mudah stays link-only, deliberately. Its robots.txt opens with "It is
 * expressly forbidden to use spiders or other automated methods to access
 * mudah.my", which is a refusal stated in the file that exists to state it.
 *
 * Everything here is an ASKING price and none of it reaches the Success
 * Score; the rent dimension keeps using the dated, sourced benchmark.
 */

import type { PropertyListing } from "../../lib/api.js";
import { PropertyCard } from "./PropertyCard.js";

/**
 * The benchmark labels are written for a human ("Jalan TAR / Dang Wangi, KL"),
 * not for a search box. Measured against PropertyGuru:
 *
 *   "Jalan TAR / Dang Wangi, KL"  ->   111 listing cards
 *   "Jalan TAR"                   -> 1,064 listing cards
 *
 * The slash and the city suffix both narrow the match badly, so the query uses
 * the first place named and drops the trailing city. The label shown on screen
 * stays the full one.
 */
export function searchTerm(area: string): string {
  return (area.split("/")[0] ?? area)
    .replace(/,\s*(KL|PJ|Penang|Selangor|Johor|Kuala Lumpur)\s*$/i, "")
    .trim();
}

/**
 * DOSM state name -> Mudah region slug.
 *
 * Every one of the sixteen was fetched, not guessed. All returned 200 with the
 * region preserved through their redirect, and real ad counts spanning the
 * range you would expect of the actual property market: 2 in Perlis, 6 in
 * Sarawak, 48 in Sabah, and the 80-per-page cap in KL, Selangor, Johor and
 * Penang. A slug Mudah did not recognise would have fallen back to national
 * results, which is the silent-wrong-answer case this table exists to prevent.
 *
 * Only two differ from a plain lower-case-and-hyphenate: DOSM writes the
 * federal territories "W.P. …", and Penang by its Malay name.
 */
export const MUDAH_REGIONS: Record<string, string> = {
  Johor: "johor",
  Kedah: "kedah",
  Kelantan: "kelantan",
  Melaka: "melaka",
  "Negeri Sembilan": "negeri-sembilan",
  Pahang: "pahang",
  Perak: "perak",
  Perlis: "perlis",
  "Pulau Pinang": "penang",
  Sabah: "sabah",
  Sarawak: "sarawak",
  Selangor: "selangor",
  Terengganu: "terengganu",
  "W.P. Kuala Lumpur": "kuala-lumpur",
  "W.P. Labuan": "labuan",
  "W.P. Putrajaya": "putrajaya",
};

/** "W.P. Kuala Lumpur" is how DOSM writes it, not how anyone says it. */
export function stateLabel(state: string): string {
  return state.replace(/^W\.P\.\s*/, "");
}

export interface PortalContext {
  /** Trading area or district — the most precise place name we resolved. */
  area: string;
  /** DOSM state, or null when demographics did not resolve. */
  state: string | null;
}

export interface Portal {
  id: string;
  name: string;
  /** What you get and at what precision. The two portals genuinely differ. */
  scope: (context: PortalContext) => string | null;
  /** Null when this portal cannot be searched honestly for this place. */
  href: (context: PortalContext) => string | null;
}

/**
 * URL forms VERIFIED by fetching them and counting the TYPED listings that
 * came back — not by assuming a query parameter did what it was named.
 *
 * PropertyGuru: `/retail-shops-for-rent?freetext=<area>`
 *   Survives their redirect unchanged and returns listings typed RTLSP —
 *   retail space — exclusively. 20 for KLCC, 2 for Kuantan. The small Kuantan
 *   number is the honest size of that market, and it is area-correct.
 *
 *   The earlier form, `/property-for-rent?freetext=<area>&property_type=C`,
 *   LOOKED right and was not. PropertyGuru 301s it and rewrites the parameter
 *   to `isCommercial=false` — the inverse of what was asked — so it returned
 *   mostly residential rentals with no retail typing at all. It was caught
 *   only by reading the final URL after following the redirect. Any change
 *   here must be re-checked the same way.
 *
 * Mudah: `/<region>/shop-office-for-rent`
 *   80 shop-office ads for KL. Region-level, not area-level, and deliberately:
 *   Mudah implements its CATEGORY as a freetext query, so adding `?q=KLCC`
 *   makes the search "shop office AND klcc" and collapses it to 2 ads. The
 *   choice is a state-wide search that works against an area search that
 *   returns almost nothing, so the label says "statewide" rather than
 *   implying a precision the link does not have.
 *
 * iProperty: EXCLUDED. Both `/rent/<area>/shop-retail-space/` and `?q=` return
 *   200 with listings but ZERO mentions of the area — the filter is silently
 *   ignored and you get national results. A link that looks area-specific and
 *   is not is worse than no link at all.
 *
 * The utm_* and gclid parameters that appear on these URLs in the wild are the
 * portals' own ad-campaign tracking from a Google Ads click. They are not part
 * of the search and are deliberately not reproduced.
 */
export const PORTALS: Portal[] = [
  {
    id: "propertyguru",
    name: "PropertyGuru",
    scope: ({ area }) => `retail units · ${searchTerm(area)}`,
    href: ({ area }) =>
      `https://www.propertyguru.com.my/retail-shops-for-rent?freetext=${encodeURIComponent(
        searchTerm(area),
      )}`,
  },
  {
    id: "mudah",
    name: "Mudah",
    scope: ({ state }) => (state ? `shop & office · ${stateLabel(state)}, statewide` : null),
    href: ({ state }) => {
      const region = state ? MUDAH_REGIONS[state] : undefined;
      return region ? `https://www.mudah.my/${region}/shop-office-for-rent` : null;
    },
  },
];

export function AvailableProperties({
  area,
  state = null,
  listings = [],
  loading = false,
}: {
  area: string | null;
  state?: string | null;
  /** Real units from PropertyGuru. Empty is normal, not an error. */
  listings?: PropertyListing[];
  loading?: boolean;
}) {
  // No area means no honest search to build — a national listing page dressed
  // up as "near here" would be worse than saying nothing.
  if (!area) return null;

  const context: PortalContext = { area, state };
  const available = PORTALS.map((portal) => ({
    portal,
    href: portal.href(context),
    scope: portal.scope(context),
  })).filter((entry): entry is { portal: Portal; href: string; scope: string } =>
    Boolean(entry.href && entry.scope),
  );

  if (available.length === 0) return null;

  return (
    <div className="properties">
      <div className="properties-head">
        <span className="properties-title">Available properties</span>
        <span className="tiny muted">
          {listings.length > 0
            ? `${listings.length} on the market near ${area}`
            : `retail units for rent near ${area}`}
        </span>
      </div>

      {loading && listings.length === 0 && (
        <ul className="plist" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="plist-item">
              <div className="plist-card plist-skeleton" aria-hidden="true">
                <span className="plist-thumb plist-thumb-fallback" />
                <div className="plist-body">
                  <span className="skeleton-line short" />
                  <span className="skeleton-line" />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {listings.length > 0 && (
        <ul className="plist">
          {listings.map((listing) => (
            <PropertyCard key={listing.id} listing={listing} />
          ))}
        </ul>
      )}

      {/* The portal links stay whatever happens above them. They are the
          fallback when the fetch fails, and the "see everything" route when
          it succeeds — a handful of cards is never the whole market. */}
      <div className="properties-links">
        {available.map(({ portal, href, scope }) => (
          <a
            key={portal.id}
            className="portal-link"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="portal-name">
              {listings.length > 0 && portal.id === "propertyguru" ? "See all on " : ""}
              {portal.name}
            </span>
            <span className="portal-what">{scope}</span>
            <span className="portal-arrow" aria-hidden="true">
              ↗
            </span>
          </a>
        ))}
      </div>

      <p className="tiny muted properties-note">
        {listings.length > 0
          ? "Asking prices advertised on PropertyGuru, refreshed daily. These are not transacted rents, and not used in the Success Score. Tap a unit to see it on PropertyGuru."
          : "Listings live on the portals and change daily, so these open a live search rather than a copy that would be out of date by the time you called the agent. Asking prices, not transacted rents."}
      </p>
    </div>
  );
}
