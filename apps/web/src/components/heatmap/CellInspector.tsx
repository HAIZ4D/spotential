import { formatNumber, nearestDistrict, type DistrictPreset } from "@spotential/sim-engine";
import type { AmenityLayer, HeatmapCell } from "../../lib/api.js";
import { locationSearchParams } from "../../lib/location.js";
import { percentileFor } from "./ramp.js";

/**
 * What one hexagon actually is.
 *
 * The page used to be a picture: a colour meant something on a legend and
 * nothing you could act on. This turns a cell into a place — how many people,
 * how that compares nationally, what is around it, what it rents for, and a
 * way through to the full analysis.
 *
 * The percentile is the same one the Success Score uses, via the engine's
 * `catchmentPercentile`. One scale, so the map and the score can never
 * describe the same spot differently.
 */

/** Roughly the in-radius of a resolution-8 hexagon — used to count what's inside it. */
const CELL_RADIUS_M = 460;

function metresBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  return Math.hypot(
    (a.lat - b.lat) * 110_574,
    (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180),
  );
}

/** Amenities whose pin falls inside this hexagon. Only pinned layers have points. */
function nearbyCounts(cell: HeatmapCell, layers: AmenityLayer[]) {
  return layers
    .filter((layer) => layer.pinned)
    .map((layer) => ({
      label: layer.label,
      count: layer.points.filter(
        (point) => metresBetween(cell, point) <= CELL_RADIUS_M,
      ).length,
    }))
    .filter((entry) => entry.count > 0);
}

/**
 * The benchmark only if the cell genuinely falls inside its stated radius.
 *
 * `nearestDistrict` already enforces the per-entry radius and returns null
 * otherwise — which is the right answer, not a failure. Coverage is 23 trading
 * areas out of a whole country.
 */
function coveringBenchmark(cell: HeatmapCell): DistrictPreset | null {
  return nearestDistrict(cell)?.district ?? null;
}

export function CellInspector({
  cell,
  layers,
  amenitiesAvailable,
}: {
  cell: HeatmapCell | null;
  layers: AmenityLayer[];
  amenitiesAvailable: boolean;
}) {
  if (!cell) {
    return (
      <section className="card">
        <header>
          <h2>Inspect a cell</h2>
        </header>
        <div className="body">
          <p className="small muted" style={{ margin: 0 }}>
            Click any hexagon on the map to see how many people live there, how that compares
            nationally, and what it rents for.
          </p>
        </div>
      </section>
    );
  }

  const percentile = Math.round(percentileFor(cell.population) * 100);
  const nearby = nearbyCounts(cell, layers);
  const benchmark = coveringBenchmark(cell);

  const href = `/analysis?${locationSearchParams({
    lat: cell.lat,
    lng: cell.lng,
    label: `${cell.lat.toFixed(4)}, ${cell.lng.toFixed(4)}`,
  }).toString()}`;

  return (
    <section className="card">
      <header>
        <h2>Selected cell</h2>
        <span className="pill muted">{percentile}th pct</span>
      </header>

      <div className="body stack">
        <div>
          <div className="figure">{formatNumber(cell.population)}</div>
          <div className="tiny muted">residents in this 400m hexagon</div>
        </div>

        <div className="small">
          Denser than <strong>{percentile}%</strong> of where Malaysians live — the same scale the
          Success Score uses.
        </div>

        {nearby.length > 0 && (
          <div>
            <div className="tiny muted" style={{ marginBottom: 4 }}>
              Inside this cell
            </div>
            <div className="cell-nearby">
              {nearby.map((entry) => (
                <span key={entry.label} className="cell-chip">
                  {entry.count} {entry.label.toLowerCase()}
                </span>
              ))}
            </div>
          </div>
        )}

        {nearby.length === 0 && amenitiesAvailable && (
          <div className="tiny muted">
            No rail, mall, university or hospital inside this cell — turn layers on to see the wider
            city.
          </div>
        )}

        {benchmark ? (
          <div className="small">
            Rent benchmark <strong>{benchmark.label}</strong> — RM{benchmark.rentMedianPsf}/sqft.{" "}
            <span className="muted">
              {benchmark.source}, reviewed {benchmark.reviewed}.
            </span>
          </div>
        ) : (
          <div className="tiny muted">No rent benchmark covers this cell.</div>
        )}

        <div>
          <a className="tiny cta" href={href}>
            Score this spot →
          </a>
        </div>
      </div>
    </section>
  );
}
