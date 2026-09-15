import { useEffect, useRef, type RefObject } from "react";
import gsap from "gsap";
import { PREMIUM } from "../../lib/ease.js";

/**
 * Section entrances, on an IntersectionObserver rather than ScrollTrigger.
 *
 * ~40KB of plugin for a fade-and-rise on a handful of sections is not a trade
 * worth making when every route already pays for the GSAP core, which is the
 * same call the footer entrance made. An observer is a dozen lines and fires
 * once per element.
 *
 * PREMIUM ARCHETYPE, one signature curve. `--ease-premium` in CSS and the
 * registered `spotential-premium` in GSAP are the same `cubic-bezier(0.4, 0,
 * 0.2, 1)`, sampled and verified to three decimals. Using a fourth unrelated
 * easing here is exactly what made the thinking state read as assembled rather
 * than designed.
 *
 * `clearProps` ON COMPLETE, and it is not optional. A GSAP tween leaves an
 * inline transform behind, and an inline transform outranks any stylesheet
 * `:hover` — so without this every card animated in and then refused to lift
 * on hover for the rest of the session. That has cost this codebase two
 * separate bugs already.
 */

const ONCE = { threshold: 0.12, rootMargin: "0px 0px -8% 0px" };

export function useReveal<T extends HTMLElement>(
  ref: RefObject<T | null>,
  options: { selector?: string; stagger?: number; y?: number } = {},
): void {
  const { selector = ":scope > *", stagger = 0.06, y = 18 } = options;
  const done = useRef(false);

  useEffect(() => {
    const root = ref.current;
    if (!root || done.current) return;

    // Rendered at rest for anyone who asked for less motion. The content is
    // identical; it simply arrives already there.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const targets = Array.from(root.querySelectorAll<HTMLElement>(selector));
    if (targets.length === 0) return;

    gsap.set(targets, { opacity: 0, y });

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      done.current = true;
      observer.disconnect();

      gsap.to(targets, {
        opacity: 1,
        y: 0,
        duration: 0.46,
        ease: PREMIUM,
        // Under the 500ms total budget at six items, and the 1/3 rule holds:
        // each tween is 460ms against a 60ms step, so at most three of a set
        // are ever in transit together.
        stagger,
        onComplete: () => gsap.set(targets, { clearProps: "transform,opacity" }),
      });
    }, ONCE);

    observer.observe(root);
    return () => observer.disconnect();
  }, [ref, selector, stagger, y]);
}

/**
 * Bars that fill from zero when their band arrives.
 *
 * Animating `width` rather than `transform` is deliberate and is the one place
 * this page does it: a scaled bar distorts its own rounded ends, and these are
 * six short meters that animate once. The performance rule exists for motion
 * that runs continuously or on scroll, which this does not.
 */
export function useFillBars<T extends HTMLElement>(
  ref: RefObject<T | null>,
  ready: boolean,
): void {
  const done = useRef(false);

  useEffect(() => {
    const root = ref.current;
    if (!root || !ready || done.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const bars = Array.from(root.querySelectorAll<HTMLElement>(".dim-bar-fill"));
    if (bars.length === 0) return;

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      done.current = true;
      observer.disconnect();

      for (const bar of bars) {
        // The resting width is whatever the inline style already set, so the
        // tween never has to know the score. Read it, start from zero, land
        // back on it exactly.
        const target = bar.style.width;
        gsap.fromTo(
          bar,
          { width: "0%" },
          {
            width: target,
            duration: 0.72,
            ease: PREMIUM,
            delay: 0.05 * bars.indexOf(bar),
            onComplete: () => {
              bar.style.width = target;
            },
          },
        );
      }
    }, ONCE);

    observer.observe(root);
    return () => observer.disconnect();
  }, [ref, ready]);
}
