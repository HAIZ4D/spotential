import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  compareLocations,
  resolveRent,
  roundForCache,
  scoreLocation,
  type BusinessCategory,
  type ComparedLocation,
} from "@spotential/sim-engine";
import { Masthead } from "../components/Masthead.js";
import { CompareRadar } from "../components/CompareRadar.js";
import { CompareToolbar } from "../components/compare/CompareToolbar.js";
import { CompareHero } from "../components/compare/CompareHero.js";
import { DimensionCompare } from "../components/compare/DimensionCompare.js";
import { CompareTable } from "../components/CompareTable.js";
import { CompareAI } from "../components/compare/CompareAI.js";
import { ReportButton } from "../components/ReportButton.js";
import { postCompetitors, postDemographics } from "../lib/api.js";
import {
  MAX_COMPARED,
  comparisonSearchParams,
  parseComparisonFromSearch,
  readPendingComparison,
  writePendingComparison,
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
  /**
   * The comparison to open with, and the ORDER here is the whole safety of it.
   *
   * THE URL WINS. Somebody opening a link you sent must see your comparison,
   * not whatever they were last looking at. A restore that quietly overrode
   * the address bar would show them two sites they never chose, on a page
   * whose header offers to share that link.
   *
   * Only when the URL carries nothing does the saved copy come back. That is
   * the case the owner hit: the nav's Compare link is a bare `/compare`, so
   * leaving for Events and returning landed on an empty page and the work was
   * genuinely gone. `readPendingComparison` already existed for the
   * "Add to comparison" flow and nothing had ever called it from here.
   */
  const initial = useMemo(() => {
    const fromUrl = parseComparisonFromSearch(window.location.search);
    if (fromUrl.state.locations.length > 0) return fromUrl;

    const saved = readPendingComparison();
    // An empty save is not a save: a first-ever visit must still get the
    // "Add a second location" state rather than an empty shell.
    if (!saved || saved.locations.length === 0) return fromUrl;

    return { ...fromUrl, state: saved };
  }, []);

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

  /**
   * Keep the link current, and keep a copy that survives navigation.
   *
   * The URL stays the durable, shareable record; the stored copy exists only
   * so that returning to a bare `/compare` finds the work again. Writing both
   * from one effect is what stops the two drifting apart.
   *
   * It runs on the RESTORED state as well as on edits, deliberately: that is
   * what puts the locations back into the address bar after a restore, so the
   * link is shareable again rather than being a dead `/compare`.
   */
  useEffect(() => {
    const state = { category, radiusMetres, locations, rents };
    const url = new URL(window.location.href);
    url.search = comparisonSearchParams(state).toString();
    window.history.replaceState(null, "", url.toString());

    // Never store an empty comparison: it would turn a deliberate "remove the
    // last site" into a restore of nothing, and mask a real first visit.
    if (locations.length > 0) writePendingComparison(state);
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

  /**
   * The payload the SERVER is given, built once.
   *
   * The PDF and the AI panel both send this, and they must send the same
   * thing: a report and an analysis describing different inputs would be two
   * authoritative documents that disagree. It used to be built inline inside
   * the report button's prop, which is exactly how a second copy gets written.
   *
   * Note what is NOT here: catchment. The server measures that from its own
   * population grid for every one of these routes, because it is a
   * measurement and a client has no business asserting it.
   */
  const reportLocations = useMemo(
    () =>
      locations.flatMap((location, index) => {
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
    [locations, results, rents],
  );

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
            locations: reportLocations,
          })}
        />
      </Masthead>

      {initial.dropped > 0 && (
        <div className="notice danger no-print" style={{ margin: 0, borderRadius: 0 }}>
          {initial.dropped} location{initial.dropped === 1 ? "" : "s"} in that link could not be
          read and {initial.dropped === 1 ? "was" : "were"} left out.
        </div>
      )}

      <CompareToolbar
        category={category}
        onCategory={setCategory}
        radiusMetres={radiusMetres}
        onRadius={setRadiusMetres}
        locations={locations}
        onRemove={(index) => {
          // Rents are positional, so they must be removed in lockstep or
          // every later one shifts onto the wrong site.
          setLocations((current) => current.filter((_, i) => i !== index));
          setRents((current) => current.filter((_, i) => i !== index));
        }}
      />

      {locations.length < 2 ? (
        <div className="cmpx">
          <div className="cmpx-empty">
            <h2>Add a second location</h2>
            <p>
              A single score means little on its own. The point of this page is the difference
              between two sites, so it waits until it has two to difference.
            </p>
            <p className="tiny muted">
              Score a location first, then use <strong>Add to comparison</strong> on it. The
              business type and radius you pick here apply to every site.
            </p>
          </div>
        </div>
      ) : loading ? (
        <div className="cmpx">
          {/* Holds the shape the answer will take, so the page does not jolt
              when the scores land. */}
          <div className="cmpx-skeleton" aria-live="polite">
            Scoring each location&hellip;
          </div>
        </div>
      ) : (
        <>
          <div className="cmpx">
            <CompareHero locations={scored} comparison={comparison} />

            {/* The ledger IS the page: one row per dimension, both sites, and
                the gap between them. Full width, because a difference needs
                horizontal room to be visible and the old two-column shell left
                the whole bottom-right of the page empty. */}
            <section className="cmpx-panel">
              <header className="cmpx-panel-head">
                <span className="cmpx-kicker">Dimension by dimension</span>
                <h2>Where the difference actually is</h2>
              </header>
              <DimensionCompare locations={scored} comparison={comparison} />
            </section>

            <CompareAI
              category={category}
              radiusMetres={radiusMetres}
              locations={reportLocations}
              scored={scored}
              comparison={comparison}
            />

            <section className="cmpx-panel">
              <header className="cmpx-panel-head">
                <span className="cmpx-kicker">Profile shapes</span>
                <h2>The same scores, as a shape</h2>
              </header>
              <CompareRadar locations={scored} />
            </section>

            {/* Folded, never trimmed. It holds exactly the figures above, so
                it is duplication on screen — but it tallies, it labels every
                cell measured or inferred, and it is the part that prints. Same
                treatment the event page gives its score working. */}
            <details className="cmpx-working">
              <summary>Show every figure</summary>
              <CompareTable locations={scored} comparison={comparison} />
            </details>

            <div className="notice info cmpx-caveat">
              <span>
                These are <strong>comparison scores, not forecasts</strong>. Nothing here has been
                validated against real outcomes. Read the dimension differences rather than the
                totals alone.
                {withRent === 0
                  ? " Rent sensitivity is missing for every location: no benchmark covers these spots."
                  : withRent < scored.length
                    ? " Rent sensitivity is inferred for some locations and missing for others, so weigh that dimension carefully."
                    : " Rent figures are researched benchmarks unless you entered a quote, so treat that dimension as indicative."}
              </span>
            </div>

            <p className="cmpx-sourceline">
              Business type and radius apply to every location. Comparing different categories or
              radii would not be a comparison.
            </p>
          </div>
        </>
      )}

    </>
  );
}
