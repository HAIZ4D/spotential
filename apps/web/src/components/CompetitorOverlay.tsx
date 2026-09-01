import { useEffect, useMemo, useRef } from "react";
import { AdvancedMarker, Pin, useMap } from "@vis.gl/react-google-maps";
import { distanceMetres, type CompetitorWithDistance, type LatLng } from "@spotential/sim-engine";

/**
 * Competitor pins and the search rings, drawn over the map.
 *
 * Competitors are gold with dark glyphs and the candidate spot stays navy, so
 * at a glance you can tell your prospective site from everyone else's.
 */

/**
 * Below this, two pins are the same pixel at usable zoom levels.
 *
 * At KLCC all twenty results sit inside 52m and land on eight distinct
 * positions — they are restaurants in one mall — so twelve of them were
 * invisible, stacked underneath the others. The map looked far emptier than
 * the data actually was.
 */
const COLLIDE_METRES = 18;

/**
 * How far a fanned pin sits from its true position.
 *
 * Clamped against the complete-to radius: at KLCC that is 52m, and a 22m fan
 * pushed pins past the green ring — drawing outlets in the zone the legend
 * calls unsearched. The picture must not imply knowledge the data does not
 * have, even by a few pixels.
 */
const FAN_METRES = 22;
const FAN_SHARE_OF_COMPLETE = 0.25;

interface Placed extends CompetitorWithDistance {
  /** Where the pin is drawn. Equals the true position unless it was fanned. */
  drawLat: number;
  drawLng: number;
  fanned: boolean;
}

/**
 * Spread pins that would otherwise sit on top of each other.
 *
 * A fanned pin is NOT where the outlet is, so each one keeps a leader line
 * back to the shared point and says so in its tooltip. The alternative —
 * leaving twelve of twenty invisible — misrepresents the data more, because a
 * reader counts pins and concludes there are eight competitors.
 */
function fanOut(
  competitors: CompetitorWithDistance[],
  completeToMetres: number | null,
): Placed[] {
  const fanMetres = completeToMetres
    ? Math.max(6, Math.min(FAN_METRES, completeToMetres * FAN_SHARE_OF_COMPLETE))
    : FAN_METRES;

  const clusters: CompetitorWithDistance[][] = [];

  for (const c of competitors) {
    const near = clusters.find(
      (group) => distanceMetres({ lat: group[0]!.lat, lng: group[0]!.lng }, c) <= COLLIDE_METRES,
    );
    if (near) near.push(c);
    else clusters.push([c]);
  }

  return clusters.flatMap((group): Placed[] => {
    if (group.length === 1) {
      const only = group[0]!;
      return [{ ...only, drawLat: only.lat, drawLng: only.lng, fanned: false }];
    }

    // Ring the shared point. Degrees of longitude shrink with latitude, so the
    // fan would look like an ellipse without the cosine correction.
    const anchor = group[0]!;
    const dLat = fanMetres / 110_574;
    const dLng = fanMetres / (111_320 * Math.cos((anchor.lat * Math.PI) / 180));

    return group.map((c, index) => {
      const angle = (2 * Math.PI * index) / group.length;
      return {
        ...c,
        drawLat: c.lat + dLat * Math.sin(angle),
        drawLng: c.lng + dLng * Math.cos(angle),
        fanned: true,
      };
    });
  });
}

export function CompetitorPins({
  competitors,
  completeToMetres = null,
  hoveredId = null,
}: {
  competitors: CompetitorWithDistance[];
  /** Keeps the fan inside the ring the legend calls complete. */
  completeToMetres?: number | null;
  /** The row under the cursor, so its pin stands out. The two panes sit side
   *  by side, so this ties the list and the map into one view. */
  hoveredId?: string | null;
}) {
  const map = useMap();
  const placed = useMemo(
    () => fanOut(competitors, completeToMetres),
    [competitors, completeToMetres],
  );

  // Leader lines from each fanned pin back to where the outlet actually is.
  useEffect(() => {
    if (!map || typeof google === "undefined") return;

    const lines = placed
      .filter((p) => p.fanned)
      .map(
        (p) =>
          new google.maps.Polyline({
            map,
            path: [
              { lat: p.lat, lng: p.lng },
              { lat: p.drawLat, lng: p.drawLng },
            ],
            strokeColor: "#b57f00",
            strokeOpacity: 0.7,
            strokeWeight: 1.25,
            clickable: false,
          }),
      );

    return () => lines.forEach((line) => line.setMap(null));
  }, [map, placed]);

  return (
    <>
      {placed.map((c) => (
        <AdvancedMarker
          key={c.id}
          position={{ lat: c.drawLat, lng: c.drawLng }}
          title={
            `${c.name}, ${c.rating ?? "unrated"} (${c.reviewCount} reviews), ${c.distanceMetres}m` +
            (c.fanned ? " · pin nudged apart from others at the same address" : "")
          }
        >
          <Pin
            background={c.id === hoveredId ? "#003087" : "#f2a900"}
            borderColor={c.id === hoveredId ? "#00205c" : "#b57f00"}
            glyphColor={c.id === hoveredId ? "#ffffff" : "#3d2b00"}
            scale={c.id === hoveredId ? 1.15 : 0.75}
          />
        </AdvancedMarker>
      ))}
    </>
  );
}

/**
 * Two rings, and the gap between them is the point.
 *
 * The outer ring is the radius you asked for. The inner one is how far the
 * results are actually COMPLETE — Places returns the nearest 20 and stops, so
 * at a dense address that can be 52m out of 500. Everything between the rings
 * was never searched.
 *
 * That distinction was previously a sentence under the panel, which is a poor
 * way to say "three quarters of this circle is unknown". Drawn, it is obvious.
 */
export function RadiusCircle({
  centre,
  radiusMetres,
  completeToMetres = null,
  fitRadiusMetres,
}: {
  centre: LatLng;
  radiusMetres: number;
  /** Null when nothing was truncated — then one ring is the honest picture. */
  completeToMetres?: number | null;
  /**
   * What to FRAME to, when that is not the search radius.
   *
   * The population surface is meaningless at the search framing — a 500m
   * circle spans about one and a half Kontur cells — so switching it on has to
   * widen the view. That could have been a second call to `setZoom`, and then
   * two things would own the camera and race whenever both changed. Instead
   * the one effect below keeps sole ownership and simply reads a different
   * number. The RING still draws at `radiusMetres`; only the framing moves.
   */
  fitRadiusMetres?: number | undefined;
}) {
  const map = useMap();
  const fittedRadius = useRef<number | null>(null);

  /**
   * Frame the map to the search area.
   *
   * Zoom was a fixed 16 whatever the radius, so a 500m circle floated in a sea
   * of unrelated map and read as a small ring in a big empty page — while 2km
   * would have overflowed the frame entirely. Fitting to the outer ring makes
   * the composition tight at every radius.
   *
   * Keyed on RADIUS only. Refitting when the centre moves would snap the view
   * out from under someone dragging the pin.
   */
  useEffect(() => {
    if (!map || typeof google === "undefined") return;
    const framing = fitRadiusMetres ?? radiusMetres;
    if (fittedRadius.current === framing) return;
    fittedRadius.current = framing;

    const bounds = new google.maps.Circle({
      center: { lat: centre.lat, lng: centre.lng },
      radius: framing,
    }).getBounds();
    if (!bounds) return;

    /**
     * Fit once the map div actually has a size.
     *
     * Two earlier attempts failed for different reasons. Calling fitBounds
     * straight from the effect ran against a zero-size viewport and silently
     * did nothing. Waiting for an "idle" event never fired at all, because by
     * the time React mounts this overlay the map has usually gone idle
     * already — so the listener sat waiting for a next idle that never came.
     *
     * Polling briefly for a laid-out div covers both.
     */
    let frame = 0;
    let tries = 0;

    const attempt = () => {
      const div = map.getDiv() as HTMLElement | null;
      if (div && div.clientWidth > 0) {
        map.fitBounds(bounds, 24);

        /**
         * fitBounds snaps to whole zoom levels, and for a 500m circle in this
         * frame the tightest integer fit leaves the ring covering barely half
         * the width — the next level up would overflow. Fractional zoom closes
         * that gap, so the search area fills the pane at any radius.
         */
        const span = 2 * framing * 1.12;
        const metresPerPx = (156_543.03392 * Math.cos((centre.lat * Math.PI) / 180)) / 2 ** 16;
        const fitted = 16 + Math.log2((div.clientWidth * metresPerPx) / span);
        if (Number.isFinite(fitted)) map.setZoom(Math.min(19, fitted));
        return;
      }
      if (tries++ < 60) frame = requestAnimationFrame(attempt);
    };

    frame = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(frame);
  }, [map, centre.lat, centre.lng, radiusMetres, fitRadiusMetres]);

  useEffect(() => {
    if (!map || typeof google === "undefined") return;

    const shapes: google.maps.Circle[] = [
      new google.maps.Circle({
        map,
        center: { lat: centre.lat, lng: centre.lng },
        radius: radiusMetres,
        strokeColor: "#003087",
        strokeOpacity: 0.45,
        strokeWeight: 1.5,
        /**
         * Almost no fill when an inner ring exists.
         *
         * A tinted band between the two rings reads as "we looked here and
         * found nothing", which is the opposite of true — nothing was looked
         * at. Reduced to a boundary line so the searched area is the only
         * part of the picture with any weight.
         */
        fillColor: "#003087",
        fillOpacity: completeToMetres ? 0.015 : 0.06,
        clickable: false,
      }),
    ];

    // Only meaningful when it is genuinely smaller than what was asked for.
    if (completeToMetres && completeToMetres < radiusMetres) {
      shapes.push(
        new google.maps.Circle({
          map,
          center: { lat: centre.lat, lng: centre.lng },
          radius: completeToMetres,
          strokeColor: "#16a34a",
          strokeOpacity: 0.95,
          strokeWeight: 2,
          fillColor: "#16a34a",
          fillOpacity: 0.14,
          clickable: false,
          zIndex: 2,
        }),
      );
    }

    return () => shapes.forEach((shape) => shape.setMap(null));
  }, [map, centre.lat, centre.lng, radiusMetres, completeToMetres]);

  return null;
}
