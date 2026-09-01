import { useMemo, useState } from "react";
import {
  distanceMetres,
  formatCurrency,
  formatNumber,
  nearestDistrict,
  rentSensitivity,
  type BusinessCategory,
  type LatLng,
  type ResolvedRent,
} from "@spotential/sim-engine";
import { CURATED_RENTALS, RENTALS_COMPILED, type CuratedRental } from "../../lib/rentals.js";

/**
 * Real units, with the app's own arithmetic run over each one.
 *
 * A listing site can show you a photograph and a monthly rent. What it cannot
 * tell you is whether that rent is survivable, which is the only question a
 * stallholder actually has. Every card here answers it twice:
 *
 *   PSF AGAINST THE AREA BENCHMARK, because a monthly figure on its own is
 *   meaningless across sizes. RM 180,000 for 24,000 sqft is cheaper per foot
 *   than RM 60,000 for 2,000. The compiler of this shortlist made the same
 *   point in their own words, and the benchmark is what turns it into a verdict
 *   rather than a comparison between the fourteen units that happen to be here.
 *
 *   CUSTOMERS PER DAY, from the same `rentSensitivity` the score uses. That is
 *   the number a shop owner can actually judge from experience: 190 covers is
 *   a busy lunch service, and knowing a unit demands it is worth more than any
 *   photograph.
 *
 * The asking prices never reach the score. This component lives in the web app
 * and the scoring engine cannot import it.
 */

const SORTS = [
  { id: "psf", label: "Best value" },
  { id: "rent", label: "Cheapest" },
  { id: "near", label: "Nearest" },
] as const;
type SortId = (typeof SORTS)[number]["id"];

/** How a unit's asking rent compares with what the area benchmark says. */
function verdictFor(psf: number, benchmarkPsf: number | null) {
  if (benchmarkPsf === null || benchmarkPsf <= 0) return null;
  const ratio = psf / benchmarkPsf;
  if (ratio <= 0.75) return { cls: "green", label: "under the area rate" };
  if (ratio <= 1.15) return { cls: "amber", label: "about the area rate" };
  return { cls: "red", label: "above the area rate" };
}

export function CuratedRentals({
  point,
  category,
  rent,
}: {
  point: LatLng;
  category: BusinessCategory;
  /** The resolved benchmark, for the comparison. Null when none covers the pin. */
  rent: ResolvedRent | null;
}) {
  const [sort, setSort] = useState<SortId>("psf");

  const rows = useMemo(() => {
    const withDistance = CURATED_RENTALS.map((listing) => ({
      listing,
      metres: distanceMetres(point, listing.point),
    }));

    if (sort === "rent") return [...withDistance].sort((a, b) => a.listing.monthlyRent - b.listing.monthlyRent);
    if (sort === "near") return [...withDistance].sort((a, b) => a.metres - b.metres);
    return [...withDistance].sort((a, b) => a.listing.psf - b.listing.psf);
  }, [point, sort]);


  return (
    <section className="card rentals">
      <header>
        <h2>Units on the market</h2>
        <span className="pill muted">{CURATED_RENTALS.length} in KL</span>
      </header>

      <div className="body stack">
        {/* The date is not a footnote. A listing is gone in weeks and the
            reader has to be able to weigh how old this is. */}
        <p className="tiny muted">
          A shortlist compiled by hand on {RENTALS_COMPILED}. Asking prices, not transacted rents,
          and none of it reaches the score. Confirm anything here with the agent before you act on
          it.
        </p>

        <div className="segmented rentals-sort">
          {SORTS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={sort === s.id}
              onClick={() => setSort(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>

        <ul className="rentals-grid">
          {rows.map(({ listing, metres }) => (
            <RentalCard
              key={listing.id}
              listing={listing}
              metres={metres}
              category={category}
              rent={rent}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

function RentalCard({
  listing,
  metres,
  category,
  rent,
}: {
  listing: CuratedRental;
  metres: number;
  category: BusinessCategory;
  rent: ResolvedRent | null;
}) {
  /**
   * The benchmark for where the UNIT is, not where the pin is.
   *
   * Resolving it from the pin and then printing the listing's area beside it
   * produced "Kepong benchmark RM 15.00" — which is KLCC's rate, judging a
   * suburban shop against city-centre pricing and calling it good value. A
   * number attached to the wrong place is worse than no number.
   */
  const nearby = useMemo(() => nearestDistrict(listing.point), [listing.point]);
  const benchmarkPsf = nearby?.district.rentMedianPsf ?? null;
  const benchmarkLabel = nearby?.district.label ?? null;

  const verdict = verdictFor(listing.psf, benchmarkPsf);

  /**
   * What this specific unit would demand, through the same engine the score
   * uses. Built from the LISTING's rent, so it answers "could I trade here"
   * rather than repeating the area figure the panel above already gave.
   */
  const demand = useMemo(() => {
    if (!rent) return null;
    const asUnit: ResolvedRent = {
      ...rent,
      monthlyRent: listing.monthlyRent,
      psf: listing.psf,
      unitSqft: listing.sizeSqft,
      kind: "direct",
    };
    return rentSensitivity(asUnit, category, listing.point);
  }, [listing, category, rent]);

  return (
    <li className="rental">
      <div className="rental-photo">
        <img src={listing.photo} alt="" loading="lazy" decoding="async" />
        <span className={`rental-psf ${verdict?.cls ?? ""}`}>RM {listing.psf.toFixed(2)} psf</span>
      </div>

      <div className="rental-body">
        <h3>{listing.title}</h3>

        <p className="rental-figures">
          <strong>{formatCurrency(listing.monthlyRent)}</strong>
          <span className="muted"> / month</span>
          <span className="rental-dot" aria-hidden="true" />
          {formatNumber(listing.sizeSqft)} sq ft
        </p>

        {/* The line that no listing site can give you. */}
        {demand?.breakEvenPerDay ? (
          <p className="rental-breakeven">
            Needs <strong>{formatNumber(demand.breakEvenPerDay)} customers a day</strong> to cover
            fixed costs at this rent
          </p>
        ) : null}

        {verdict ? (
          <p className={`rental-verdict ${verdict.cls}`}>
            {verdict.label}
            {benchmarkPsf !== null && benchmarkLabel && (
              <span className="muted">
                {" · "}
                {benchmarkLabel} benchmark RM {benchmarkPsf.toFixed(2)}
              </span>
            )}
          </p>
        ) : null}

        <p className="rental-where">
          {listing.area}
          <span className="muted"> · {formatNumber(Math.round(metres / 100) / 10)} km from your pin</span>
        </p>

        {listing.transit ? <p className="tiny muted">{listing.transit}</p> : null}

        {/* Kept verbatim, including the sceptical ones. These are the most
            useful sentences in the whole shortlist. */}
        {listing.note ? <p className="rental-note">{listing.note}</p> : null}

        <p className="tiny muted rental-agent">
          {listing.agent ? `Listed by ${listing.agent}` : "Agent not stated"}
          {listing.posted ? ` · ${listing.posted}` : ""}
        </p>
      </div>
    </li>
  );
}
