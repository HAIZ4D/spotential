import { useEffect, useLayoutEffect, useRef } from "react";
import gsap from "gsap";

/**
 * "demand" is the population grid — how many people live right here, from
 * Kontur. Deliberately not folded into "people", which is DOSM district
 * demographics: who lives in the district. Different source, different
 * question, and merging them would blur what each figure can be asked.
 */
export type SectionId =
  | "overview"
  | "competition"
  | "people"
  | "demand"
  | "rent";

export interface SectionTab {
  id: SectionId;
  label: string;
  /** Headline figure, kept visible even while the section is closed. */
  badge?: string | undefined;
  /** Warn = loaded but degraded; none = nothing to show. */
  state?: "warn" | "none" | undefined;
}

/**
 * The section switcher — a segmented rail with one sliding thumb.
 *
 * Tabs replace a 2,500px scroll of seven identical panels, but they also HIDE
 * things, and in this app what gets hidden is often a caveat. Two guards keep
 * that honest:
 *
 *   - the badge carries each section's headline figure, so the numbers stay on
 *     screen even when the section is closed;
 *   - a state dot marks a section whose data failed or is missing, so a
 *     problem is visible without opening it.
 *
 * SEVEN SEPARATELY-BORDERED PILLS, one of them filled navy, was seven boxes
 * pretending to be a control. A single recessed track with one raised thumb
 * reads as one control with a position, which is what a tab bar actually is —
 * and it means six of the seven stop drawing borders that carry no meaning.
 *
 * THE THUMB IS MEASURED, NEVER COMPUTED. It reads `offsetLeft`/`offsetWidth`
 * off the live active button, exactly as the navbar pill does, so it stays
 * correct at any zoom, font size or label length — badges make these tabs
 * genuinely different widths, so an assumed-equal-segments thumb would sit
 * wrong on almost every one.
 */
export function SectionTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: SectionTab[];
  active: SectionId;
  onSelect: (id: SectionId) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  /** First placement jumps; later ones slide. Animating in from x=0 on mount
   *  would fly the thumb across the bar on every page load. */
  const placed = useRef(false);

  /** Reads the live geometry. Measured, never computed from equal segments:
   *  badges make these tabs genuinely different widths. */
  const target = () => {
    const rail = railRef.current;
    const el = rail?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!el || el.offsetWidth === 0) return null;
    return { x: el.offsetLeft, width: el.offsetWidth, autoAlpha: 1 };
  };

  /**
   * SLIDE ON SELECTION ONLY — deps are `[active]`, deliberately not `[tabs]`.
   *
   * `tabs` is rebuilt on every render of the page, so depending on it re-ran
   * this effect constantly: each pass restarted the tween from wherever it had
   * reached, and with figures still arriving (competitors, demographics, the
   * hero count-up) that is several restarts inside one 400ms slide. It read as
   * stutter, and it was — the animation was being interrupted, not dropped.
   */
  useLayoutEffect(() => {
    const rail = railRef.current;
    const thumb = thumbRef.current;
    const to = target();
    if (!rail || !thumb || !to) return;

    const first = !placed.current;
    placed.current = true;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (first || reduce) {
      gsap.set(thumb, to);
    } else {
      gsap.to(thumb, { ...to, duration: 0.34, ease: "power3.out", overwrite: true });
    }

    // Keep the chosen tab reachable when the rail scrolls on a narrow screen.
    // `scrollIntoView` would walk up and scroll the PAGE as well, moving the
    // sticky toolbar; this scrolls the rail's own box and nothing else.
    if (rail.scrollWidth > rail.clientWidth + 1) {
      const el = rail.querySelector<HTMLElement>('[aria-selected="true"]')!;
      rail.scrollTo({
        left: el.offsetLeft - (rail.clientWidth - el.offsetWidth) / 2,
        behavior: first ? "auto" : "smooth",
      });
    }
  }, [active]);

  /**
   * Re-measure when the geometry moves under it: a late-loading font, or a
   * badge appearing when its figure finally lands.
   *
   * Silent when a slide is in flight. `gsap.set` mid-tween would snap the
   * thumb to the end and abandon the rest of the animation, which is the
   * visible jump this observer used to cause every time a query resolved.
   */
  useEffect(() => {
    const rail = railRef.current;
    const thumb = thumbRef.current;
    if (!rail || !thumb) return;

    const observer = new ResizeObserver(() => {
      const to = target();
      if (!to) return;

      /**
       * RE-AIM MID-FLIGHT rather than ignoring the change.
       *
       * The first version returned early while a tween was running, to stop
       * `gsap.set` snapping the thumb to the end of a slide in progress. But
       * the resize that matters most arrives exactly then: a badge lands as
       * its figure resolves, which widens a tab a few frames into the slide.
       * Skipping left the thumb finishing at the width it aimed for BEFORE the
       * badge existed, with no further resize to correct it — a permanently
       * mismatched thumb, not a momentary one.
       *
       * Re-targeting keeps the motion continuous and still lands correctly.
       */
      if (gsap.isTweening(thumb)) {
        gsap.to(thumb, { ...to, duration: 0.2, ease: "power2.out", overwrite: true });
        return;
      }
      gsap.set(thumb, to);
    });
    observer.observe(rail);
    for (const el of rail.querySelectorAll(".tab")) observer.observe(el);
    return () => observer.disconnect();
  }, [tabs.length]);

  useEffect(() => () => { gsap.killTweensOf(thumbRef.current); }, []);

  return (
    <div className="tabs" role="tablist" aria-label="Analysis sections" ref={railRef}>
      <span className="tab-thumb" ref={thumbRef} aria-hidden="true" />
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          className="tab"
          aria-selected={active === tab.id}
          aria-controls={`section-${tab.id}`}
          onClick={() => onSelect(tab.id)}
        >
          {tab.state && (
            /* aria-hidden, and the state is spelled out in text below.
               A `title` here joins the button's ACCESSIBLE NAME, so the tab
               announced itself as "Data could not be loaded Rent" — which
               broke name-based lookups and read badly to a screen reader. */
            <span className={`tab-dot ${tab.state}`} aria-hidden="true" />
          )}
          {tab.label}
          {tab.state && (
            <span className="sr-only">
              {tab.state === "warn" ? ", data could not be loaded" : ", no data for this spot"}
            </span>
          )}
          {tab.badge && <span className="tab-badge">{tab.badge}</span>}
        </button>
      ))}
    </div>
  );
}
