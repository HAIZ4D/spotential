import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

/**
 * The four figures worth seeing without scrolling or opening a tab.
 *
 * DELIBERATELY QUIET. Four filled colour blocks under a score ring would give
 * the eye five things competing to be read first, and the ring has to win. So
 * the tone lives in a 5px dot rather than a coloured rule down the side: the
 * old left-border treatment is the single most recognisable "dashboard card"
 * cliché, and it made four unrelated figures look like four alerts.
 *
 * The craft is in the typography instead. Tabular figures so the row of
 * numbers aligns on its digits, tight negative tracking at size, and a label
 * in `--ink-2` rather than the `--ink-3` this used to use, which measures
 * 2.58:1 on white and fails AA outright.
 */

export interface Chip {
  label: string;
  value: string;
  note?: string | undefined;
  tone?: "navy" | "green" | "amber" | "red" | undefined;
}

export function StatChips({ chips }: { chips: Chip[] }) {
  const rootRef = useRef<HTMLDivElement>(null);

  /**
   * Hover lift owned by GSAP, not CSS.
   *
   * The hero entrance animates these same elements, and CSS holding a
   * transition on `transform` would smooth every frame GSAP writes: the tile
   * eases backwards into the entrance's start values and stays there. That
   * exact collision has cost this codebase three separate bugs, so one owner.
   */
  const { contextSafe } = useGSAP({ scope: rootRef });

  const lift = contextSafe((el: HTMLElement, up: boolean) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.to(el, { y: up ? -2 : 0, duration: 0.22, ease: "power2.out", overwrite: "auto" });
  });

  return (
    <div className="chips" ref={rootRef}>
      {chips.map((chip) => (
        <div
          key={chip.label}
          className={`chip ${chip.tone ?? ""}`}
          onMouseEnter={(e) => lift(e.currentTarget, true)}
          onMouseLeave={(e) => lift(e.currentTarget, false)}
        >
          <div className="chip-label">
            {chip.tone && <span className="chip-dot" aria-hidden="true" />}
            <span>{chip.label}</span>
          </div>
          <div className="chip-value">{chip.value}</div>
          {chip.note && <div className="chip-note">{chip.note}</div>}
        </div>
      ))}
    </div>
  );
}
