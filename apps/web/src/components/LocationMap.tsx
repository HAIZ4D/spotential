import { AdvancedMarker, Map, Pin, useMap } from "@vis.gl/react-google-maps";
import { useEffect, type ReactNode } from "react";
import { DEFAULT_ZOOM, type PickedLocation } from "../lib/location.js";

/**
 * The map, with the candidate spot marked.
 *
 * Two ways to move the pin, because an SME often knows the shoplot by sight
 * rather than by a postal address the geocoder would recognise: click anywhere,
 * or drag the marker.
 */
export function LocationMap({
  location,
  onPick,
  fitRadiusMetres,
  children,
  onBoundsChange,
}: {
  location: PickedLocation;
  onPick: (next: { lat: number; lng: number }) => void;
  /**
   * Frame the view on a search circle of this radius instead of a fixed zoom.
   *
   * A hardcoded zoom 16 meant a 500m circle floated in a sea of unrelated map
   * while 2km would have overflowed the frame. Passing bounds rather than
   * calling fitBounds later matters: @vis.gl re-applies `defaultZoom` after
   * mount, so an imperative fit was silently reverted within a few hundred
   * milliseconds — verified by logging the zoom before and after.
   */
  fitRadiusMetres?: number | undefined;
  /** Competitor pins and the radius circle are layered in by the caller. */
  children?: ReactNode;
  /**
   * Reports the visible box whenever the camera settles.
   *
   * The demand layers describe what is on screen, so they need the real
   * viewport rather than a box derived from the search radius — that is what
   * lets zooming out give a city view instead of a fixed neighbourhood.
   */
  onBoundsChange?: (bounds: { west: number; south: number; east: number; north: number }) => void;
}) {
  // Padding so the ring is not flush against the frame edge.
  const latPad = fitRadiusMetres ? (fitRadiusMetres * 1.18) / 110_574 : 0;
  const lngPad = fitRadiusMetres
    ? (fitRadiusMetres * 1.18) / (111_320 * Math.cos((location.lat * Math.PI) / 180))
    : 0;

  const framing = fitRadiusMetres
    ? {
        defaultBounds: {
          north: location.lat + latPad,
          south: location.lat - latPad,
          east: location.lng + lngPad,
          west: location.lng - lngPad,
        },
      }
    : { defaultCenter: { lat: location.lat, lng: location.lng }, defaultZoom: DEFAULT_ZOOM };

  return (
    <Map
      mapId="spotential-analysis"
      // Whole zoom levels double the scale each step, which is far too coarse
      // to frame a circle of arbitrary radius.
      isFractionalZoomEnabled
      {...framing}
      gestureHandling="greedy"
      disableDefaultUI={false}
      mapTypeControl={false}
      streetViewControl={false}
      fullscreenControl={false}
      onClick={(event) => {
        const latLng = event.detail.latLng;
        if (latLng) onPick({ lat: latLng.lat, lng: latLng.lng });
      }}
      style={{ width: "100%", height: "100%" }}
    >
      <AdvancedMarker
        position={{ lat: location.lat, lng: location.lng }}
        draggable
        onDragEnd={(event) => {
          const latLng = event.latLng;
          if (latLng) onPick({ lat: latLng.lat(), lng: latLng.lng() });
        }}
        title={location.label}
      >
        {/* Navy pin with the gold accent, per the CLAUDE.md palette. */}
        <Pin background="#003087" borderColor="#00205c" glyphColor="#f2a900" scale={1.2} />
      </AdvancedMarker>

      {children}
      <RecenterOn location={location} />
      {onBoundsChange ? <ReportBounds onChange={onBoundsChange} /> : null}
    </Map>
  );
}

/**
 * Follow the location when it changes from OUTSIDE the map — a geocoded
 * address or a shared link. Uses defaultCenter above rather than a controlled
 * center so that panning by hand is not fought by React re-renders.
 */
function RecenterOn({ location }: { location: PickedLocation }) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    map.panTo({ lat: location.lat, lng: location.lng });
  }, [map, location.lat, location.lng]);

  return null;
}

/**
 * Reports the visible box on `idle`, not on every camera frame.
 *
 * `bounds_changed` fires continuously through a pan and a zoom animation;
 * `idle` fires once the camera has settled, which is the only moment the box
 * is worth acting on. Anything downstream is debounced and bucketed on top of
 * this, because a slow drag still settles many times.
 */
function ReportBounds({
  onChange,
}: {
  onChange: (bounds: { west: number; south: number; east: number; north: number }) => void;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || typeof google === "undefined") return;

    const report = () => {
      const b = map.getBounds();
      if (!b) return;
      const sw = b.getSouthWest();
      const ne = b.getNorthEast();
      onChange({ west: sw.lng(), south: sw.lat(), east: ne.lng(), north: ne.lat() });
    };

    report();
    const listener = map.addListener("idle", report);
    return () => listener.remove();
  }, [map, onChange]);

  return null;
}
