import { useCallback, useMemo, useState } from "react";
import { APIProvider, Map as GoogleMap, useMap } from "@vis.gl/react-google-maps";
import { useQuery } from "@tanstack/react-query";
import { formatNumber, listDistricts } from "@spotential/sim-engine";
import { Masthead } from "../components/Masthead.js";
import { getAmenities, getHeatmap, type HeatmapCell } from "../lib/api.js";
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

  const heatmap = useQuery({
    queryKey: ["heatmap", city.label],
    queryFn: ({ signal }) => getHeatmap(bounds, signal),
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

  const cells = heatmap.data?.cells ?? [];
  const layers = amenities.data?.layers ?? [];
  const places = amenities.data?.places ?? [];

  const areas = useMemo(() => rankAreas(cells, places), [cells, places]);

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

          <CitySummary cells={cells} />

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
                    <span className="tiny">{row.label}</span>
                  </div>
                ))}
              </div>

              {/* The single most important thing on this page. */}
              <div className="notice warn">
                <span>
                  This maps <strong>where people live</strong>, not where to open. It knows nothing
                  about competition — that data is the part that costs money, so it is left out
                  rather than guessed. A dense cell may already be saturated; check it on the
                  location page.
                </span>
              </div>

              <div className="tiny muted">
                Colour is a national percentile, not a local one, so a shade means the same thing in
                every city.
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
              <APIProvider apiKey={MAPS_API_KEY}>
                <GoogleMap
                  defaultCenter={{ lat: city.lat, lng: city.lng }}
                  defaultZoom={13}
                  gestureHandling="greedy"
                  disableDefaultUI
                  zoomControl
                  mapId="spotential-heatmap"
                >
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
