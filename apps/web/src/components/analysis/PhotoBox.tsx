import { useState } from "react";
import { photoFor } from "./photos.js";

/**
 * The image slot on a competitor row or a property card.
 *
 * There is no API that will hand us these pictures. Google's Place photos are
 * a separate enterprise-tier SKU billed per image PER PAGE LOAD, against the
 * same thousand free calls a month the competitor search already spends, and
 * PropertyGuru's listing images are behind an edge that refuses our server.
 * Both were priced and declined. So the box is real, its fallback is designed
 * rather than apologetic, and supplied images drop into `photos.ts` without
 * anything here changing shape.
 *
 * The fallback is a brand-palette gradient with initials, hashed from a stable
 * key so the same shop is the same colour every time. Deliberately NOT a stock
 * photo: a borrowed storefront would imply we know what this place looks like,
 * on a page whose whole argument is that its figures came from somewhere
 * checkable.
 */

/** Navy and gold at varying depth. No other hues: this is the brand or nothing. */
const TILES: [string, string][] = [
  ["#003087", "#0a4bbd"],
  ["#0a4bbd", "#2f6fd0"],
  ["#123a7a", "#1e5bb0"],
  ["#8a5a00", "#f2a900"],
  ["#1b3f8f", "#4a7fd4"],
];

function tileFor(key: string, label: string) {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  const [from, to] = TILES[hash % TILES.length] as [string, string];

  // Up to two initials, which is more recognisable at a glance than an icon
  // and costs no extra asset.
  const initials =
    label
      .split(/\s+/)
      .filter((w) => /^[A-Za-z0-9]/.test(w))
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?";

  return { from, to, initials };
}

export function PhotoBox({
  id,
  label,
  src,
  shape = "square",
}: {
  /** Stable key for the colour. Same shop, same tile, every render. */
  id: string;
  label: string;
  /**
   * A remote image, when one exists — a property listing's own thumbnail.
   * Falls back to the tile if it fails to load, which it does often: the CDN
   * serving these has refused us before, and a broken-image glyph would look
   * like a defect rather than an absence.
   */
  src?: string | null;
  shape?: "square" | "wide";
}) {
  const [failed, setFailed] = useState(false);
  const photo = src ?? photoFor(id, label);
  const { from, to, initials } = tileFor(id, label);

  return (
    <span className={`photobox photobox-${shape}`} aria-hidden="true">
      {photo && !failed ? (
        <img
          src={photo}
          alt=""
          loading="lazy"
          decoding="async"
          // Keeps our URLs out of their logs. Checked before relying on it:
          // the CDN serves these without a referrer.
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          className="photobox-tile"
          style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
        >
          {initials}
        </span>
      )}
    </span>
  );
}
