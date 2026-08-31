import { useCallback, useMemo, useState } from "react";
import { APIProvider, Map as GoogleMap, useMap } from "@vis.gl/react-google-maps";
import { useQuery } from "@tanstack/react-query";
import { formatNumber, listDistricts } from "@spotential/sim-engine";
import { Masthead } from "../components/Masthead.js";
import { getAmenities, getHeatmap, type HeatmapCell } from "../lib/api.js";
import { HeatLayer } from "../components/heatmap/HeatLayer.js";
import { HexLayer } from "../components/heatmap/HexLayer.js";
import { AmenityPins, RentPins } from "../components/heatmap/AmenityPins.js";
import { CellInspector } from "../components/heatmap/CellInspector.js";
import {
  CitySummary,
  LayerToggles,
  TopAreas,
  rankAreas,
  type RankedArea,
} from "../components/heatmap/CitySummary.js";
import { LEGEND } from "../components/heatmap/ramp.js";

/**
 * City demand — the last add-on, rebuilt.
 *
 * WHAT THIS SHOWS AND WHAT IT DOES NOT: population density at 400m, and
 * nothing else in the COLOUR. The spec asked for red-crowded /
 * green-opportunity, which needs competitor counts per cell — and that is the
 * half that bills. A grid over one district is around 960 Places calls against
 * a free allowance of 1,000 a month, so the honest version of this feature at
 * this budget maps DEMAND and says so.
 *
 * What changed in the rebuild: the surface is drawn as its REAL H3 hexagons
 * rather than squares of equivalent area, the map takes the page instead of a
 * 560px box, and a cell is now something you can click and interrogate.
 * Everything beyond population — transit, malls, universities, hospitals,
 * rents — is a separate toggleable layer, never blended into the colour, so
 * the map cannot start implying an opportunity score it has no data for.
 *
 * Both data sources are free: Kontur Population (CC BY 4.0) and OpenStreetMap
 * (ODbL). Both attributions are rendered, and neither is optional.
 */

const MAPS_API_KEY: string = import.meta.env["VITE_GOOGLE_MAPS_API_KEY"] ?? "";

const CITIES = [
  { label: "Kuala Lumpur", lat: 3.139, lng: 101.6869 },
  { label: "Petaling Jaya", lat: 3.1073, lng: 101.6067 },
  { label: "George Town", lat: 5.4141, lng: 100.3288 },
  { label: "Johor Bahru", lat: 1.4655, lng: 103.7578 },
] as const;

/** Roughly a 12km box, which is one city core and comfortably under the cap. */
const HALF_SPAN = 0.055;

/**
 * How far PAST the visible frame the grid is fetched.
 *
 * The surface is a blur, so wherever the cells stop it ends on a dead straight
 * line — and a ruler-straight edge through the middle of a city reads as a
 * broken render rather than as the edge of the data. Fetching a margin beyond
 * the frame pushes that boundary off screen at the default zoom, so the
 * gradient runs to the edges the way a heat surface should.
 *
 * Only the SURFACE uses these wider bounds. Every figure on the left still
 * describes the visible box, because "in view" has to mean in view.
 */
const GRID_PAD = 1.7;

/** Recentres the map when a top area or rent pin is chosen. */
function FlyTo({ target }: { target: { lat: number; lng: number; zoom?: number } | null }) {
  const map = useMap();

  useMemo(() => {
    if (!map || !target) return;
    map.panTo({ lat: target.lat, lng: target.lng });
    if (target.zoom) map.setZoom(target.zoom);
  }, [map, target]);

  return null;
}

export default function Heatmap() {
  const [city, setCity] = useState<(typeof CITIES)[number]>(CITIES[0]);
  const [selected, setSelected] = useState<HeatmapCell | null>(null);
  const [activeLayers, setActiveLayers] = useState<Set<string>>(new Set(["rail"]));
  const [showRent, setShowRent] = useState(true);
  const [target, setTarget] = useState<{ lat: number; lng: number; zoom?: number } | null>(null);

  const bounds = {
    west: city.lng - HALF_SPAN,
    east: city.lng + HALF_SPAN,
    south: city.lat - HALF_SPAN,
    north: city.lat + HALF_SPAN,
  };

  /** Padded, so the blur does not end on a straight line inside the frame. */
  const gridBounds = {
    west: city.lng - HALF_SPAN * GRID_PAD,
    east: city.lng + HALF_SPAN * GRID_PAD,
    south: city.lat - HALF_SPAN * GRID_PAD,
    north: city.lat + HALF_SPAN * GRID_PAD,
  };

  const heatmap = useQuery({
    queryKey: ["heatmap", city.label],
    queryFn: ({ signal }) => getHeatmap(gridBounds, signal),
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  /**
   * Nearby amenities. Cached a week server-side, so this is nearly always a
   * cache read — Overpass is a volunteer service and the whole product needs
   * about four real queries a week.
   */
  const amenities = useQuery({
    queryKey: ["amenities", city.label],
    queryFn: ({ signal }) => getAmenities(bounds, signal),
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });

  /** Everything fetched — this is what the surface is drawn from. */
  const cells = heatmap.data?.cells ?? [];
  const layers = amenities.data?.layers ?? [];
  const places = amenities.data?.places ?? [];

  /**
   * Only what is actually on screen. The surface deliberately overruns the
   * frame, but the totals, the median, the densest cell and the ranked areas
   * all claim to describe the view, so they are computed from the view.
   */
  const cellsInView = useMemo(
    () =>
      cells.filter(
        (c) =>
          c.lat >= bounds.south &&
          c.lat <= bounds.north &&
          c.lng >= bounds.west &&
          c.lng <= bounds.east,
      ),
    [cells, bounds.south, bounds.north, bounds.west, bounds.east],
  );

  const areas = useMemo(() => rankAreas(cellsInView, places), [cellsInView, places]);

  /** Only benchmarks inside the current view — the rest are another city's. */
  const districts = useMemo(
    () =>
      listDistricts().filter(
        (d) =>
          d.centre.lat >= bounds.south &&
          d.centre.lat <= bounds.north &&
          d.centre.lng >= bounds.west &&
          d.centre.lng <= bounds.east,
      ),
    [bounds.south, bounds.north, bounds.west, bounds.east],
  );

  const onSelectCell = useCallback((cell: HeatmapCell) => setSelected(cell), []);
  const onToggleLayer = useCallback((id: string) => {
    setActiveLayers((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const onSelectArea = useCallback((area: RankedArea) => {
    setTarget({ lat: area.lat, lng: area.lng, zoom: 15 });
    setSelected({ lat: area.lat, lng: area.lng, population: area.population, boundary: [] });
  }, []);

  const selectedId = selected ? `${selected.lat},${selected.lng}` : null;

  return (
    <>
      <Masthead subtitle="City demand" />

      <div className="cockpit heat">
        <div className="cockpit-info">
          <section className="card">
            <header>
              <h2>Area</h2>
              {heatmap.isPending && <span className="pill muted">loading…</span>}
            </header>
            <div className="body">
              <div className="field">
                <label htmlFor="heatmap-city">City</label>
                <select
                  id="heatmap-city"
                  value={city.label}
                  onChange={(e) => {
                    setCity(CITIES.find((c) => c.label === e.target.value) ?? CITIES[0]);
                    setSelected(null);
                    const next = CITIES.find((c) => c.label === e.target.value) ?? CITIES[0];
                    setTarget({ lat: next.lat, lng: next.lng, zoom: 13 });
                  }}
                >
                  {CITIES.map((c) => (
                    <option key={c.label} value={c.label}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {heatmap.isError && (
            <div className="notice danger">
              <span>Could not load the population grid. Every other page is unaffected.</span>
            </div>
          )}

          <CitySummary cells={cellsInView} />

          <CellInspector
            cell={selected}
            layers={layers}
            amenitiesAvailable={amenities.data?.available ?? false}
          />

          <TopAreas areas={areas} onSelect={onSelectArea} />

          <LayerToggles
            layers={layers}
            active={activeLayers}
            onToggle={onToggleLayer}
            showRent={showRent}
            onToggleRent={() => setShowRent((v) => !v)}
            rentCount={districts.length}
            available={amenities.data?.available ?? !amenities.isError}
            reason={amenities.data?.reason ?? null}
          />

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

              {/* The single most important thing on this page, and more so
                  now that the ramp runs green to red: the one misreading a
                  familiar heat gradient invites is that green looks like room
                  to trade, when it means the opposite. */}
              <div className="notice warn">
                <span>
                  <strong>Green does not mean space to open.</strong> It means almost nobody lives
                  there. Red is the hottest end of the scale, so red is where the most people are.
                  This maps <strong>where people live</strong>, not where to open: it knows nothing
                  about competition, because that data is the part that costs money and is left out
                  rather than guessed. A red area may already be saturated with rivals; check it on
                  the location page.
                </span>
              </div>

              <div className="tiny muted">
                The surface is smoothed from 400m cells, so it shows the shape of where people
                live rather than a value at any exact point — click a spot for the real figure.
                Colour is pinned to a national scale, not to what is on screen, so the same shade
                means the same density in every city. The grid covers Malaysia only, so land
                across a border is left unshaded: no colour means not measured, not empty.
                {heatmap.data && ` ${heatmap.data.attribution}, ${heatmap.data.vintage}.`}
                {amenities.data?.attribution && ` Nearby places ${amenities.data.attribution}.`}
              </div>
            </div>
          </section>
        </div>

        <div className="cockpit-map">
          {!MAPS_API_KEY ? (
            <div className="notice warn">
              <span>
                No Google Maps key was set when this build was made, so the map cannot render. The
                population data itself loaded fine
                {heatmap.data ? `: ${formatNumber(cells.length)} cells.` : "."}
              </span>
            </div>
          ) : (
            <div className="heat-map-frame">
              <APIProvider apiKey={MAPS_API_KEY} libraries={["geometry"]}>
                <GoogleMap
                  defaultCenter={{ lat: city.lat, lng: city.lng }}
                  defaultZoom={13}
                  gestureHandling="greedy"
                  disableDefaultUI
                  zoomControl
                  mapId="spotential-heatmap"
                >
                  {/* Surface first, then the invisible hit targets over it. */}
                  <HeatLayer cells={cells} />
                  <HexLayer cells={cells} selectedId={selectedId} onSelect={onSelectCell} />
                  <AmenityPins layers={layers} active={activeLayers} />
                  <RentPins
                    districts={districts}
                    show={showRent}
                    onSelect={(d) => setTarget({ lat: d.centre.lat, lng: d.centre.lng, zoom: 15 })}
                  />
                  <FlyTo target={target} />
                </GoogleMap>
              </APIProvider>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
