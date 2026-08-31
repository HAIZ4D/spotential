import { RADIUS_BUCKETS, SECTORS,
  SECTOR_LABELS,
  listCategoriesBySector, type BusinessCategory } from "@spotential/sim-engine";
import type { PickedLocation } from "../../lib/location.js";
import { SERIES_COLOURS } from "../CompareRadar.js";

/**
 * The comparison's controls, in one sticky bar.
 *
 * DELIBERATELY NOT the analysis Toolbar. That one hardcodes
 * `id="competitor-category"` and takes an address search this page has no use
 * for; sharing it would mean two elements answering to "Business type" on a
 * page whose whole point is that there is exactly one. Same CSS, same rhythm,
 * honest about its own controls.
 *
 * Category and radius live HERE, at the comparison level, never per location.
 * A 250m Korean search against a 1km cafe search produces two numbers that
 * cannot be ranked against each other, so the design makes that unreachable
 * rather than warning about it.
 */
export function CompareToolbar({
  category,
  onCategory,
  radiusMetres,
  onRadius,
  locations,
  onRemove,
}: {
  category: BusinessCategory;
  onCategory: (next: BusinessCategory) => void;
  radiusMetres: number;
  onRadius: (next: number) => void;
  locations: PickedLocation[];
  onRemove: (index: number) => void;
}) {
  return (
    <div className="cockpit-toolbar no-print">
      <div className="grow cmp-chips">
        {locations.length === 0 ? (
          <span className="small muted">
            Nothing to compare yet — open a spot on the Location page and use &ldquo;Add to
            comparison&rdquo;.
          </span>
        ) : (
          locations.map((location, index) => (
            <span className="cmp-chip" key={`${location.lat},${location.lng}`}>
              {/* Colour-keyed to the radar and the rings, so a colour means
                  one location everywhere on the page. */}
              <span
                className="cmp-chip-dot"
                style={{ background: SERIES_COLOURS[index % SERIES_COLOURS.length] }}
                aria-hidden="true"
              />
              <span className="cmp-chip-label">{location.label}</span>
              <button
                type="button"
                className="cmp-chip-remove"
                onClick={() => onRemove(index)}
                aria-label={`Remove ${location.label} from the comparison`}
              >
                ×
              </button>
            </span>
          ))
        )}

        <a className="cmp-add" href="/analysis">
          + Add
        </a>
      </div>

      <span className="toolbar-label">Business</span>
      <select
        id="compare-category"
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
        id="compare-radius"
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
