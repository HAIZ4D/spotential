import type { ComparedLocation, Comparison } from "@spotential/sim-engine";
import { SERIES_COLOURS } from "../CompareRadar.js";

/**
 * Dimension by dimension, as bars rather than columns of digits.
 *
 * The table below holds exactly these numbers, but reading a comparison out of
 * it means computing every difference yourself. This shows the gap directly,
 * which is the whole question the page is asked.
 *
 * THE THREE OUTCOMES STAY VISUALLY SEPARATE, because they are different
 * claims:
 *
 *   winner    one site is ahead by more than the threshold — bars in full
 *             series colour, the leader emphasised
 *   tooClose  a real measured gap, but inside what these figures support —
 *             both bars muted, so nobody reads a 3-point lead as a win
 *   noData    neither side has the data — an EMPTY TRACK and the words. Never
 *             two zero-length bars: a tie at zero and an absence of data look
 *             identical drawn that way, and they mean opposite things.
 */
export function DimensionCompare({
  locations,
  comparison,
}: {
  locations: ComparedLocation[];
  comparison: Comparison;
}) {
  return (
    <div className="cmp-dims">
      {comparison.dimensions.map((dimension) => {
        // Narrowed once; repeated property access on the union loses it.
        const outcome = dimension.outcome;
        const noData = outcome.kind === "noData";
        const tooClose = outcome.kind === "tooClose";

        return (
          <div className="cmp-dim" key={dimension.key}>
            <div className="cmp-dim-head">
              <span className="cmp-dim-label">{dimension.label}</span>

              {outcome.kind === "winner" && (
                <span className="pill green">
                  {locations.find((l) => l.id === outcome.winnerId)?.label}
                </span>
              )}
              {tooClose && (
                <span className="pill muted" title={`${outcome.spread} points apart`}>
                  too close
                </span>
              )}
              {noData && <span className="pill muted">no data either side</span>}
            </div>

            {noData ? (
              <div className="cmp-empty">
                Neither location has data for this dimension, so it is excluded from both scores
                rather than counted as zero.
              </div>
            ) : (
              <div className="cmp-bars">
                {dimension.scores.map((cell, index) => {
                  const location = locations.find((l) => l.id === cell.id);
                  const leads = outcome.kind === "winner" && outcome.winnerId === cell.id;
                  const colour = SERIES_COLOURS[index % SERIES_COLOURS.length] as string;

                  return (
                    <div className="cmp-bar-row" key={cell.id}>
                      <span className="cmp-bar-name">{location?.label ?? ""}</span>

                      <span className="cmp-bar-track">
                        {/* Null is not zero. A location with no data on an
                            axis the other one scored gets no bar at all. */}
                        {cell.score !== null && (
                          <i
                            className={`cmp-bar-fill ${leads ? "leads" : ""}`}
                            style={{
                              width: `${Math.max(1.5, Math.min(100, cell.score))}%`,
                              background: colour,
                              opacity: tooClose ? 0.45 : leads ? 1 : 0.75,
                            }}
                          />
                        )}
                      </span>

                      <span className={`cmp-bar-value ${leads ? "leads" : ""}`}>
                        {cell.score === null ? (
                          <span className="muted">no data</span>
                        ) : (
                          Math.round(cell.score)
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
