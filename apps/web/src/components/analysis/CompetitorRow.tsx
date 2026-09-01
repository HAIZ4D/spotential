import { formatNumber, type CompetitorWithDistance } from "@spotential/sim-engine";
import { PhotoBox } from "./PhotoBox.js";

/**
 * One competitor, as a row rather than four table cells.
 *
 * The visual anchor is an initial tile, not a photo. Photos are a separate
 * enterprise-tier Places SKU billed per image per page load — twenty
 * thumbnails a view burns the monthly free allowance in about fifty views.
 * The tile is the pattern Gmail and Slack use when there is no avatar, and it
 * gives the list the same rhythm for nothing.
 *
 * `priceLevel` and `primaryType` were already in the field mask, already
 * billed on every search, and displayed nowhere. Two free signals per row.
 */

/** Places returns SCREAMING_SNAKE enum names; nobody wants to read those. */
const PRICE_MARKS: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

function typeLabel(primaryType: string | null): string | null {
  if (!primaryType) return null;
  // "coffee_shop" -> "coffee shop". Places has hundreds of these, so this
  // normalises rather than enumerating them.
  return primaryType.replace(/_/g, " ").replace(/\brestaurant\b/, "restaurant");
}

/** Green above 4.3, amber above 3.5, red below — the app's state scale. */
function ratingTone(rating: number): "green" | "amber" | "red" {
  if (rating >= 4.3) return "green";
  if (rating >= 3.5) return "amber";
  return "red";
}

export function CompetitorRow({
  competitor,
  rank,
  maxReviews,
  radiusMetres,
  hovered,
  onHover,
}: {
  competitor: CompetitorWithDistance;
  rank: number;
  /** Scales the review bar against the busiest outlet on screen. */
  maxReviews: number;
  radiusMetres: number;
  hovered: boolean;
  onHover: (id: string | null) => void;
}) {
  const { name, rating, reviewCount, distanceMetres, priceLevel, primaryType } = competitor;
  const closed = competitor.businessStatus === "CLOSED_PERMANENTLY";

  const marks = priceLevel ? PRICE_MARKS[priceLevel] : undefined;
  const type = typeLabel(primaryType);

  // Reviews span orders of magnitude — 1 against 692 in the same list — so a
  // linear bar would leave almost every outlet at zero width.
  const reviewShare =
    maxReviews > 0 ? Math.log10(1 + reviewCount) / Math.log10(1 + maxReviews) : 0;

  // Nearer is fuller: the bar reads as proximity, not as distance.
  const proximity = radiusMetres > 0 ? Math.max(0, 1 - distanceMetres / radiusMetres) : 0;

  return (
    <li
      className={`clist-row ${hovered ? "hovered" : ""} ${closed ? "closed" : ""}`}
      onMouseEnter={() => onHover(competitor.id)}
      onMouseLeave={() => onHover(null)}
    >
      <span className="clist-rank">{rank}</span>
      <PhotoBox id={competitor.id} label={name} />

      <div className="clist-main">
        <div className="clist-name">
          {name}
          {closed && <span className="pill muted">closed</span>}
        </div>

        <div className="clist-meta">
          {rating === null ? (
            <span className="clist-unrated">unrated</span>
          ) : (
            <span className="clist-rating">
              <span className={`clist-star ${ratingTone(rating)}`}>★</span>
              {rating}
              <span className="clist-bar" aria-hidden="true">
                <i className={ratingTone(rating)} style={{ width: `${(rating / 5) * 100}%` }} />
              </span>
            </span>
          )}

          <span className="clist-reviews">
            {formatNumber(reviewCount)} review{reviewCount === 1 ? "" : "s"}
            <span className="clist-bar" aria-hidden="true">
              <i className="navy" style={{ width: `${reviewShare * 100}%` }} />
            </span>
          </span>

          {marks !== undefined && marks > 0 && (
            <span className="clist-price" title={priceLevel ?? undefined}>
              {"RM".repeat(1)}
              {marks > 1 && <span className="muted">{"·RM".repeat(marks - 1)}</span>}
            </span>
          )}

          {type && <span className="clist-type">{type}</span>}
        </div>
      </div>

      <div className="clist-distance">
        <span className="clist-metres">{formatNumber(distanceMetres)}m</span>
        <span className="clist-bar wide" aria-hidden="true">
          <i className="gold" style={{ width: `${proximity * 100}%` }} />
        </span>
      </div>
    </li>
  );
}
