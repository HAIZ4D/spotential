import { useEffect, useRef, useState } from "react";
import { useMapsLibrary } from "@vis.gl/react-google-maps";
import type { LatLng } from "../lib/location.js";

/**
 * Interactive Street View.
 *
 * The tech stack names the Street View Static API, but someone deciding
 * whether to sign a lease wants to look up and down the street, not at one
 * fixed JPEG. Dynamic panorama costs roughly twice per view and volume here is
 * negligible, so the trade is worth it. Recorded as a deliberate deviation.
 *
 * Coverage in Malaysian suburban lots is patchy, so "no imagery" is a designed
 * state rather than an empty grey box that reads as a bug.
 */
export function StreetViewPanel({ location, bare = false }: { location: LatLng; bare?: boolean }) {
  const streetViewLibrary = useMapsLibrary("streetView");
  const containerRef = useRef<HTMLDivElement>(null);
  const panoramaRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "none">("loading");

  useEffect(() => {
    if (!streetViewLibrary || !containerRef.current) return;

    const service = new streetViewLibrary.StreetViewService();
    let cancelled = false;

    setStatus("loading");

    // Ask for the nearest panorama within 100m before rendering anything: the
    // panorama widget shows its own bleak "no imagery" screen otherwise.
    void service
      .getPanorama({ location, radius: 100, source: google.maps.StreetViewSource.OUTDOOR })
      .then(({ data }) => {
        if (cancelled || !containerRef.current) return;

        const panoId = data.location?.pano;
        if (!panoId) {
          setStatus("none");
          return;
        }

        if (!panoramaRef.current) {
          panoramaRef.current = new streetViewLibrary.StreetViewPanorama(containerRef.current, {
            addressControl: false,
            fullscreenControl: false,
            motionTracking: false,
            motionTrackingControl: false,
          });
        }
        panoramaRef.current.setPano(panoId);
        // Face the point the user actually picked, not wherever the car looked.
        panoramaRef.current.setPov({
          heading: headingTo(data.location?.latLng ?? undefined, location),
          pitch: 0,
        });
        panoramaRef.current.setVisible(true);
        setStatus("ok");
      })
      .catch(() => {
        if (!cancelled) setStatus("none");
      });

    return () => {
      cancelled = true;
    };
  }, [streetViewLibrary, location.lat, location.lng, location]);

  const panorama = (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {status !== "ok" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            padding: 16,
            textAlign: "center",
            background: "var(--surface)",
            color: "var(--ink-2)",
            fontSize: 13,
          }}
        >
          {status === "loading"
            ? "Looking for Street View imagery…"
            : "Google has no Street View imagery within 100m of this point. Common for newer developments and interior lots."}
        </div>
      )}
    </div>
  );

  // `bare` fills whatever frame it is given, for the location page's map pane
  // where Street View shares one large frame with the map. Without it the
  // panorama would carry a second card header inside the first.
  if (bare) return panorama;

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column" }}>
      <header>
        <h2>Street View</h2>
        {status === "none" && <span className="pill muted">no imagery here</span>}
      </header>

      <div style={{ height: 260 }}>{panorama}</div>
    </section>
  );
}

/** Point the camera at the picked spot rather than straight down the road. */
function headingTo(from: google.maps.LatLng | undefined, to: LatLng): number {
  if (!from) return 0;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const lat1 = toRad(from.lat());
  const lat2 = toRad(to.lat);
  const dLng = toRad(to.lng - from.lng());

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
