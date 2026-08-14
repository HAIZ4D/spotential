import { useEffect, useRef, useState } from "react";

/**
 * Animate a figure to its new value.
 *
 * Financial dashboards count numbers up rather than swapping them, because a
 * figure that slides carries its DIRECTION — you see the profit fall without
 * reading the delta underneath it.
 *
 * 200ms with an ease-out curve: long enough to register as movement, short
 * enough that dragging a slider still feels immediate. Anything past ~300ms on
 * a control that fires continuously reads as lag rather than polish.
 *
 * Returns the target immediately when the user has asked for reduced motion,
 * and whenever the change is tiny enough that animating it would be noise.
 */
const DURATION_MS = 200;

/** Below this the animation is imperceptible and just costs frames. */
const MIN_DELTA = 0.5;

const easeOut = (t: number): number => 1 - (1 - t) ** 3;

export function useCountUp(target: number): number {
  const prefersReduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const [shown, setShown] = useState(target);
  const from = useRef(target);
  const frame = useRef<number>(0);

  useEffect(() => {
    if (prefersReduced || Math.abs(target - from.current) < MIN_DELTA) {
      from.current = target;
      setShown(target);
      return;
    }

    const start = performance.now();
    const origin = from.current;

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      const value = origin + (target - origin) * easeOut(t);

      setShown(value);
      if (t < 1) {
        frame.current = requestAnimationFrame(step);
      } else {
        // Land on the exact target: an eased approach never quite arrives, and
        // a headline figure that settles a ringgit short is a bug.
        from.current = target;
        setShown(target);
      }
    };

    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [target, prefersReduced]);

  return shown;
}
