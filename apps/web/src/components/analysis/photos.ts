/**
 * Supplied photographs for competitors and rental units.
 *
 * EMPTY BY DESIGN, and it stays that way until real images arrive. Nothing
 * here is fetched: Place photos are an enterprise SKU billed per image per
 * page load, and PropertyGuru's CDN refuses our server. Both were priced and
 * declined, so the only way a picture gets here is that someone puts it here.
 *
 * To add one: drop the file in `apps/web/img/`, import it, and key it by the
 * subject's stable id or its exact name. Same pattern as the event posters.
 * Everything unmatched keeps the generated tile, which is a designed state
 * rather than a missing one.
 */

const BY_ID: Record<string, string> = {};

/** Lower-cased exact name, for subjects whose id changes between searches. */
const BY_NAME: Record<string, string> = {};

export function photoFor(id: string, label: string): string | null {
  return BY_ID[id] ?? BY_NAME[label.trim().toLowerCase()] ?? null;
}
