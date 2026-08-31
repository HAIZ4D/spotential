import { RADIUS_BUCKETS, SECTORS,
  SECTOR_LABELS,
  listCategoriesBySector, type BusinessCategory } from "@spotential/sim-engine";
import type { ReactNode } from "react";

/**
 * One sticky row for everything that changes what is being analysed.
 *
 * These three controls used to be two separate cards in a 340px sidebar,
 * above a screenful of empty white. Pulling them into a single row frees the
 * whole width below for the two panes, and keeps them reachable no matter how
 * far the information column has scrolled — which matters because changing
 * the radius changes every figure on the page.
 */
export function Toolbar({
  category,
  onCategory,
  radiusMetres,
  onRadius,
  search,
}: {
  category: BusinessCategory;
  onCategory: (next: BusinessCategory) => void;
  radiusMetres: number;
  onRadius: (next: number) => void;
  /** The address search, or a notice when the geocoder is unavailable. */
  search: ReactNode;
}) {
  return (
    <div className="cockpit-toolbar no-print">
      <div className="grow">{search}</div>

      <span className="toolbar-label">Business</span>
      <select
        id="competitor-category"
        aria-label="Business type"
        value={category}
        onChange={(e) => onCategory(e.target.value as BusinessCategory)}
      >
                {SECTORS.map((sector) => (
          <optgroup key={sector} label={SECTOR_LABELS[sector]}>
            {listCategoriesBySector(sector).map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <span className="toolbar-label">Radius</span>
      <select
        id="competitor-radius"
        aria-label="Search radius"
        value={radiusMetres}
        onChange={(e) => onRadius(Number(e.target.value))}
      >
        {RADIUS_BUCKETS.map((r) => (
          <option key={r} value={r}>
            {r}m
          </option>
        ))}
      </select>
    </div>
  );
}
