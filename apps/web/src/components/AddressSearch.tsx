import { useState } from "react";
import { useMapsLibrary } from "@vis.gl/react-google-maps";
import type { PickedLocation } from "../lib/location.js";

/**
 * Address to coordinates.
 *
 * Client-side geocoding for this slice. Server-side Places search arrives in
 * 1b, where caching in PostGIS is what keeps per-call cost down — there is
 * nothing worth caching about a single address the user just typed.
 *
 * Biased to Malaysia so "Bangsar" resolves to the KL neighbourhood rather than
 * somewhere else with a similar name.
 */
export function AddressSearch({
  onPick,
  compact = false,
}: {
  onPick: (location: PickedLocation) => void;
  /** Renders inline for the location page's toolbar, without card chrome. */
  compact?: boolean;
}) {
  const geocodingLibrary = useMapsLibrary("geocoding");
  const [query, setQuery] = useState("");
  const [state, setState] = useState<"idle" | "searching" | "notFound" | "failed">("idle");

  const search = async () => {
    const text = query.trim();
    if (!text || !geocodingLibrary || state === "searching") return;

    setState("searching");
    try {
      const geocoder = new geocodingLibrary.Geocoder();
      const { results } = await geocoder.geocode({
        address: text,
        componentRestrictions: { country: "MY" },
      });

      const best = results[0];
      if (!best) {
        setState("notFound");
        return;
      }

      const { lat, lng } = best.geometry.location.toJSON();
      onPick({ lat, lng, label: best.formatted_address });
      setState("idle");
    } catch (error) {
      // ZERO_RESULTS arrives as a rejection, so separate "nothing matched"
      // from "the service is unhappy" — they need different messages.
      const message = error instanceof Error ? error.message : "";
      setState(message.includes("ZERO_RESULTS") ? "notFound" : "failed");
    }
  };

  const disabled = !geocodingLibrary || state === "searching";

  const form = (
      <>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
          style={{ display: "flex", gap: 6 }}
        >
          <input
            type="text"
            aria-label="Address or place"
            placeholder="e.g. Jalan Telawi, Bangsar"
            value={query}
            maxLength={200}
            onChange={(e) => {
              setQuery(e.target.value);
              if (state !== "idle") setState("idle");
            }}
            style={{
              flex: 1,
              padding: "7px 9px",
              border: "1px solid var(--line)",
              borderRadius: 7,
              font: "inherit",
            }}
          />
          <button type="submit" className="primary" disabled={disabled || !query.trim()}>
            {state === "searching" ? "…" : "Search"}
          </button>
        </form>

        {state === "notFound" && (
          <div className="notice warn">
            No match for that address in Malaysia. Try a nearby landmark, or click the map to drop
            the pin yourself.
          </div>
        )}

        {state === "failed" && (
          <div className="notice danger">
            The geocoding service could not be reached. You can still click the map to place the
            pin.
          </div>
        )}

        {!compact && (
          <span className="tiny muted">
            You can also click anywhere on the map, or drag the pin. That helps when the shoplot has no
            address the geocoder recognises.
          </span>
        )}
      </>
  );

  // The location page puts this straight in its toolbar; a card inside a
  // toolbar row would be a box inside a box.
  if (compact) return form;

  return (
    <section className="card">
      <header>
        <h2>Find a location</h2>
      </header>
      <div className="body stack">{form}</div>
    </section>
  );
}
