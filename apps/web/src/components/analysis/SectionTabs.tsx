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
  | "rent"
  | "gaps"
  | "ask";

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

  useLayoutEffect(() => {
    const rail = railRef.current;
    const thumb = thumbRef.current;
    if (!rail || !thumb) return;

    const place = (animate: boolean) => {
      const el = rail.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!el || el.offsetWidth === 0) return;

      const to = { x: el.offsetLeft, width: el.offsetWidth, autoAlpha: 1 };
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      if (animate && placed.current && !reduce) {
        gsap.to(thumb, { ...to, duration: 0.42, ease: "power3.out", overwrite: "auto" });
      } else {
        gsap.set(thumb, to);
      }
      placed.current = true;

      // Keep the chosen tab reachable when the rail scrolls on a narrow screen.
      // `scrollIntoView` would walk up and scroll the PAGE as well, moving the
      // sticky toolbar; this scrolls the rail's own box and nothing else.
      const left = el.offsetLeft - (rail.clientWidth - el.offsetWidth) / 2;
      rail.scrollTo({ left, behavior: placed.current ? "smooth" : "auto" });
    };

    place(true);

    /** A late-loading font changes every label's width after first paint. */
    const observer = new ResizeObserver(() => place(false));
    observer.observe(rail);
    return () => observer.disconnect();
  }, [active, tabs]);

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
