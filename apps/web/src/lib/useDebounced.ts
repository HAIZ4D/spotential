import { useEffect, useState } from "react";

/**
 * Debounce a value.
 *
 * Used ONLY for network calls. The deterministic recalculation is synchronous
 * and unthrottled — debouncing that would be the one thing guaranteed to make
 * the simulator feel slow.
 */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
