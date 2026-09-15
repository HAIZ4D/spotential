import type { EventListing } from "@spotential/sim-engine";
import hariSukan from "../../../img/hari-sukan-negara.webp";
import lapanPagi from "../../../img/lapan-pagi.webp";
import lotusPopFest from "../../../img/lotus-pop-fest.webp";
import heritage from "../../../img/malaysia-food-heritage.webp";
import pestaTempatan from "../../../img/pesta-tempatan-4x4.webp";
import retroBazaar from "../../../img/retro-bazaar.webp";
import santaiArabia from "../../../img/santai-connect-arabia.webp";
import temuJanji from "../../../img/temu-janji-market.webp";
import wanitaMendunia from "../../../img/karnival-wanita-mendunia.webp";
import weekendRace from "../../../img/weekend-race-market.webp";

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
 */

const POSTERS: Record<string, string> = {
  "evt-hari-sukan-negara": hariSukan,
  "evt-heritage-matic": heritage,
  "evt-johor-lotus": lotusPopFest,
  "evt-lapan-pagi": lapanPagi,
  "evt-pesta-tempatan": pestaTempatan,
  "evt-retro-bazaar": retroBazaar,
  "evt-santai-arabia": santaiArabia,
  "evt-tjm-bayuemas": temuJanji,
  "evt-wanita-mendunia": wanitaMendunia,
  "evt-weekend-race-market": weekendRace,
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
  "evt-hari-sukan-negara": 560,
  "evt-heritage-matic": 594,
  "evt-johor-lotus": 629,
  "evt-lapan-pagi": 583,
  "evt-pesta-tempatan": 344,
  "evt-retro-bazaar": 558,
  "evt-santai-arabia": 625,
  "evt-tjm-bayuemas": 525,
  "evt-wanita-mendunia": 630,
  "evt-weekend-race-market": 525,
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
