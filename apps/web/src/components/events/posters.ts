import type { EventListing } from "@spotential/sim-engine";
import childrensDay from "../../../img/childrens-day-prima-avenue.webp";
import kandaqFest from "../../../img/kandaq-fest-kl.webp";
import luminareRaya from "../../../img/luminare-bazaar-raya-2027.webp";
import pestaKopiKita from "../../../img/pesta-kopi-kita-2026.webp";
import pestaMorib from "../../../img/pesta-morib-2026.webp";
import pestaTempatan from "../../../img/pesta-tempatan-4x4.webp";
import publikaSeoul from "../../../img/publika-seoul-street-market.webp";
import santaiLights from "../../../img/santai-connect-festival-of-lights.webp";
import terangMalam from "../../../img/terang-malam-market-subang-parade.webp";
import temuJanjiArtPlay from "../../../img/temu-janji-market-art-and-play.webp";
import temuJanjiSenjaBali from "../../../img/temu-janji-market-senja-bali.webp";

/**
 * Event posters.
 *
 * EVERY seeded listing now has one, and that is deliberate: the catalogue was
 * cut from fourteen to eight rather than padding it with listings that had no
 * artwork behind them. Where a poster states a fact — dates, venue, opening
 * hours, who is being recruited — the listing was edited to match the poster
 * rather than the other way round.
 *
 * They are the organizers' own artwork, shown whole. Most are portrait by
 * design and the card is built around that shape rather than cropping them to
 * a landscape strip, which would cut off the title: the one part a vendor
 * scans for.
 *
 * The generated cover below is now the ORGANIZER-SUBMISSION path rather than a
 * seed fallback. It stays because an organizer can publish an event without
 * artwork, and the honest answer to that is still not a stock photo: a generic
 * crowd shot would imply we know what the event looks like, on a page whose
 * whole argument is that its figures came from somewhere checkable.
 *
 * FINISHED EVENTS ARE RETIRED, poster and listing together. On 2026-11-18 the
 * twelve that had ended left the catalogue, this map and `img/` in one change,
 * so a poster never outlives its listing and a listing never loses its poster.
 */

const POSTERS: Record<string, string> = {
  "evt-childrens-day-prima": childrensDay,
  "evt-kandaq-fest": kandaqFest,
  "evt-luminare-raya": luminareRaya,
  "evt-pesta-kopi-kita": pestaKopiKita,
  "evt-pesta-morib": pestaMorib,
  "evt-pesta-tempatan": pestaTempatan,
  "evt-publika-seoul": publikaSeoul,
  "evt-santai-lights": santaiLights,
  "evt-terang-malam-subang": terangMalam,
  "evt-tjm-art-play": temuJanjiArtPlay,
  "evt-tjm-senja-bali": temuJanjiSenjaBali,
};

/**
 * Intrinsic height at the shipped width of 420px.
 *
 * Versioned constants rather than a build step, which is this project's
 * pattern for anything that changes as slowly as an image file does.
 *
 * THE PAGE NEEDS THE REAL RATIO, not an assumed one. These run from 0.67 to
 * 1.22 — `pesta-tempatan-4x4` is the only landscape poster in the set — so a
 * single hardcoded `aspect-ratio` would letterbox nine of them and crop the
 * tenth. Declaring the true width and height on the `<img>` lets the browser
 * reserve exactly the right box before the file arrives, which is what stops
 * the stage jolting as it loads.
 */
const POSTER_HEIGHTS: Record<string, number> = {
  "evt-childrens-day-prima": 527,
  "evt-kandaq-fest": 520,
  "evt-luminare-raya": 244,
  "evt-pesta-kopi-kita": 525,
  "evt-pesta-morib": 525,
  "evt-pesta-tempatan": 344,
  "evt-publika-seoul": 525,
  "evt-santai-lights": 525,
  "evt-terang-malam-subang": 630,
  "evt-tjm-art-play": 630,
  "evt-tjm-senja-bali": 525,
};

export const POSTER_WIDTH = 420;

export function posterFor(event: EventListing): string | null {
  return POSTERS[event.id] ?? null;
}

/** Null when there is no poster, so a caller cannot reserve space for nothing. */
export function posterSizeFor(event: EventListing): { width: number; height: number } | null {
  const height = POSTER_HEIGHTS[event.id];
  return height === undefined ? null : { width: POSTER_WIDTH, height };
}

/**
 * A stable colour pair per event, drawn only from the brand palette.
 *
 * Hashed from the id so a given event always looks the same — a cover that
 * changed between renders would read as a loading glitch. Every pair is navy
 * or gold at varying depth; no new hues enter the product through the back
 * door of a placeholder.
 */
const COVERS: [string, string][] = [
  ["#003087", "#0a4bb5"],
  ["#00205c", "#1466c4"],
  ["#0a4bb5", "#3b82d9"],
  ["#00205c", "#003087"],
  ["#8a5a00", "#f2a900"],
  ["#003087", "#1466c4"],
];

export function coverFor(event: EventListing): { from: string; to: string; initials: string } {
  let hash = 0;
  for (let i = 0; i < event.id.length; i += 1) {
    hash = (hash * 31 + event.id.charCodeAt(i)) >>> 0;
  }
  const [from, to] = COVERS[hash % COVERS.length] as [string, string];

  // Up to two initials from the event name, which is more recognisable at a
  // glance than a generic icon and needs no extra asset.
  const initials = event.name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return { from, to, initials };
}
