import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { listCategories, type BusinessCategory, type VendorProfile } from "@spotential/sim-engine";
import { Select, type SelectOption } from "./Select.js";

/**
 * Everything that shapes the list, on one horizontal band.
 *
 * Two groups, and the split is the point. YOUR BUSINESS changes every score on
 * the page; WHAT YOU ARE LOOKING FOR only narrows it. Running them together
 * would suggest the search box affects the ranking, which it does not.
 *
 * Sorting by "Best match" is what switches ranking on — there is no separate
 * toggle, because "rank these for me" and "sort by how well they fit" are the
 * same request and having both would leave the page with two ways to say it.
 */

export interface FilterState {
  query: string;
  state: string;
  budget: string;
  sort: string;
}

export const SORTS: SelectOption[] = [
  { value: "match", label: "Best match" },
  { value: "soon", label: "Starting soonest" },
  { value: "cheap", label: "Cheapest booth" },
];

const CATEGORY_OPTIONS: SelectOption[] = listCategories().map((c) => ({
  value: c.id,
  label: c.label,
}));

function stateOptions(counts: Record<string, number>, total: number): SelectOption[] {
  return [
    { value: "", label: "All states", hint: String(total) },
    ...Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([state, n]) => ({ value: state, label: state, hint: String(n) })),
  ];
}

export function FilterBar({
  vendor,
  onVendor,
  filters,
  onFilter,
  stateCounts,
  total,
}: {
  vendor: VendorProfile;
  onVendor: (v: VendorProfile) => void;
  filters: FilterState;
  onFilter: (key: keyof FilterState, value: string) => void;
  stateCounts: Record<string, number>;
  total: number;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.from(".fb-cell", {
        y: -12,
        opacity: 0,
        duration: 0.45,
        stagger: 0.04,
        ease: "power2.out",
      });
    },
    { scope: rootRef },
  );

  /**
   * THE FIELD OWNS ITS OWN VALUE.
   *
   * It used to render `filters.query`, which comes from the URL — so every
   * keystroke had to complete a round trip through `setSearchParams` before it
   * could appear. Two keys pressed inside one commit collapsed to the last
   * one, and typing "terang" at full speed produced "tg". On a fast idle
   * machine the round trip usually won, which is why this looked like a flaky
   * test for months rather than dropped keystrokes.
   *
   * "Debounce the fetch, never the field" was already the rule here; this is
   * the half that was missing. The URL still updates on every keystroke and
   * still drives the query, but the input never waits for it.
   */
  const [text, setText] = useTypedField(filters.query, (v) => onFilter("query", v));
  const [budget, setBudget] = useTypedField(filters.budget, (v) => onFilter("budget", v));

  return (
    <div className="filterbar" ref={rootRef}>
      {/* Group one: who you are. Everything here re-scores the page. */}
      <div className="fb-group fb-profile">
        <span className="fb-group-label">Your business</span>
        <div className="fb-cell">
          <Select
            label="I sell"
            variant="accent"
            value={vendor.category}
            options={CATEGORY_OPTIONS}
            onChange={(v) => onVendor({ ...vendor, category: v as BusinessCategory })}
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M3 9l1.5-5h15L21 9M3 9h18M3 9v10a1 1 0 001 1h16a1 1 0 001-1V9M9 13h6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            }
          />
        </div>
        <div className="fb-cell">
          <label className="sel-label" htmlFor="fb-budget">
            Booth budget
          </label>
          <div className="fb-money">
            <span className="fb-prefix">RM</span>
            <input
              id="fb-budget"
              type="number"
              min={0}
              step={100}
              inputMode="numeric"
              placeholder="Any"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </div>
        </div>
      </div>

      <span className="fb-divider" aria-hidden="true" />

      {/* Group two: what you want to see. These only narrow. */}
      <div className="fb-group fb-find">
        <span className="fb-group-label">Find events</span>
        <div className="fb-cell fb-search-cell">
          <label className="sel-label" htmlFor="fb-q">
            Search
          </label>
          <div className="fb-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.6-3.6" strokeLinecap="round" />
            </svg>
            <input
              id="fb-q"
              value={text}
              placeholder="Event, venue or organizer"
              onChange={(e) => setText(e.target.value)}
            />
            {text && (
              <button
                className="fb-clear"
                onClick={() => setText("")}
                aria-label="Clear search"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="fb-cell">
          <Select
            label="State"
            value={filters.state}
            options={stateOptions(stateCounts, total)}
            placeholder="All states"
            onChange={(v) => onFilter("state", v)}
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1116 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            }
          />
        </div>

        <div className="fb-cell">
          <Select
            label="Sort by"
            value={filters.sort || "match"}
            options={SORTS}
            onChange={(v) => onFilter("sort", v)}
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M7 4v16M7 20l-3-3M7 4l3 3M17 20V4M17 4l3 3M17 20l-3-3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            }
          />
        </div>
      </div>
    </div>
  );
}

/**
 * A text field that owns its own value while still driving the URL.
 *
 * Both of this bar's free-text inputs rendered straight from the URL, so every
 * keystroke had to complete a round trip through `setSearchParams` before it
 * could appear. Two keys pressed inside one commit collapsed to the last one:
 * typing "terang" at speed produced "tg", and typing a budget of "700"
 * produced something that matched nothing. On an idle machine the round trip
 * usually won, which is why both presented as flaky tests for months rather
 * than as dropped keystrokes.
 *
 * "Debounce the fetch, never the field" was already the rule here. This is the
 * half that was missing: the field updates locally and immediately, the URL
 * still updates on every keystroke, and the query is still what waits.
 */
function useTypedField(
  external: string,
  emit: (value: string) => void,
): [string, (value: string) => void] {
  const [value, setValue] = useState(external);
  /** What we last sent outward, so an echo of our own value is not adopted. */
  const emitted = useRef(external);

  useEffect(() => {
    // A genuinely external change: a shared link, or Clear all filters.
    // Adopting our own echo instead would clobber whatever is being typed.
    if (external !== emitted.current) {
      emitted.current = external;
      setValue(external);
    }
  }, [external]);

  return [
    value,
    (next: string) => {
      setValue(next);
      emitted.current = next;
      emit(next);
    },
  ];
}
