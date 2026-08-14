import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  RADIUS_BUCKETS,
  compareLocations,
  listCategories,
  resolveRent,
  roundForCache,
  scoreLocation,
  type BusinessCategory,
  type ComparedLocation,
} from "@spotential/sim-engine";
import { Masthead } from "../components/Masthead.js";
import { CompareRadar } from "../components/CompareRadar.js";
import { CompareTable } from "../components/CompareTable.js";
import { ReportButton } from "../components/ReportButton.js";
import { postCompetitors, postDemographics } from "../lib/api.js";
import {
  MAX_COMPARED,
  comparisonSearchParams,
  parseComparisonFromSearch,
} from "../lib/compareUrl.js";
import type { PickedLocation } from "../lib/location.js";

/**
 * Side-by-side comparison — Feature 2.
 *
 * Category and radius are held HERE, at the comparison level, not per
 * location. Comparing a 250m Korean search against a 1km cafe search would
 * produce two numbers that cannot be ranked against each other, so the design
 * makes that state unreachable.
 *
 * Gap detection is deliberately not run: it costs six Places calls per
 * location and this page is about the score, not the category ranking.
 */
export default function Compare() {
  const initial = useMemo(() => parseComparisonFromSearch(window.location.search), []);

  const [category, setCategory] = useState<BusinessCategory>(initial.state.category);
  const [radiusMetres, setRadiusMetres] = useState<number>(initial.state.radiusMetres);
  const [locations, setLocations] = useState<PickedLocation[]>(initial.state.locations);
  const [rents, setRents] = useState<(number | null)[]>(initial.state.rents ?? []);

  // Feature 1e. Positionally aligned with `locations`; undefined where the
  // user has no quote, which falls back to the benchmark for that spot.
  const rentOverrides = useMemo(
    () =>
      locations.map((_, index) => {
        const rent = rents[index];
        return rent && rent > 0 ? { monthlyRent: rent } : undefined;
      }),
    [locations, rents],
  );

  // Keep the link current, so copying the address bar shares the comparison.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.search = comparisonSearchParams({ category, radiusMetres, locations, rents }).toString();
    window.history.replaceState(null, "", url.toString());
  }, [category, radiusMetres, locations, rents]);

  // One competitor search and one demographics lookup per location. Both ride
  // the same server-side caches as /analysis, keyed on rounded coordinates.
  const results = useQueries({
    queries: locations.flatMap((location) => [
      {
        queryKey: [
          "competitors",
          roundForCache(location.lat),
          roundForCache(location.lng),
          radiusMetres,
          category,
        ],
        queryFn: () =>
          postCompetitors({ lat: location.lat, lng: location.lng, radiusMetres, category }),
        staleTime: 10 * 60 * 1000,
        retry: 1,
      },
      {
        queryKey: [
          "demographics",
          roundForCache(location.lat),
          roundForCache(location.lng),
          radiusMetres,
        ],
        queryFn: () =>
          postDemographics({ lat: location.lat, lng: location.lng, radiusMetres }),
        staleTime: 60 * 60 * 1000,
        retry: 1,
      },
    ]),
  });

  const loading = results.some((r) => r.isPending);

  const scored: ComparedLocation[] = locations.flatMap((location, index) => {
    const competitors = results[index * 2]?.data as
      | Awaited<ReturnType<typeof postCompetitors>>
      | undefined;
    const demographics = results[index * 2 + 1]?.data as
      | Awaited<ReturnType<typeof postDemographics>>
      | undefined;

    if (!competitors) return [];

    return [
      {
        id: `${location.lat},${location.lng}`,
        label: location.label,
        score: scoreLocation({
          competitors: competitors.summary,
          truncated: competitors.truncated,
          completeToMetres: competitors.completeToMetres,
          radiusMetres,
          demographics: demographics?.demographics ?? null,
          catchment: demographics?.catchment?.population ?? null,
          // Feature 1e. Resolves from coordinates alone — a table lookup, no
          // request and no cost, so the fifth axis costs nothing to fill. Null
          // where no benchmark covers the pin, which stays "no data" rather
          // than becoming a win by default.
          rent: resolveRent(location, category, rentOverrides[index]),
          category,
          point: location,
        }),
      },
    ];
  });

  /**
   * How many locations have a rent figure at all.
   *
   * Drives the caveat wording: "missing for every location" was true before
   * 1e and is now usually false, and leaving it hardcoded would have the page
   * disclaiming data it is actually showing.
   */
  const withRent = scored.filter(
    (s) => s.score.dimensions.find((d) => d.key === "rent")?.kind !== "unavailable",
  ).length;

  const comparison = useMemo(() => compareLocations(scored), [scored]);

  return (
    <>
      <Masthead subtitle="Comparison">
        <span className="pill muted">
          {locations.length} of {MAX_COMPARED}
        </span>

        {/* Needs two scored locations: a comparison report of one would be a
            location report with a misleading title. */}
        <ReportButton
          disabled={loading || scored.length < 2}
          body={() => ({
            kind: "comparison",
            category,
            radiusMetres,
            locations: locations.flatMap((location, index) => {
              const data = results[index * 2]?.data as
                | Awaited<ReturnType<typeof postCompetitors>>
                | undefined;
              const demo = results[index * 2 + 1]?.data as
                | Awaited<ReturnType<typeof postDemographics>>
                | undefined;
              if (!data) return [];

              return [
                {
                  point: { lat: location.lat, lng: location.lng },
                  label: location.label,
                  competitors: data.summary,
                  truncated: data.truncated,
                  completeToMetres: data.completeToMetres,
                  density: data.density,
                  demographics: demo?.demographics ?? null,
                  rentOverride: rents[index] ?? null,
                },
              ];
            }),
          })}
        />
      </Masthead>

      {initial.dropped > 0 && (
        <div className="notice danger no-print" style={{ margin: 0, borderRadius: 0 }}>
          {initial.dropped} location{initial.dropped === 1 ? "" : "s"} in that link could not be
          read and {initial.dropped === 1 ? "was" : "were"} left out.
        </div>
      )}

      <div className="layout">
        <aside className="col-inputs no-print">
          <section className="card">
            <header>
              <h2>Compared on</h2>
            </header>
            <div className="body">
              {/* Comparison-level, never per location. */}
              <div className="field">
                <label htmlFor="compare-category">Business type</label>
                <select
                  id="compare-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as BusinessCategory)}
                >
                  {listCategories().map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="compare-radius">Search radius</label>
                <select
                  id="compare-radius"
                  value={radiusMetres}
                  onChange={(e) => setRadiusMetres(Number(e.target.value))}
                >
                  {RADIUS_BUCKETS.map((r) => (
                    <option key={r} value={r}>
                      {r}m
                    </option>
                  ))}
                </select>
                <span className="source">
                  Both apply to every location — comparing different categories or radii would not
                  be a comparison.
                </span>
              </div>
            </div>
          </section>

          <section className="card">
            <header>
              <h2>Locations</h2>
            </header>
            <div className="body stack">
              {locations.length === 0 && (
                <span className="small muted">
                  Nothing to compare yet. Open a spot on the Location page and use “Add to
                  comparison”.
                </span>
              )}
              {locations.map((location) => (
                <div className="spread" key={`${location.lat},${location.lng}`}>
                  <span className="small">{location.label}</span>
                  <button
                    type="button"
                    className="tiny"
                    onClick={() => {
                      // Rents are positional, so they must be removed in
                      // lockstep or every later one shifts onto the wrong site.
                      const index = locations.indexOf(location);
                      setLocations((current) => current.filter((_, i) => i !== index));
                      setRents((current) => current.filter((_, i) => i !== index));
                    }}
                  >
                    remove
                  </button>
                </div>
              ))}
              <a className="small" href="/analysis">
                Add another from the Location page →
              </a>
            </div>
          </section>
        </aside>

        <main className="col-detail">
          {locations.length < 2 ? (
            <section className="card">
              <header>
                <h2>Comparison</h2>
              </header>
              <div className="body">
                <div className="notice info">
                  Add at least two locations to compare. A single score means little on its own —
                  the point is the difference between two sites.
                </div>
              </div>
            </section>
          ) : (
            <section className="card">
              <header>
                <h2>Location profiles</h2>
                {!loading && comparison.winnerId && (
                  <span className="pill green">
                    best: {scored.find((s) => s.id === comparison.winnerId)?.label}
                  </span>
                )}
                {!loading && !comparison.winnerId && scored.length > 1 && (
                  <span className="pill amber">too close to call</span>
                )}
              </header>

              <div className="body">
                <div className="notice info" style={{ marginBottom: 12 }}>
                  <span>
                    These are <strong>comparison scores, not forecasts</strong>. Nothing here has
                    been validated against real outcomes. Read the shapes and the dimension
                    differences below rather than the totals alone.
                    {withRent === 0
                      ? " Rent sensitivity is missing for every location — no benchmark covers these spots."
                      : withRent < scored.length
                        ? " Rent sensitivity is inferred for some locations and missing for others, so weigh that dimension carefully."
                        : " Rent figures are researched benchmarks unless you entered a quote, so treat that dimension as indicative."}
                  </span>
                </div>

                {loading ? (
                  <div className="small muted">Scoring each location…</div>
                ) : (
                  <>
                    <CompareRadar locations={scored} />
                    <CompareTable locations={scored} comparison={comparison} />
                  </>
                )}
              </div>
            </section>
          )}
        </main>
      </div>
    </>
  );
}
