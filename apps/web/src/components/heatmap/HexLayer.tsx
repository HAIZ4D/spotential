import { useEffect } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import type { HeatmapCell } from "../../lib/api.js";
import { colourForPopulation } from "./ramp.js";

/**
 * The population surface, drawn as its real hexagons.
 *
 * These used to be squares of equivalent area. Squares cannot tile a hexagonal
 * grid, so the map was always going to be either gapped or overlapping — and
 * it was gapped, visibly, when they were once sized at 400m instead of 859m.
 * Real H3 boundaries come from the server, so the tiling is exact and the
 * seam class of bug is gone by construction rather than by tuning.
 *
 * A city is about 175 cells, so plain `google.maps.Polygon` is comfortably
 * fast enough and avoids adding a WebGL layer for a few hundred shapes.
 */
export function HexLayer({
  cells,
  selectedId,
  onSelect,
}: {
  cells: HeatmapCell[];
  /** "lat,lng" of the selected cell, so the ring can be highlighted. */
  selectedId: string | null;
  onSelect: (cell: HeatmapCell) => void;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || typeof google === "undefined") return;

    const polygons = cells.map((cell) => {
      const path: google.maps.LatLngLiteral[] = [];
      for (let i = 0; i < cell.boundary.length; i += 2) {
        path.push({ lat: cell.boundary[i] as number, lng: cell.boundary[i + 1] as number });
      }

      const id = `${cell.lat},${cell.lng}`;
      const selected = id === selectedId;

      const polygon = new google.maps.Polygon({
        map,
        paths: path,
        fillColor: colourForPopulation(cell.population),
        // Solid enough to read as a surface, sheer enough to keep the
        // basemap's roads legible underneath — you need both to recognise
        // where you are looking.
        fillOpacity: selected ? 0.92 : 0.68,
        // A hairline in the fill colour hides the anti-aliasing seam between
        // adjacent polygons, which otherwise shows as a pale grid.
        strokeColor: selected ? "#101828" : colourForPopulation(cell.population),
        strokeOpacity: selected ? 1 : 0.85,
        strokeWeight: selected ? 2 : 1,
        zIndex: selected ? 3 : 1,
        clickable: true,
      });

      polygon.addListener("click", () => onSelect(cell));
      return polygon;
    });

    return () => polygons.forEach((polygon) => polygon.setMap(null));
  }, [map, cells, selectedId, onSelect]);

  return null;
}
