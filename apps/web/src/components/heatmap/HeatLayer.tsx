import { useEffect } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import type { HeatmapCell } from "../../lib/api.js";
import { colourAt, colourAtMono, weightFor } from "./ramp.js";

/**
 * The population surface, as a real heat gradient.
 *
 * WHY THIS IS HAND-DRAWN RATHER THAN google.maps.visualization.HeatmapLayer.
 * That class is documented as removed from the Maps JavaScript API at v3.65.
 * Probed against the live API it still answers — the deployed key loads
 * v3.66.2d and `importLibrary("visualization")` still returns HeatmapLayer —
 * but @vis.gl requests the `weekly` channel, so building on something Google
 * says is gone means the page can break on a Maps release with no warning and
 * no deploy of ours. A canvas overlay is about a hundred lines, cannot be
 * withdrawn, and gives exact control over the two things that matter here:
 * the gradient stops and the national calibration.
 *
 * THE ALGORITHM is the standard one. Each cell paints a radial falloff into a
 * greyscale buffer with additive compositing, so overlapping cells accumulate;
 * the accumulated alpha is then mapped through the colour ramp. Density is a
 * continuous quantity — people do not live in hexagons, that is Kontur's
 * aggregation — so smoothing represents the underlying reality more honestly
 * than a hard cell edge does. Exact figures stay one click away: the surface
 * is the impression, the inspector is the fact.
 */

/**
 * Radius of one cell's influence, in METRES rather than pixels.
 *
 * Converted to pixels on every draw from the current projection, so the blur
 * always represents the same distance on the ground. Left in pixels it would
 * mean 700m when zoomed in and tens of kilometres when zoomed out, which is a
 * different claim at every zoom level.
 *
 * MUST EXCEED THE CELL SPACING, and by a good margin. Resolution-8 centres sit
 * about 700m apart, so the first attempt at 620m had every kernel finishing
 * before its neighbour began: the surface rendered as a polka-dot field of
 * isolated red cores on green, which is a picture of Kontur's sampling grid
 * rather than of where people live. At roughly twice the spacing the kernels
 * overlap several deep and the surface reads as continuous.
 */
export const INFLUENCE_METRES = 1_500;

/**
 * Area of one resolution-8 cell. Malaysian cells measure 0.714-0.880 km² and
 * populated ones cluster near the top of that; the exact figure only sets the
 * gain below, which is a smoothing choice rather than a reported number.
 */
export const CELL_AREA_M2 = 0.86e6;

/**
 * What one cell contributes once the kernels overlap — and the reason widening
 * the radius is not a one-line change.
 *
 * With additive compositing, a point inside a uniform field receives a
 * contribution from every cell within INFLUENCE_METRES, not just its own. A
 * linear falloff integrates to pi*R^2/3, so at this radius each point collects
 * roughly 2.7 cells' worth. Left unscaled, that multiplies the whole surface
 * by 2.7 and paints the national median as fully saturated red — the
 * calibration silently destroyed by a change that only looks cosmetic.
 *
 * Dividing it back out restores the intended claim: A UNIFORM FIELD of cells
 * at the national 90th percentile is what saturates. An isolated dense cell
 * surrounded by empty land stays cooler, which is correct — smoothed over
 * 1.5km it genuinely holds fewer people per km².
 */
export const KERNEL_GAIN = CELL_AREA_M2 / ((Math.PI * INFLUENCE_METRES * INFLUENCE_METRES) / 3);

/** 256-entry lookup, built once: colourAt() per pixel would be far too slow. */
const buildLut = (at: (percentile: number) => string) => {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i += 1) {
    const rgb = at(i / 255).match(/\d+/g);
    lut[i * 3] = Number(rgb?.[0] ?? 0);
    lut[i * 3 + 1] = Number(rgb?.[1] ?? 0);
    lut[i * 3 + 2] = Number(rgb?.[2] ?? 0);
  }
  return lut;
};

const GRADIENTS = {
  /** The heatmap page's ramp. Default, so that page is unaffected. */
  traffic: buildLut(colourAt),
  /**
   * Single hue, for drawing this surface beside the score colours on
   * `/analysis`, where green already means "this dimension scores well".
   */
  mono: buildLut(colourAtMono),
} as const;

export type HeatRamp = keyof typeof GRADIENTS;

/** Below this the surface fades out entirely rather than tinting empty land. */
const FLOOR = 8;

/**
 * Opacity is a legibility budget, not a style choice.
 *
 * Central KL's median cell is top-decile nationally, so most of a city frame
 * is legitimately saturated — at the original 84% ceiling the basemap vanished
 * and the page stopped being a tool. The heatmap page settled at ~67%. The
 * Location map needs the basemap MORE, not less: streets place the competitor
 * pins and the two rings, so it takes a lower ceiling again.
 *
 * Alpha out of 255, not a fraction: `traffic` is the exact 170 this shipped
 * with, and rounding a 0.67 would have moved it to 171 — a change to the
 * heatmap page smuggled in by a refactor that was supposed to leave it alone.
 */
const CEILING = { traffic: 170, mono: 128 } as const;

export function HeatLayer({
  cells,
  ramp = "traffic",
}: {
  cells: HeatmapCell[];
  ramp?: HeatRamp;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || typeof google === "undefined" || cells.length === 0) return;

    const gmap = map;
    const gradient = GRADIENTS[ramp];
    const ceiling = CEILING[ramp];

    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.pointerEvents = "none";

    class HeatOverlay extends google.maps.OverlayView {
      override onAdd() {
        // Below the marker panes, so pins and the invisible hit layer above
        // it still receive their clicks.
        this.getPanes()?.overlayLayer.appendChild(canvas);
      }

      override onRemove() {
        canvas.remove();
      }

      override draw() {
        const projection = this.getProjection();
        const bounds = gmap.getBounds();
        if (!projection || !bounds) return;

        const sw = projection.fromLatLngToDivPixel(bounds.getSouthWest());
        const ne = projection.fromLatLngToDivPixel(bounds.getNorthEast());
        if (!sw || !ne) return;

        const width = Math.abs(ne.x - sw.x);
        const height = Math.abs(sw.y - ne.y);
        if (width === 0 || height === 0) return;

        const left = Math.min(sw.x, ne.x);
        const top = Math.min(sw.y, ne.y);

        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        canvas.style.left = `${left}px`;
        canvas.style.top = `${top}px`;

        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.scale(ratio, ratio);
        ctx.clearRect(0, 0, width, height);

        /**
         * Metres to pixels, measured from the projection rather than assumed.
         * Uses the map's own north-south span, so it stays correct at any
         * latitude and zoom without a Mercator constant of our own.
         */
        const spanMetres =
          google.maps.geometry?.spherical?.computeDistanceBetween?.(
            bounds.getSouthWest(),
            new google.maps.LatLng(bounds.getNorthEast().lat(), bounds.getSouthWest().lng()),
          ) ?? 0;
        const pxPerMetre = spanMetres > 0 ? height / spanMetres : 0;
        const radius = Math.max(6, INFLUENCE_METRES * pxPerMetre);

        // Pass one: accumulate weight in greyscale. `lighter` is what makes
        // neighbouring cells add up rather than the last one winning.
        ctx.globalCompositeOperation = "lighter";

        for (const cell of cells) {
          const point = projection.fromLatLngToDivPixel(
            new google.maps.LatLng(cell.lat, cell.lng),
          );
          if (!point) continue;

          const x = point.x - left;
          const y = point.y - top;
          if (x < -radius || y < -radius || x > width + radius || y > height + radius) continue;

          const weight = weightFor(cell.population) * KERNEL_GAIN;
          if (weight <= 0) continue;

          const falloff = ctx.createRadialGradient(x, y, 0, x, y, radius);
          falloff.addColorStop(0, `rgba(0,0,0,${weight})`);
          falloff.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = falloff;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.globalCompositeOperation = "source-over";

        // Pass two: alpha becomes a position on the ramp. Fully saturated
        // pixels are already clamped by the canvas at 255, which is exactly
        // the national ceiling weightFor() was scaled against.
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = image.data;

        for (let i = 0; i < px.length; i += 4) {
          const alpha = px[i + 3] as number;
          if (alpha < FLOOR) {
            px[i + 3] = 0;
            continue;
          }
          px[i] = gradient[alpha * 3] as number;
          px[i + 1] = gradient[alpha * 3 + 1] as number;
          px[i + 2] = gradient[alpha * 3 + 2] as number;
          /**
           * Opacity, and it has to leave the basemap legible.
           *
           * The surface now covers the whole viewport rather than a box in the
           * middle of it, and a city like Kuala Lumpur is dense enough that
           * most of the frame sits in the national top decile — so at the
           * original 84% ceiling the map underneath simply disappeared, and a
           * heat layer you cannot read street names through is a picture
           * rather than a tool. Capped well below opaque, and the faint end
           * stays faint so "almost nobody lives here" reads as bare map.
           *
           * The ceiling is per-ramp: the Location map carries competitor pins
           * and two rings that have to stay readable against it, so it gets a
           * lower one still.
           */
          px[i + 3] = Math.min(ceiling, 24 + alpha * 0.58);
        }

        ctx.putImageData(image, 0, 0);
      }
    }

    const overlay = new HeatOverlay();
    overlay.setMap(gmap);
    return () => overlay.setMap(null);
  }, [map, cells, ramp]);

  return null;
}
