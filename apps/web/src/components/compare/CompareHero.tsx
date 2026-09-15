import { useRef } from "react";
import { formatNumber, type ComparedLocation, type Comparison } from "@spotential/sim-engine";
import { ScoreRing } from "../analysis/ScoreRing.js";
import { SERIES_COLOURS } from "../CompareRadar.js";
import { useReveal } from "../events/useReveal.js";

/**
 * The answer, first, and the sites beside it rather than pinned to the far
 * edge of the page.
 *
 * The verdict used to sit alone on the left with the score rings hard right,
 * leaving a corridor of dead space down the middle of the widest element on
 * the page. The events hero had exactly this and it was fixed the same way:
 * the rings become cards in the same band, each carrying a line about that
 * site rather than just a number and a name.
 *
 * EVERY SENTENCE HERE IS DERIVED, never written. The winner and the spread
 * come off the comparison object, the decisive dimension is the largest
 * measured gap, and each card's line is that site's own best and worst
 * measured axis. The ledger below reads the same object, so the two cannot
 * disagree — which is the whole reason this is computed rather than generated.
 */

/** The dimension that separates the sites most. Null when none of them do. */
function decisiveDimension(comparison: Comparison): { label: string; spread: number } | null {
  const decided = comparison.dimensions
    .filter((d) => d.outcome.kind === "winner")
    .map((d) => ({ label: d.label, spread: Math.abs((d.outcome as { spread: number }).spread) }))
    .sort((a, b) => b.spread - a.spread);

  return decided[0] ?? null;
}

/**
 * What this site is good and bad at, in its own right.
 *
 * Measured axes only: an unavailable dimension is not a weakness, and calling
 * it one would be the same mistake as drawing it as a zero-length bar.
 */
function readingFor(location: ComparedLocation): string {
  const scored = location.score.dimensions.filter((d) => d.kind !== "unavailable");
  if (scored.length === 0) return "No dimension could be measured for this site.";

  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const best = ranked[0]!;
  const worst = ranked[ranked.length - 1]!;

  if (ranked.length === 1 || Math.round(best.score) === Math.round(worst.score)) {
    return `${best.label} at ${Math.round(best.score)} is the only measured reading.`;
  }
  return `Strongest on ${best.label.toLowerCase()} (${Math.round(
    best.score,
  )}), weakest on ${worst.label.toLowerCase()} (${Math.round(worst.score)}).`;
}

export function CompareHero({
  locations,
  comparison,
}: {
  locations: ComparedLocation[];
  comparison: Comparison;
}) {
  const winner = locations.find((l) => l.id === comparison.winnerId);
  const decisive = decisiveDimension(comparison);
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref, { selector: ":scope > .cmpx-site", stagger: 0.07, y: 16 });

  return (
    <section className="cmpx-hero">
      <div className="cmpx-verdict">
        <span className="cmpx-kicker">The verdict</span>
        {winner ? (
          <>
            <h2 className="cmpx-verdict-title">{winner.label} scores highest</h2>
            <p className="cmpx-verdict-note">
              by <strong>{formatNumber(comparison.overallSpread, 1)}</strong> points
              {decisive ? (
                <>
                  , driven mostly by <strong>{decisive.label.toLowerCase()}</strong>, where the gap
                  is {formatNumber(decisive.spread, 1)}
                </>
              ) : null}
              . Dimensions marked <em>too close to call</em> below did not separate these sites at
              all.
            </p>
          </>
        ) : (
          <>
            {/* Refusing to rank is the honest outcome, not a missing feature.
                The same restraint the ledger below already shows. */}
            <h2 className="cmpx-verdict-title">Too close to call</h2>
            <p className="cmpx-verdict-note">
              The overall spread is <strong>{formatNumber(comparison.overallSpread, 1)}</strong>{" "}
              points, which is inside what these figures can support. Treat these sites as
              equivalent on the evidence here and decide on something this score does not measure.
            </p>
          </>
        )}
      </div>

      <div className="cmpx-sites" ref={ref}>
        {locations.map((location, index) => {
          const leads = location.id === comparison.winnerId;
          return (
            <article className={`cmpx-site${leads ? " leads" : ""}`} key={location.id}>
              <div className="cmpx-site-ring">
                <ScoreRing score={location.score.overall} size={86} />
              </div>
              <div className="cmpx-site-body">
                <h3 className="cmpx-site-name">
                  <span
                    className="cmpx-dot"
                    style={{ background: SERIES_COLOURS[index % SERIES_COLOURS.length] }}
                    aria-hidden="true"
                  />
                  {location.label}
                  {leads && <span className="cmpx-lead-tag">Leads</span>}
                </h3>
                <p className="cmpx-site-read">{readingFor(location)}</p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
