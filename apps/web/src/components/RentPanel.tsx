import {
  SECTOR_LABELS,
  formatCurrency,
  formatNumber,
  rentSensitivity,
  sectorOf,
  type BusinessCategory,
  type LatLng,
  type ResolvedRent,
} from "@spotential/sim-engine";
import { AvailableProperties } from "./analysis/AvailableProperties.js";
import type { PropertyListing } from "../lib/api.js";

/**
 * Rental market — Feature 1e.
 *
 * THE THING THIS PANEL MUST NOT DO is present a researched benchmark as if it
 * were a quote. There is no automatable source of transacted Malaysian retail
 * rent — NAPIC holds it but sells it as PDFs, and DOSM publishes only a
 * state-level index. So the benchmark is labelled, dated, sourced, and always
 * beaten by a real figure the user types in.
 *
 * The live listings below it are a different kind of number again: real units,
 * but ASKING prices, from a third party. They inform the reader and never the
 * score, which is why they sit under their own heading rather than beside the
 * benchmark figure.
 *
 * The headline is the break-even, not the rent. "RM18,000/month" means nothing
 * to someone who has not run a restaurant; "93 customers a day before you make
 * a sen" is the same fact in a form you can argue with.
 */

const LIGHT_LABEL = {
  green: "Comfortable",
  amber: "Tight",
  red: "Very exposed",
} as const;

export function RentPanel({
  rent,
  category,
  point,
  unitSqft,
  overrideRent,
  onOverrideRent,
  onUnitSqft,
  simulatorHref,
  districtName = null,
  stateName = null,
  listings = [],
  listingsLoading = false,
}: {
  rent: ResolvedRent | null;
  category: BusinessCategory;
  point: LatLng;
  unitSqft: number | null;
  overrideRent: number | null;
  onOverrideRent: (value: number | null) => void;
  onUnitSqft: (value: number | null) => void;
  simulatorHref: string | null;
  /** DOSM district, used when no rent benchmark covers the pin. */
  districtName?: string | null;
  /** DOSM state. Mudah searches by region, so without it that link is dropped. */
  stateName?: string | null;
  /** Real units advertised nearby. Display only — never feeds the score. */
  listings?: PropertyListing[];
  listingsLoading?: boolean;
}) {
  const sensitivity = rent ? rentSensitivity(rent, category, point) : null;

  return (
    <section className="card">
      <header>
        <h2>Rental market</h2>
        {sensitivity && (
          <span className={`pill ${sensitivity.light}`}>{LIGHT_LABEL[sensitivity.light]}</span>
        )}
      </header>

      <div className="body stack">
        {!rent && (
          <div className="notice info">
            <span>
              No rent benchmark covers this spot. Coverage is 23 trading areas across KL, Selangor,
              Penang and Johor. Enter the rent you were quoted below and this fills in properly.
            </span>
          </div>
        )}

        {rent && sensitivity && (
          <>
            <div className="figure-row">
              <div>
                <div className="tiny muted">Monthly rent</div>
                <div className="figure">{formatCurrency(rent.monthlyRent)}</div>
                <div className="tiny muted">
                  {rent.psf !== null
                    ? `RM${rent.psf}/sqft over ${formatNumber(rent.unitSqft ?? 0)} sqft`
                    : "per month"}
                </div>
              </div>

              <div>
                <div className="tiny muted">Break-even</div>
                <div className="figure">
                  {sensitivity.breakEvenPerDay === null
                    ? "not available"
                    : `${formatNumber(sensitivity.breakEvenPerDay)}/day`}
                </div>
                <div className="tiny muted">customers, to cover all fixed costs</div>
              </div>
            </div>

            <div className="body small">{sensitivity.note}</div>

            {/* The benchmarks were researched for ground-floor F&B. Applying
                them to a shop or a salon is defensible as an indication and
                nothing more, so the panel says which it is doing. */}
            {sectorOf(category) !== "fnb" && (
              <div className="notice warn">
                <span>
                  <strong>Researched for F&amp;B.</strong> These benchmarks cover ground-floor food
                  and beverage units. Applied to {SECTOR_LABELS[sectorOf(category)].toLowerCase()},
                  treat the figure as indicative only and enter the rent you were quoted to replace
                  it.
                </span>
              </div>
            )}

            {/* Provenance sits with the figure, not in a footnote. A benchmark
                read as a quote is the main way this panel could mislead. */}
            {rent.kind === "proxy" && rent.district && (
              <div className="notice warn">
                <span>
                  <strong>Inferred, not quoted.</strong> Benchmark for {rent.district.label},{" "}
                  {formatNumber(rent.distanceMetres ?? 0)}m from this pin. {rent.source}, reviewed{" "}
                  {rent.reviewed}. Enter your actual rent to replace it.
                </span>
              </div>
            )}

            {rent.kind === "direct" && (
              <div className="notice info">
                <span>
                  <strong>Your figure.</strong> This is the rent you entered, so it carries more
                  weight in the Success Score than any benchmark would.
                  {rent.district &&
                    ` For reference, ${rent.district.label} benchmarks at RM${rent.district.rentMedianPsf}/sqft.`}
                </span>
              </div>
            )}
          </>
        )}

        <div className="field-row">
          <label>
            <span className="tiny muted">Rent you were quoted (RM/month)</span>
            <input
              type="number"
              min={0}
              step={100}
              value={overrideRent ?? ""}
              placeholder={rent?.kind === "proxy" ? String(rent.monthlyRent) : "e.g. 9000"}
              onChange={(e) => {
                // Number("") is 0, and a rent of 0 is not "no rent" — it would
                // score as a free shop. Empty clears back to the benchmark.
                const raw = e.target.value.trim();
                onOverrideRent(raw === "" ? null : Number(raw));
              }}
            />
          </label>

          <label>
            <span className="tiny muted">Unit size (sqft)</span>
            <input
              type="number"
              min={0}
              step={50}
              value={unitSqft ?? ""}
              placeholder="optional"
              onChange={(e) => {
                const raw = e.target.value.trim();
                onUnitSqft(raw === "" ? null : Number(raw));
              }}
            />
          </label>
        </div>

        {/* The spec's "Available properties". Area precision, best first: the
            benchmark label is a real trading area, the district is broader,
            and the searched label is whatever the user typed. */}
        <AvailableProperties
          area={rent?.district?.label ?? districtName ?? null}
          state={stateName}
          listings={listings}
          loading={listingsLoading}
        />

        {simulatorHref && (
          <div>
            <a className="tiny cta" href={simulatorHref}>
              Open in simulator with this rent
            </a>
          </div>
        )}

        <div className="tiny muted">
          Benchmarks are researched estimates for ground-floor F&amp;B, not transacted rents.
          Malaysia&rsquo;s transacted figures (NAPIC) are not published in any machine-readable
          form, so treat these as a starting point and replace them with a real quote.
        </div>
      </div>
    </section>
  );
}
