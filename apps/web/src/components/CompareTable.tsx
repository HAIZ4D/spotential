import type { ComparedLocation, Comparison, ScoreKind } from "@spotential/sim-engine";
import { SERIES_COLOURS } from "./CompareRadar.js";

/**
 * The dimension-by-dimension breakdown.
 *
 * Every cell carries whether its figure is measured or inferred, so a win on
 * an inferred axis is not mistaken for a fact. Dimensions too close to
 * separate say so, and dimensions with no data on either side say that rather
 * than showing a tie at zero.
 */

const KIND_LABEL: Record<ScoreKind, string> = {
  direct: "measured",
  proxy: "inferred",
  unavailable: "no data",
};

export function CompareTable({
  locations,
  comparison,
}: {
  locations: ComparedLocation[];
  comparison: Comparison;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Dimension</th>
            {locations.map((location, index) => (
              <th key={location.id}>
                <span
                  className="dot"
                  style={{ background: SERIES_COLOURS[index % SERIES_COLOURS.length] }}
                />
                {location.label}
              </th>
            ))}
            <th>Verdict</th>
          </tr>
        </thead>
        <tbody>
          {comparison.dimensions.map((dimension) => {
            // Extracted so TypeScript narrows the union once, rather than
            // losing it on each repeated property access.
            const outcome = dimension.outcome;

            return (
            <tr key={dimension.key}>
              <td>{dimension.label}</td>

              {dimension.scores.map((cell) => {
                const isWinner = outcome.kind === "winner" && outcome.winnerId === cell.id;
                return (
                  <td key={cell.id}>
                    {/* Null, not zero: "no data" and "scored zero" are
                        different claims and must not look the same. */}
                    {cell.score === null ? (
                      <span className="muted">—</span>
                    ) : (
                      <span style={{ fontWeight: isWinner ? 680 : 400 }}>
                        {Math.round(cell.score)}
                      </span>
                    )}
                    <div className="tiny muted">{KIND_LABEL[cell.kind]}</div>
                  </td>
                );
              })}

              <td>
                {outcome.kind === "winner" && (
                  <span className="pill green">
                    {locations.find((l) => l.id === outcome.winnerId)?.label}
                  </span>
                )}
                {outcome.kind === "tooClose" && (
                  <span className="pill muted" title={`${outcome.spread} points apart`}>
                    too close
                  </span>
                )}
                {outcome.kind === "noData" && (
                  <span className="pill muted">no data either side</span>
                )}
              </td>
            </tr>
            );
          })}

          <tr className="total">
            <td>Overall</td>
            {locations.map((location) => (
              <td key={location.id}>{Math.round(location.score.overall)}</td>
            ))}
            <td>
              {comparison.winnerId ? (
                <span className="pill green">
                  {locations.find((l) => l.id === comparison.winnerId)?.label}
                </span>
              ) : (
                <span className="pill amber">too close to call</span>
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
