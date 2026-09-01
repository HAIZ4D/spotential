import type { PropertyListing } from "../../lib/api.js";
import { PhotoBox } from "./PhotoBox.js";

/**
 * One real retail unit, currently advertised for rent.
 *
 * Everything on this card belongs to PropertyGuru and the listing agent, so
 * the whole card is a link back to their page — there is no "view details"
 * button, because there is nothing to view here. What we show is the handful
 * of facts an SME screens on (price, psf, size, type, transit) and a
 * thumbnail; the description, photo gallery and agent contact stay where they
 * were published.
 *
 * These are ASKING prices. They are display-only and never reach the score.
 */

/**
 * The image is hotlinked from PropertyGuru's CDN, not copied to our storage.
 *
 * Verified to serve cross-origin from our domain, so this costs us no
 * bandwidth and keeps their media on their infrastructure — which is both the
 * cheaper and the more defensible arrangement. A 404 falls back to an initial
 * tile, the same device the competitor list uses when there is no image.
 */
export function PropertyCard({ listing }: { listing: PropertyListing }) {
  const meta = [listing.sizeLabel, listing.transitLabel].filter(Boolean).join(" · ");

  return (
    <li className="plist-item">
      <a
        className="plist-card"
        href={listing.url}
        target="_blank"
        rel="noopener noreferrer"
        // The card is one link, so the accessible name has to carry what the
        // eye gets from the layout — otherwise it announces only the title.
        aria-label={`${listing.title}, ${listing.rentLabel}${
          listing.psfLabel ? `, ${listing.psfLabel}` : ""
        }, opens on PropertyGuru`}
      >
        <PhotoBox id={listing.id} label={listing.title} src={listing.thumbnailUrl ?? null} shape="wide" />

        <div className="plist-body">
          <div className="plist-top">
            {listing.propertyType && <span className="plist-type">{listing.propertyType}</span>}
            <span className="plist-address">{listing.address || listing.title}</span>
          </div>

          <div className="plist-price">
            <span className="plist-rent">{listing.rentLabel}</span>
            {listing.psfLabel && <span className="plist-psf">{listing.psfLabel}</span>}
          </div>

          {meta && <div className="plist-meta">{meta}</div>}
        </div>

        <span className="plist-go" aria-hidden="true">
          ↗
        </span>
      </a>
    </li>
  );
}
