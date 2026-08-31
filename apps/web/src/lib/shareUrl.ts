import { useEffect } from "react";
import {
  decodeScenario,
  encodeScenario,
  type DecodeResult,
  type ScenarioInputs,
} from "@spotential/sim-engine";
import { useDebounced } from "./useDebounced.js";

const PARAM = "s";

/** A decode result, plus whether the caller actually offered a scenario. */
export type ReadResult = DecodeResult & { supplied: boolean };

/**
 * Read once, at startup, before React renders. A link is the whole persistence
 * layer in v1, so it has to be the seed for initial state rather than
 * something applied afterwards in an effect.
 *
 * `supplied` reports whether the `s` parameter was PRESENT, which the decode
 * reason cannot tell you: a missing parameter and an empty one both decode to
 * "no scenario in the link", but only the second is a broken link worth
 * warning about. The page used to guess with `search.includes("s=")`, which
 * matched any parameter whose name ends in s — `?seats=40`, `?days=7`,
 * `?utm_campaigns=x` all raised a red error about a link nobody sent.
 */
export function readScenarioFromUrl(): ReadResult {
  if (typeof window === "undefined") {
    return { ok: false, reason: "no window", supplied: false };
  }

  const params = new URLSearchParams(window.location.search);
  return { ...decodeScenario(params.get(PARAM)), supplied: params.has(PARAM) };
}

export function scenarioHref(inputs: ScenarioInputs): string {
  const url = new URL(window.location.href);
  url.searchParams.set(PARAM, encodeScenario(inputs));
  return url.toString();
}

/**
 * Keep the address bar in step with the scenario, so copying the URL by hand
 * or hitting bookmark captures what is actually on screen.
 *
 * replaceState, not pushState — dragging a slider should not stack up dozens
 * of history entries the back button then has to walk through.
 */
export function useUrlSync(inputs: ScenarioInputs): void {
  const settled = useDebounced(inputs, 400);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set(PARAM, encodeScenario(settled));
    window.history.replaceState(null, "", url.toString());
  }, [settled]);
}
