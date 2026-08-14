import { useEffect } from "react";
import {
  decodeScenario,
  encodeScenario,
  type DecodeResult,
  type ScenarioInputs,
} from "@spotential/sim-engine";
import { useDebounced } from "./useDebounced.js";

const PARAM = "s";

/**
 * Read once, at startup, before React renders. A link is the whole persistence
 * layer in v1, so it has to be the seed for initial state rather than
 * something applied afterwards in an effect.
 */
export function readScenarioFromUrl(): DecodeResult {
  if (typeof window === "undefined") return { ok: false, reason: "no window" };
  return decodeScenario(new URLSearchParams(window.location.search).get(PARAM));
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
