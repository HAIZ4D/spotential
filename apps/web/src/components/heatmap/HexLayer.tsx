import { useEffect } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import type { HeatmapCell } from "../../lib/api.js";

/**
 * The click targets, and nothing else.
 *
 * These hexagons used to BE the map. Now HeatLayer paints the surface and
 * these sit invisibly on top of it, purely so a cell can still be clicked:
 * a heat gradient has no discrete thing to hit, and the inspector — residents,
 * national percentile, what is inside the cell, the rent benchmark, "Score
 * this spot" — is the most useful part of the page.
 *
 * Keeping them is also what lets the surface be smooth without the page
 * losing precision. The gradient is the impression; clicking gives the exact
 * figure for one real 400m cell.
 *
 * The geometry is genuine H3, computed server-side. It was already correct and
 * is untouched — only the fill and stroke changed.
 */

/** A flat [lat, lng, lat, lng, …] boundary as Maps wants it. */
export function pathFor(boundary: number[]): google.maps.LatLngLiteral[] {
  const path: google.maps.LatLngLiteral[] = [];
  for (let i = 0; i < boundary.length; i += 2) {
    path.push({ lat: boundary[i] as number, lng: boundary[i + 1] as number });
  }
  return path;
}

/**
 * Every option that decides whether these are hit targets or a second visible
 * layer, as a pure function so it can be asserted directly.
 *
 * `fillOpacity: 0` is the load-bearing one and the easiest to lose: a nonzero
 * fill here would tile visible hexagons back over the smooth surface and undo
 * the whole change, while still looking deliberate in a diff. A zero-opacity
 * polygon is fully clickable, which is what makes this work at all.
 */
export function hitTargetOptions(
  cell: HeatmapCell,
  selected: boolean,
): google.maps.PolygonOptions {
  return {
    paths: pathFor(cell.boundary),
    fillColor: "#000000",
    fillOpacity: 0,
    // The selected cell is the one exception: it gets an outline so you can
    // see which cell the inspector is describing.
    strokeColor: "#101828",
    strokeOpacity: selected ? 1 : 0,
    strokeWeight: selected ? 2 : 0,
    zIndex: selected ? 3 : 1,
    clickable: true,
  };
}

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
      const selected = `${cell.lat},${cell.lng}` === selectedId;
      const polygon = new google.maps.Polygon({
        map,
        ...hitTargetOptions(cell, selected),
      });

      polygon.addListener("click", () => onSelect(cell));
      return polygon;
    });

    return () => polygons.forEach((polygon) => polygon.setMap(null));
  }, [map, cells, selectedId, onSelect]);

  return null;
}
