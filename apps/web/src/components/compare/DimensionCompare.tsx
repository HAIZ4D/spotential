import { useRef } from "react";
import type { ComparedLocation, Comparison } from "@spotential/sim-engine";
import { SERIES_COLOURS } from "../CompareRadar.js";
import { useFillBars, useReveal } from "../events/useReveal.js";

/**
 * The ledger: one row per dimension, and the DELTA the page was never showing.
 *
 * This used to be a stack of bars with each site's absolute score beside it,
 * which still left the reader subtracting 87 from 90 to answer the only
 * question they came with. The gap is now a figure in its own column, read
 * straight off `outcome.spread` rather than recomputed, so the number and the
 * bars cannot drift apart.
 *
 * THE THREE OUTCOMES STAY VISUALLY SEPARATE, because they are different
 * claims and this is the part of the page most able to mislead:
 *
 *   winner    one site is ahead by more than the threshold. Bars in full
 *             series colour, the leader emphasised, the gap stated.
 *   tooClose  a real measured gap, inside what these figures support. Both
 *             bars muted so nobody reads a 3-point lead as a win.
 *   noData    neither side has it. An EMPTY TRACK and the words, never two
 *             zero-length bars: a tie at zero and an absence of data look
 *             identical drawn that way and mean opposite things.
 *
 * WHAT "NOT SCORED" MEANS IS SAID ONCE. It used to print in full inside every
 * unscored row, and in the default comparison three of five are unscored, so
 * one sentence became the largest block of text on the page. It sits at the
 * foot of the panel now, once, and only when there is something to explain.
 */

export function DimensionCompare({
  locations,
  comparison,
}: {
  locations: ComparedLocation[];
  comparison: Comparison;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref, { selector: ":scope > .cmpx-row", stagger: 0.05, y: 12 });
  useFillBars(ref, comparison.dimensions.length > 0);

  const unscored = comparison.dimensions.filter((d) => d.outcome.kind === "noData").length;

  return (
    <>
      <div className="cmpx-ledger" ref={ref}>
        {comparison.dimensions.map((dimension) => {
          // Narrowed once; repeated property access on the union loses it.
          const outcome = dimension.outcome;
          const noData = outcome.kind === "noData";
          const tooClose = outcome.kind === "tooClose";
          const leader =
            outcome.kind === "winner"
              ? locations.find((l) => l.id === outcome.winnerId)?.label
              : null;

          return (
            <div
              className={`cmpx-row${noData ? " is-absent" : ""}${tooClose ? " is-close" : ""}`}
              key={dimension.key}
            >
              <div className="cmpx-row-label">
                <span className="cmpx-dim">{dimension.label}</span>
                {noData ? (
                  <span className="cmpx-outcome absent">not scored</span>
                ) : tooClose ? (
                  <span className="cmpx-outcome close">too close to call</span>
                ) : (
                  <span className="cmpx-outcome wins">{leader} leads</span>
                )}
              </div>

              {noData ? (
                /* The empty track, kept. It is what stops an absent dimension
                   reading as a tie at zero. */
                <div className="cmpx-bars">
                  <span className="cmpx-track empty" aria-hidden="true" />
                </div>
              ) : (
                <div className="cmpx-bars">
                  {dimension.scores.map((cell, index) => {
                    const location = locations.find((l) => l.id === cell.id);
                    const leads = outcome.kind === "winner" && outcome.winnerId === cell.id;
                    const colour = SERIES_COLOURS[index % SERIES_COLOURS.length] as string;

                    return (
                      <div className={`cmpx-bar${leads ? " leads" : ""}`} key={cell.id}>
                        <span className="cmpx-bar-name">{location?.label ?? ""}</span>
                        <span className="cmpx-track">
                          {/* Null is not zero. A location with no data on an
                              axis the other one scored gets no bar at all. */}
                          {cell.score !== null && (
                            <i
                              className="dim-bar-fill"
                              style={{
                                width: `${Math.max(1.5, Math.min(100, cell.score))}%`,
                                background: colour,
                                opacity: tooClose ? 0.5 : leads ? 1 : 0.72,
                              }}
                            />
                          )}
                        </span>
                        <span className="cmpx-bar-value">
                          {cell.score === null ? (
                            <span className="cmpx-nil">no data</span>
                          ) : (
                            Math.round(cell.score)
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* The gap, which is the reason anybody opened this page. Read
                  off the comparison rather than recomputed here, so it cannot
                  disagree with the bars beside it. */}
              <div className="cmpx-delta">
                {noData ? (
                  /* WORDS, never a lone dash. A dash means nothing to a reader
                     who has not been told what it means, and this project
                     already took 149 of them out of its copy for that reason.
                     "No gap" would be worse still: it would state a
                     measurement nobody made. */
                  <span className="cmpx-nil">nothing to compare</span>
                ) : (
                  <>
                    <span className={`cmpx-delta-figure${tooClose ? " muted" : ""}`}>
                      {formatGap(outcome.spread)}
                    </span>
                    <span className="cmpx-delta-unit">point gap</span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {unscored > 0 && (
        <p className="cmpx-foot">
          {unscored === 1 ? "One dimension is" : `${unscored} dimensions are`} marked{" "}
          <strong>not scored</strong>: neither location has data there, so{" "}
          {unscored === 1 ? "it is" : "they are"} excluded from both totals rather than counted as
          zero. Excluding is why the remaining dimensions carry more weight here than they would
          on a fully measured site.
        </p>
      )}
    </>
  );
}

/** One decimal only when it changes the answer. "3" beats "3.0". */
function formatGap(spread: number): string {
  const gap = Math.abs(spread);
  return Number.isInteger(gap) ? String(gap) : gap.toFixed(1);
}
