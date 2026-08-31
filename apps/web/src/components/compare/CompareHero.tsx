import { formatNumber, type ComparedLocation, type Comparison } from "@spotential/sim-engine";
import { ScoreRing } from "../analysis/ScoreRing.js";
import { SERIES_COLOURS } from "../CompareRadar.js";

/**
 * The answer, first.
 *
 * This page exists to settle one question — which of these sites is better,
 * and why — and that verdict used to arrive as a small pill in a card header,
 * above a radar and a table you had to read carefully to extract a ranking
 * from. Now it is the first thing on the page.
 *
 * DERIVED, never written: the winner and the spread come straight off the
 * comparison object, and the decisive dimension is the largest measured gap.
 * The table below reads the same object, so the two cannot disagree.
 */

/** The dimension that separates the sites most. Null when none of them do. */
function decisiveDimension(comparison: Comparison): { label: string; spread: number } | null {
  const decided = comparison.dimensions
    .filter((d) => d.outcome.kind === "winner")
    .map((d) => ({ label: d.label, spread: Math.abs((d.outcome as { spread: number }).spread) }))
    .sort((a, b) => b.spread - a.spread);

  return decided[0] ?? null;
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

  return (
    <section className="cmp-hero">
      <div className="cmp-verdict">
        {winner ? (
          <>
            <h2 className="cmp-verdict-title">{winner.label} scores highest</h2>
            <p className="cmp-verdict-note">
              by <strong>{formatNumber(comparison.overallSpread, 1)}</strong> points
              {decisive ? (
                <>
                  , driven mostly by <strong>{decisive.label.toLowerCase()}</strong>, where the gap
                  is {formatNumber(decisive.spread, 1)}
                </>
              ) : null}
              . Dimensions marked <em>too close</em> below did not separate these sites at all.
            </p>
          </>
        ) : (
          <>
            {/* Refusing to rank is the honest outcome, not a missing feature.
                The same restraint the dimension table already shows. */}
            <h2 className="cmp-verdict-title">Too close to call</h2>
            <p className="cmp-verdict-note">
              The overall spread is{" "}
              <strong>{formatNumber(comparison.overallSpread, 1)}</strong> points, which is inside
              what these figures can support. Treat these sites as equivalent on the evidence here
              and decide on something this score does not measure.
            </p>
          </>
        )}
      </div>

      <div className="cmp-rings">
        {locations.map((location, index) => (
          <div className="cmp-ring" key={location.id}>
            <ScoreRing score={location.score.overall} />
            <div className="cmp-ring-label">
              <span
                className="cmp-chip-dot"
                style={{ background: SERIES_COLOURS[index % SERIES_COLOURS.length] }}
                aria-hidden="true"
              />
              {location.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
