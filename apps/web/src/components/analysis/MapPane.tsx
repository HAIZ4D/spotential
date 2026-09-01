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
  demand = false,
  onDemandChange,
  demandState = "loading",
  onBoundsChange,
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
  /**
   * The population surface, on or off.
   *
   * State lives with the caller because it drives more than this pane: the fit
   * radius widens with it, and the grid is only fetched while it is on. The
   * toggle is hidden entirely when no handler is passed.
   */
  demand?: boolean;
  onDemandChange?: (next: boolean) => void;
  /**
   * Whether the surface is actually on screen.
   *
   * Three states, not two: a grid still loading and a grid that failed look
   * identical on the map — both are a bare basemap — and the note has to say
   * which, or it describes a gradient nobody can see.
   */
  demandState?: "loading" | "ready" | "failed";
  /** Passed straight through: the demand layers describe the visible box. */
  onBoundsChange?: (bounds: { west: number; south: number; east: number; north: number }) => void;
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

        {/* Only on the map, and only when the caller offers it — Street View
            has no surface to draw on, and neither does the fallback pane. */}
        {onDemandChange && view === "map" && !disabled ? (
          <button
            type="button"
            className="demand-toggle"
            aria-pressed={demand}
            onClick={() => onDemandChange(!demand)}
          >
            <span className="demand-swatch" aria-hidden="true" />
            Demand
          </button>
        ) : null}

        <span className="tiny muted">
          {view === "map" ? "click or drag the pin to move it" : "drag to look around"}
        </span>
      </div>

      <div className="mappane-frame">
        {disabled ? (
          disabled
        ) : view === "map" ? (
          <LocationMap
            location={location}
            onPick={onPick}
            fitRadiusMetres={fitRadiusMetres}
            {...(onBoundsChange ? { onBoundsChange } : {})}
          >
            {overlays}
          </LocationMap>
        ) : (
          <StreetViewPanel location={location} bare />
        )}
      </div>

      {legend && view === "map" && !disabled && legend}

      {/**
        * What the surface is, and what it is not.
        *
        * This page paints green for a dimension that scores well, so a
        * population layer sitting beside it has to say outright that it
        * carries no verdict. It also names the panel figure it corroborates:
        * the catchment on this page is computed from this exact grid, which is
        * the whole reason the layer is worth drawing here.
        */}
      {demand && view === "map" && !disabled ? (
        <p className={`demand-note${demandState === "failed" ? " is-failed" : ""}`}>
          {demandState === "ready" ? (
            <span>
              <b>Red is where the most people live, green the fewest</b>, and green does{" "}
              <b>not</b> mean space to open, it means almost nobody is there. From the same 400m
              grid behind the people-within figure on this page. It says nothing about competition
              or rent; the Demand tab has the full scale.
            </span>
          ) : demandState === "failed" ? (
            /* Never describe a surface that is not on screen. The note above
               explains a gradient; printed over a blank map it would be
               describing something the reader cannot see. */
            <span>
              <b>The population grid could not be loaded</b>, so nothing is shaded. The score and
              the catchment figure on this page are unaffected, because they were computed before this.
            </span>
          ) : (
            <span>Loading the population grid…</span>
          )}
        </p>
      ) : null}

      <div className="mappane-foot">
        <span className="coords">{formatLatLng(location)}</span>
        <span>
          The address bar keeps this spot, so the link is shareable exactly like a scenario.
        </span>
      </div>
    </div>
  );
}
