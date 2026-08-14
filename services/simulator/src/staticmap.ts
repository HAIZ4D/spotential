import { roundForCache, type LatLng } from "@spotential/sim-engine";
import { QuotaTracker, type QuotaConfig } from "./quota.js";

/**
 * Static map images for PDF reports — Feature 4.
 *
 * Google Static Maps bills per image, so this is the only part of a report
 * that costs money. Three guards, in the same shape as the Places controls:
 *
 *   1. Coordinates are ROUNDED to the shared cache precision, so the same spot
 *      always produces byte-identical request URLs.
 *   2. Results are cached in memory by that rounded key, so repeat reports of
 *      one site are free for the life of the instance.
 *   3. A daily ceiling on uncached fetches, independent of the Places one.
 *
 * FAILS SOFT, and that is the opposite of the rule for the competitor cache.
 * A missing map costs nothing and degrades a report; a missing cache silently
 * multiplies the bill. So a map failure produces a report without a map and a
 * one-line note, never a failed report — while the CONFIGURED state is still
 * reported on /health so a misconfiguration is visible rather than silent.
 */

export interface StaticMapConfig {
  apiKey: string;
  quota?: QuotaTracker;
}

export interface MapResult {
  dataUri: string | null;
  note: string | null;
}

/** Google caps a Static Maps URL at 2048 characters; three markers is nowhere near. */
const SIZE = "620x300";
const SCALE = 2;

const NAVY = "0x003087";

/** Instance-lifetime cache. Bounded so a long-lived instance cannot grow without limit. */
const MAX_CACHED = 60;
const cache = new Map<string, string>();

function remember(key: string, dataUri: string): void {
  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, dataUri);
}

export class StaticMapFetcher {
  private quota: QuotaTracker;

  constructor(
    private config: StaticMapConfig,
    quotaConfig?: QuotaConfig,
  ) {
    this.config.quota ??= new QuotaTracker(
      quotaConfig ?? { perCallerPerDay: 40, globalPerDay: 300 },
    );
    this.quota = this.config.quota;
  }

  /**
   * One image for one to three points.
   *
   * A comparison gets a single map with several markers rather than one map
   * each: it is one billable call instead of three, and seeing the sites
   * relative to one another is more useful than seeing them separately.
   */
  async fetch(points: LatLng[], callerId: string): Promise<MapResult> {
    if (points.length === 0) return { dataUri: null, note: null };

    const rounded = points.map((p) => ({
      lat: roundForCache(p.lat),
      lng: roundForCache(p.lng),
    }));
    const key = rounded.map((p) => `${p.lat},${p.lng}`).join("|");

    const cached = cache.get(key);
    if (cached) return { dataUri: cached, note: "Map data © Google." };

    const allowed = this.quota.check(callerId);
    if (!allowed.allowed) {
      return {
        dataUri: null,
        note: "Map omitted — today's map limit was reached. Every figure in this report is unaffected.",
      };
    }

    const params = new URLSearchParams({ size: SIZE, scale: String(SCALE), maptype: "roadmap" });
    rounded.forEach((p, index) => {
      // Labelled A, B, C so the markers tie back to the table on the next page.
      const label = points.length > 1 ? String.fromCharCode(65 + index) : "";
      params.append(
        "markers",
        `color:${NAVY}${label ? `|label:${label}` : ""}|${p.lat},${p.lng}`,
      );
    });
    if (rounded.length === 1) {
      params.set("zoom", "16");
    } else {
      // Google fits the viewport EXACTLY to the markers, which puts every pin
      // hard against an edge and clips the outermost ones in half. There is no
      // padding parameter, so pad the bounds explicitly with two invisible
      // corner points.
      const lats = rounded.map((p) => p.lat);
      const lngs = rounded.map((p) => p.lng);
      const padLat = Math.max((Math.max(...lats) - Math.min(...lats)) * 0.25, 0.01);
      const padLng = Math.max((Math.max(...lngs) - Math.min(...lngs)) * 0.25, 0.01);

      params.append("visible", `${Math.min(...lats) - padLat},${Math.min(...lngs) - padLng}`);
      params.append("visible", `${Math.max(...lats) + padLat},${Math.max(...lngs) + padLng}`);
    }
    params.set("key", this.config.apiKey);

    try {
      const response = await fetch(`https://maps.googleapis.com/maps/api/staticmap?${params}`);
      if (!response.ok) {
        return {
          dataUri: null,
          note: `Map unavailable (${response.status}). Every figure in this report is unaffected.`,
        };
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      const dataUri = `data:image/png;base64,${bytes.toString("base64")}`;

      // Recorded only on a real fetch, so cache hits never consume the ceiling.
      this.quota.record(callerId);
      remember(key, dataUri);

      return { dataUri, note: "Map data © Google." };
    } catch {
      return {
        dataUri: null,
        note: "Map unavailable — the map service could not be reached. Every figure in this report is unaffected.",
      };
    }
  }
}

/** Used when no key is configured: reports still render, and /health says why. */
export const NO_MAP: MapResult = {
  dataUri: null,
  note: "Map omitted — no map key is configured for this deployment.",
};
