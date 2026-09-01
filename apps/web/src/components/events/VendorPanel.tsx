import {
  MALAYSIAN_STATES,
  formatNumber,
  listCategories,
  listDistricts,
  type BusinessCategory,
  type VendorProfile,
} from "@spotential/sim-engine";

/**
 * The vendor profile that drives matching.
 *
 * Deliberately SHORT. Every field here is one the score genuinely uses, and
 * asking for anything else would be a form standing between a vendor and the
 * listings. Only the category is required; the rest sharpen the ranking and
 * the panel says which axis each one unlocks, so filling a field has a visible
 * payoff rather than being an act of faith.
 *
 * An empty field stays EMPTY rather than defaulting. A budget of zero means
 * "free stalls only" and an unstated budget means "I have not decided" — the
 * score treats those completely differently, so the form must not quietly
 * convert one into the other.
 */

export interface VendorPanelProps {
  vendor: VendorProfile;
  onChange: (vendor: VendorProfile) => void;
}

/** Trading areas double as a "where are you based" picker, and they cost nothing. */
const BASES = listDistricts();

export function VendorPanel({ vendor, onChange }: VendorPanelProps) {
  const set = (patch: Partial<VendorProfile>) => onChange({ ...vendor, ...patch });

  return (
    <section className="card">
      <header>
        <h2>Your business</h2>
        <span className="pill muted">drives matching</span>
      </header>

      <div className="body stack">
        <div className="field">
          <label htmlFor="vendor-category">What you sell</label>
          <select
            id="vendor-category"
            value={vendor.category}
            onChange={(e) => set({ category: e.target.value as BusinessCategory })}
          >
            {listCategories().map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="vendor-base">Where you are based</label>
          <select
            id="vendor-base"
            value={vendor.baseLabel ?? ""}
            onChange={(e) => {
              const district = BASES.find((d) => d.label === e.target.value);
              set(
                district
                  ? { base: district.centre, baseLabel: district.label }
                  : // Cleared rather than defaulted: the travel axis goes
                    // unavailable instead of measuring from somewhere invented.
                    { base: null, baseLabel: "" },
              );
            }}
          >
            <option value="">Not set, travel not scored</option>
            {BASES.map((d) => (
              <option key={d.id} value={d.label}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="vendor-budget">Booth budget, RM for the whole event</label>
          <input
            id="vendor-budget"
            type="number"
            min={0}
            step={100}
            inputMode="numeric"
            placeholder="Not set"
            value={vendor.boothBudgetRm === null ? "" : vendor.boothBudgetRm}
            onChange={(e) => {
              const raw = e.target.value.trim();
              /**
               * `Number("")` is 0, and 0 is a real budget meaning free stalls
               * only. An empty box must become null, not zero — the same trap
               * that once put a shared location in the Gulf of Guinea.
               */
              const parsed = Number(raw);
              set({
                boothBudgetRm:
                  raw === "" || !Number.isFinite(parsed) || parsed < 0 ? null : parsed,
              });
            }}
          />
          <span className="hint">
            {vendor.boothBudgetRm === null
              ? "Set this and affordability is scored against your own figure instead of an estimate."
              : `Events are judged against RM${formatNumber(vendor.boothBudgetRm)}.`}
          </span>
        </div>

        <div className="field">
          <label htmlFor="vendor-travel">Furthest you would travel, km</label>
          <input
            id="vendor-travel"
            type="number"
            min={1}
            step={10}
            inputMode="numeric"
            placeholder="No limit"
            value={vendor.maxTravelKm === null ? "" : vendor.maxTravelKm}
            onChange={(e) => {
              const raw = e.target.value.trim();
              const parsed = Number(raw);
              set({
                maxTravelKm: raw === "" || !Number.isFinite(parsed) || parsed <= 0 ? null : parsed,
              });
            }}
          />
        </div>

        <div className="notice info">
          <span>
            This stays in your browser and in the link. Nothing here is stored against you
            unless you sign in and apply for a booth.
          </span>
        </div>
      </div>
    </section>
  );
}

/** The states that actually have events, so the filter never offers a dead option. */
export const ALL_STATES = MALAYSIAN_STATES;
