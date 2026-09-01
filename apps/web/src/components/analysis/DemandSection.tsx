import type { AmenityLayer } from "../../lib/api.js";
import type { HeatmapCell } from "../../lib/api.js";
import { CellInspector } from "../heatmap/CellInspector.js";
import { CitySummary, LayerToggles, TopAreas, type RankedArea } from "../heatmap/CitySummary.js";
import { LEGEND } from "../heatmap/ramp.js";

/**
 * The City Demand panel, on the Location page.
 *
 * Everything here used to be the left column of `/heatmap`, and the components
 * are reused unchanged — only what feeds them differs. Two changes matter:
 *
 * The inspector FOLLOWS THE PIN rather than a clicked cell. On the old page a
 * click selected a cell; on this one a click moves the pin, and those cannot
 * both own a click. Following the pin removes the conflict rather than
 * arbitrating it, and it ties the surface to the catchment figure this page
 * already prints — the number and the picture now describe the same cell.
 *
 * And every figure describes THE VISIBLE MAP, not a fixed box: zoom out for a
 * city, in for a street. That is what makes this a replacement for the old
 * page rather than a smaller version of it.
 */
export function DemandSection({
  cells,
  pinCell,
  layers,
  amenitiesAvailable,
  amenitiesInRange,
  amenityReason,
  rentCount,
  areas,
  active,
  onToggle,
  showRent,
  onShowRent,
  surfaceOn,
  onSurface,
  onFlyTo,
  loading,
  failed,
  attribution,
  vintage,
  amenityAttribution,
}: {
  cells: HeatmapCell[];
  pinCell: HeatmapCell | null;
  layers: AmenityLayer[];
  amenitiesAvailable: boolean;
  /** False when the view is wider than the amenities endpoint accepts. */
  amenitiesInRange: boolean;
  /**
   * Why places are missing, when they are. Passed through rather than
   * flattened to null: "unreachable" covers DNS, refused connections, TLS
   * failures and truncated bodies, and a reader deserves to know Overpass is
   * merely busy rather than that the layer is broken.
   */
  amenityReason: string | null;
  rentCount: number;
  areas: RankedArea[];
  active: Set<string>;
  onToggle: (next: Set<string>) => void;
  showRent: boolean;
  onShowRent: (next: boolean) => void;
  surfaceOn: boolean;
  onSurface: (next: boolean) => void;
  onFlyTo: (point: { lat: number; lng: number }) => void;
  loading: boolean;
  failed: boolean;
  /**
   * Kontur is CC BY 4.0 and OpenStreetMap is ODbL: attribution is required
   * WHEREVER the data is shown. The footer names the licences on every route,
   * but the dataset VERSION lived on the page that is being removed — so it
   * moves here with the data rather than being quietly dropped.
   */
  attribution: string | null;
  vintage: string | null;
  amenityAttribution: string | null;
}) {
  if (failed) {
    return (
      <div className="notice danger">
        <span>
          Could not load the population grid. Every other page is unaffected, and so is this one:
          the score and the catchment figure were computed before this and do not depend on it.
        </span>
      </div>
    );
  }

  return (
    <>
      {/* The surface is off by default because it also widens the camera, and
          a panel that silently moved the map would be worse than a switch. */}
      <section className="card">
        <header>
          <h2>Population surface</h2>
          {loading && <span className="pill muted">loading…</span>}
        </header>
        <div className="body stack">
          <button
            type="button"
            className="layer-toggle"
            aria-pressed={surfaceOn}
            onClick={() => onSurface(!surfaceOn)}
          >
            <span>Shade the map by residents</span>
            <span className="tiny muted">{surfaceOn ? "on" : "off"}</span>
          </button>
          <p className="tiny muted">
            Opening this tab already widened the map to about 2.5km. At the search framing a single
            693m cell fills the pane, so every figure below would describe one hexagon. This switch
            only decides whether that area is coloured in.
          </p>
        </div>
      </section>

      <CitySummary cells={cells} />

      {/* Not a clicked cell — the one the pin is standing in. */}
      <CellInspector cell={pinCell} layers={layers} amenitiesAvailable={amenitiesAvailable} />

      <TopAreas areas={areas} onSelect={(area) => onFlyTo({ lat: area.lat, lng: area.lng })} />

      {amenitiesInRange ? (
        <LayerToggles
          layers={layers}
          active={active}
          onToggle={(id) => {
            const next = new Set(active);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            onToggle(next);
          }}
          showRent={showRent}
          onToggleRent={() => onShowRent(!showRent)}
          rentCount={rentCount}
          available={amenitiesAvailable}
          reason={amenityReason}
        />
      ) : (
        <div className="notice">
          <span>
            Zoom in to load transit, malls and the other place layers. They are served for boxes up
            to about 33km a side, and this view is wider than that.
          </span>
        </div>
      )}

      <section className="card">
        <header>
          <h2>Reading this map</h2>
        </header>
        <div className="body stack">
          <div className="legend">
            {LEGEND.map((row) => (
              <div className="legend-row" key={row.label}>
                <span className="legend-swatch" style={{ background: row.colour }} />
                <span className="tiny">
                  <strong>{row.label}</strong> <span className="muted">{row.note}</span>
                </span>
              </div>
            ))}
          </div>

          {/**
           * The single most important thing here, and MORE so on this page
           * than on the old one.
           *
           * The score bars a few centimetres away paint green for a dimension
           * that scores well. The same green on the surface means almost
           * nobody lives there — the opposite. Separate pages is what used to
           * make one notice enough; on one screen these words are the only
           * thing that resolves the collision, so they are not decoration and
           * they do not move.
           */}
          {/**
            * Colour is pinned to a NATIONAL constant, never to what is on
            * screen. A heat layer normalises to the busiest thing in view by
            * default, which would paint suburban PJ's densest patch exactly as
            * red as central KL's — the relative-normalisation trap that has
            * already inverted this project's scoring twice. Saying so is what
            * lets two people compare two screenshots.
            */}
          <p className="tiny muted">
            The surface is smoothed from 400m cells, so it shows the shape of where people live
            rather than a value at any exact point. Colour is pinned to a national scale, not to
            what is on screen, so the same shade means the same density in every city. The grid
            covers Malaysia only: no colour means not measured, not empty.
          </p>

          <p className="tiny muted">
            {attribution ? `${attribution}, ${vintage ?? "undated"}.` : null}
            {amenityAttribution ? ` Nearby places ${amenityAttribution}.` : null}
          </p>

          <div className="notice warn">
            <span>
              <strong>Green does not mean space to open.</strong> It means almost nobody lives
              there. Red is the hottest end of the scale, so red is where the most people are. That
              is the opposite of what green means in the score bars on this page, which is exactly
              why it is worth saying. This maps <strong>where people live</strong>, not where to
              open: it knows nothing about competition. A red area may already be saturated with
              rivals, which is what the Competition tab is for.
            </span>
          </div>
        </div>
      </section>
    </>
  );
}
