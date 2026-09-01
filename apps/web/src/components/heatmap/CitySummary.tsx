import { formatNumber } from "@spotential/sim-engine";
import type { AmenityLayer, HeatmapCell } from "../../lib/api.js";
import { percentileFor } from "./ramp.js";

/**
 * The city in five numbers, and the areas worth looking at.
 *
 * "Top areas" are named from OpenStreetMap place nodes rather than reverse
 * geocoded: Google charges per reverse geocode and OSM has 78 named
 * neighbourhoods in central KL alone — Bukit Bintang, Chow Kit, Brickfields.
 * A ranked list of coordinates would have been useless; a ranked list of
 * places is the thing an SME can act on.
 */

const metresBetween = (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number =>
  Math.hypot(
    (a.lat - b.lat) * 110_574,
    (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180),
  );

export function CitySummary({ cells }: { cells: HeatmapCell[] }) {
  if (cells.length === 0) return null;

  const populations = cells.map((c) => c.population).sort((a, b) => a - b);
  const total = populations.reduce((sum, n) => sum + n, 0);
  const median = populations[Math.floor(populations.length / 2)] ?? 0;
  const densest = populations[populations.length - 1] ?? 0;

  return (
    <section className="card">
      <header>
        <h2>In view</h2>
      </header>
      <div className="body">
        <div className="city-stats">
          <div>
            <div className="figure">{formatNumber(total)}</div>
            <div className="tiny muted">residents</div>
          </div>
          <div>
            <div className="figure small-figure">{formatNumber(median)}</div>
            <div className="tiny muted">median cell</div>
          </div>
          <div>
            <div className="figure small-figure">{formatNumber(densest)}</div>
            <div className="tiny muted">densest cell</div>
          </div>
        </div>
        <div className="tiny muted" style={{ marginTop: 8 }}>
          {formatNumber(cells.length)} hexagons of 400m
        </div>
      </div>
    </section>
  );
}

export interface RankedArea {
  name: string;
  population: number;
  lat: number;
  lng: number;
  percentile: number;
}

/**
 * Rank the densest cells, then give each the nearest named place.
 *
 * Names are deduplicated: several adjacent hexagons often sit closest to the
 * same suburb node, and a list reading "Bukit Bintang, Bukit Bintang, Bukit
 * Bintang" is worse than a shorter one.
 */
export function rankAreas(
  cells: HeatmapCell[],
  places: { lat: number; lng: number; name: string }[],
  limit = 6,
): RankedArea[] {
  const ranked: RankedArea[] = [];
  const used = new Set<string>();

  for (const cell of [...cells].sort((a, b) => b.population - a.population)) {
    if (ranked.length >= limit) break;

    let name: string | null = null;
    let best = Infinity;
    for (const place of places) {
      const d = metresBetween(cell, place);
      // Beyond ~2.5km the nearest suburb node is not describing this cell.
      if (d < best && d <= 2_500) {
        best = d;
        name = place.name;
      }
    }

    if (!name || used.has(name)) continue;
    used.add(name);

    ranked.push({
      name,
      population: cell.population,
      lat: cell.lat,
      lng: cell.lng,
      percentile: Math.round(percentileFor(cell.population) * 100),
    });
  }

  return ranked;
}

export function TopAreas({
  areas,
  onSelect,
}: {
  areas: RankedArea[];
  onSelect: (area: RankedArea) => void;
}) {
  if (areas.length === 0) return null;

  return (
    <section className="card">
      <header>
        <h2>Densest areas</h2>
      </header>
      <div className="body">
        <ol className="top-areas">
          {areas.map((area, index) => (
            <li key={area.name}>
              <button type="button" className="top-area" onClick={() => onSelect(area)}>
                <span className="top-area-rank">{index + 1}</span>
                <span className="top-area-name">{area.name}</span>
                <span className="top-area-figure">{formatNumber(area.population)}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function LayerToggles({
  layers,
  active,
  onToggle,
  showRent,
  onToggleRent,
  rentCount,
  available,
  reason,
}: {
  layers: AmenityLayer[];
  active: Set<string>;
  onToggle: (id: string) => void;
  showRent: boolean;
  onToggleRent: () => void;
  rentCount: number;
  available: boolean;
  reason: string | null;
}) {
  return (
    <section className="card">
      <header>
        <h2>What&rsquo;s around</h2>
      </header>

      <div className="body stack">
        {!available && (
          <div className="notice info">
            <span>
              {reason === "throttled"
                ? "OpenStreetMap is busy right now, so the nearby layers are unavailable. The population map is unaffected."
                : "Nearby data could not be loaded. The population map is unaffected."}
            </span>
          </div>
        )}

        {/* Free, already in the bundle, and the reason this panel earns its
            place: demand and cost on one screen. */}
        <button
          type="button"
          className={`layer-toggle ${showRent ? "on" : ""}`}
          onClick={onToggleRent}
          aria-pressed={showRent}
        >
          <span className="layer-name">Rent benchmarks</span>
          <span className="layer-count">{rentCount}</span>
        </button>

        {layers.map((layer) => (
          <button
            key={layer.id}
            type="button"
            className={`layer-toggle ${active.has(layer.id) ? "on" : ""} ${
              layer.pinned ? "" : "count-only"
            }`}
            onClick={() => layer.pinned && onToggle(layer.id)}
            aria-pressed={layer.pinned ? active.has(layer.id) : undefined}
            disabled={!layer.pinned}
            /* Dense categories are counted but never drawn — 1,026 bus stops
               is a useful number and a useless picture. */
            title={layer.pinned ? undefined : "Counted, not drawn: too many to map usefully"}
          >
            <span className="layer-name">{layer.label}</span>
            <span className="layer-count">{formatNumber(layer.count)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
