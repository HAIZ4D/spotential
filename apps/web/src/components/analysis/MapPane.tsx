import { useState, type ReactNode } from "react";
import { formatLatLng, type PickedLocation } from "../../lib/location.js";
import { LocationMap } from "../LocationMap.js";
import { StreetViewPanel } from "../StreetViewPanel.js";

/**
 * The map pane — top right, and much bigger.
 *
 * Two changes from the old page. The map was 370px tall and stacked above six
 * panels; here it is roughly two-thirds of the viewport and STICKY, so it
 * stays put while the information column scrolls past it — which is the point
 * of a map on a page like this. And Street View, previously a separate 260px
 * card at the very bottom that nobody scrolled to, shares this frame behind a
 * toggle, so the eye-level view of the street is one click away instead of
 * 2,000 pixels down.
 */
export function MapPane({
  location,
  onPick,
  overlays,
  disabled,
  legend,
  fitRadiusMetres,
}: {
  location: PickedLocation;
  onPick: (next: { lat: number; lng: number }) => void;
  /** Competitor pins and the radius circle, layered in by the caller. */
  overlays?: ReactNode;
  /** Rendered instead of the map when Maps could not load. */
  disabled?: ReactNode;
  /** Explains the rings. Hidden on Street View, where they do not apply. */
  legend?: ReactNode;
  /** Frames the map on the search circle rather than a fixed zoom. */
  fitRadiusMetres?: number | undefined;
}) {
  const [view, setView] = useState<"map" | "street">("map");

  return (
    <div className="mappane">
      <div className="mappane-head">
        <div className="segmented">
          <button
            type="button"
            aria-pressed={view === "map"}
            onClick={() => setView("map")}
            disabled={Boolean(disabled)}
          >
            Map
          </button>
          <button
            type="button"
            aria-pressed={view === "street"}
            onClick={() => setView("street")}
            disabled={Boolean(disabled)}
          >
            Street View
          </button>
        </div>

        <span className="tiny muted">
          {view === "map" ? "click or drag the pin to move it" : "drag to look around"}
        </span>
      </div>

      <div className="mappane-frame">
        {disabled ? (
          disabled
        ) : view === "map" ? (
          <LocationMap location={location} onPick={onPick} fitRadiusMetres={fitRadiusMetres}>
            {overlays}
          </LocationMap>
        ) : (
          <StreetViewPanel location={location} bare />
        )}
      </div>

      {legend && view === "map" && !disabled && legend}

      <div className="mappane-foot">
        <span className="coords">{formatLatLng(location)}</span>
        <span>
          The address bar keeps this spot, so the link is shareable exactly like a scenario.
        </span>
      </div>
    </div>
  );
}
