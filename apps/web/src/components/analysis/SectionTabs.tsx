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
 * The section switcher — "separate them with good buttons".
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
 * Overview additionally keeps the honesty notice and the full dimension table,
 * so the default view still tells the whole truth.
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
  return (
    <div className="tabs" role="tablist" aria-label="Analysis sections">
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
