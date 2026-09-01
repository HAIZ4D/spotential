import { useEffect } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import type { AmenityLayer } from "../../lib/api.js";
import type { DistrictPreset } from "@spotential/sim-engine";

/**
 * Demand generators and rent benchmarks, over the density surface.
 *
 * Deliberately drawn as small symbols rather than full map pins: there can be
 * a couple of hundred at once, and Google's teardrop marker at that count
 * reads as a swarm covering the very surface you are trying to see.
 */

/** One glyph per layer. Kept short — these render inside a 20px circle. */
const GLYPHS: Record<string, string> = {
  rail: "🚆",
  mall: "🛍",
  university: "🎓",
  healthcare: "✚",
};

export function AmenityPins({ layers, active }: { layers: AmenityLayer[]; active: Set<string> }) {
  const map = useMap();

  useEffect(() => {
    if (!map || typeof google === "undefined") return;

    const markers: google.maps.Marker[] = [];

    for (const layer of layers) {
      if (!active.has(layer.id)) continue;

      for (const point of layer.points) {
        markers.push(
          new google.maps.Marker({
            map,
            position: { lat: point.lat, lng: point.lng },
            title: point.name ? `${point.name}, ${layer.label}` : layer.label,
            label: {
              text: GLYPHS[layer.id] ?? "•",
              fontSize: "11px",
            },
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 9,
              fillColor: "#ffffff",
              fillOpacity: 0.95,
              strokeColor: "#003087",
              strokeWeight: 1.5,
            },
            zIndex: 5,
          }),
        );
      }
    }

    return () => markers.forEach((marker) => marker.setMap(null));
  }, [map, layers, active]);

  return null;
}

/**
 * The 23 curated rent benchmarks.
 *
 * Free to draw — the data already ships in the bundle for the simulator's
 * district selector. Worth drawing because demand and cost on one screen is
 * the actual decision an SME is making, and this page previously showed only
 * half of it.
 *
 * Labelled with RM/sqft rather than a name: the name is on the basemap, the
 * price is the thing you came for.
 */
export function RentPins({
  districts,
  show,
  onSelect,
}: {
  districts: DistrictPreset[];
  show: boolean;
  onSelect: (district: DistrictPreset) => void;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || !show || typeof google === "undefined") return;

    const markers = districts.map((district) => {
      const marker = new google.maps.Marker({
        map,
        position: district.centre,
        title: `${district.label}, RM${district.rentMedianPsf}/sqft (${district.source})`,
        label: {
          text: `RM${district.rentMedianPsf}`,
          fontSize: "10px",
          fontWeight: "700",
          // Gold is light, so its label is always dark text.
          color: "#3d2b00",
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 15,
          fillColor: "#f2a900",
          fillOpacity: 0.95,
          strokeColor: "#b57f00",
          strokeWeight: 1.5,
        },
        zIndex: 6,
      });

      marker.addListener("click", () => onSelect(district));
      return marker;
    });

    return () => markers.forEach((marker) => marker.setMap(null));
  }, [map, districts, show, onSelect]);

  return null;
}
