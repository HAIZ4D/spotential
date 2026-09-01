import { useQuery } from "@tanstack/react-query";
import type { ScenarioInputs, SimulationResult } from "@spotential/sim-engine";
import { postSimulate } from "../lib/api.js";
import { useDebounced } from "../lib/useDebounced.js";

/**
 * Makes the client/server parity guarantee visible.
 *
 * The browser has already computed and rendered the answer — this asks Cloud
 * Run for the same scenario in the background and confirms the two agree. It
 * is the acceptance-criterion-#3 check surfaced as a live indicator, and it is
 * also how the deployed app proves it is genuinely talking to the deployed
 * service (criterion #1).
 *
 * Nothing here blocks a slider. A cold start or an outage degrades this badge
 * and nothing else.
 */
export function ParityBadge({
  inputs,
  localResult,
}: {
  inputs: ScenarioInputs;
  localResult: SimulationResult;
}) {
  // The engine is instant; the network is not. Only ask once the user stops.
  const settled = useDebounced(inputs, 600);

  const query = useQuery({
    queryKey: ["simulate", settled],
    queryFn: ({ signal }) => postSimulate(settled, signal),
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });

  if (query.isPending) {
    return <span className="pill muted">checking server…</span>;
  }

  if (query.isError) {
    return (
      <span className="pill muted" title="Your figures are computed locally and are unaffected.">
        server unreachable
      </span>
    );
  }

  // Compare against the result for the scenario the SERVER was asked about,
  // not whatever the user has dragged to since — otherwise an in-flight edit
  // would look like a mismatch.
  const inFlight = JSON.stringify(settled) !== JSON.stringify(inputs);
  if (inFlight) return <span className="pill muted">checking server…</span>;

  const agrees =
    JSON.stringify(query.data.result) === JSON.stringify(JSON.parse(JSON.stringify(localResult)));

  return agrees ? (
    <span className="pill green" title={`Engine ${query.data.engineVersion}`}>
      ✓ server agrees
    </span>
  ) : (
    <span className="pill red" title="Client and server disagree. This is a bug, please report it.">
      ✗ server disagrees
    </span>
  );
}
