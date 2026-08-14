import { formatNumber } from "@spotential/sim-engine";

/**
 * What the two rings mean.
 *
 * Without this the green inner ring is just decoration. With it, the map
 * answers the question the panels take a paragraph to answer: how much of
 * this circle do we actually know anything about?
 */
export function MapLegend({
  radiusMetres,
  completeToMetres,
  count,
  truncated,
}: {
  radiusMetres: number;
  completeToMetres: number | null;
  count: number;
  truncated: boolean;
}) {
  const partial = truncated && completeToMetres !== null && completeToMetres < radiusMetres;

  return (
    <div className="map-legend">
      <span className="map-legend-item">
        <span className="map-key pin" />
        {formatNumber(count)}
        {truncated ? "+" : ""} competitors
      </span>

      {partial && (
        <span className="map-legend-item">
          <span className="map-key complete" />
          complete to {formatNumber(completeToMetres)}m
        </span>
      )}

      <span className="map-legend-item">
        <span className="map-key radius" />
        {formatNumber(radiusMetres)}m searched
      </span>

      {partial && (
        <span className="map-legend-note">
          Places returns the nearest 20 and stops, so the ring between{" "}
          {formatNumber(completeToMetres)}m and {formatNumber(radiusMetres)}m was never searched —
          it is unknown, not empty.
        </span>
      )}
    </div>
  );
}
