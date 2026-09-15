import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { APIProvider, useApiLoadingStatus, useMap, APILoadingStatus } from "@vis.gl/react-google-maps";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  rentSensitivity,
  formatNumber,
  listDistricts,
  resolveRent,
  roundForCache,
  scoreLocation,
  sectorOf,
  type BusinessCategory,
  type DistrictPreset,
} from "@spotential/sim-engine";
import { Masthead } from "../components/Masthead.js";
import { AddressSearch } from "../components/AddressSearch.js";
import { CompetitorPins, RadiusCircle } from "../components/CompetitorOverlay.js";
import {
  CompetitionDensity,
  CompetitorList,
  CompetitorScatter,
} from "../components/CompetitorPanels.js";
import { DemographicsPanel } from "../components/DemographicsPanel.js";
import { SuccessScore } from "../components/SuccessScore.js";
import { RentPanel } from "../components/RentPanel.js";
import { ScoreRing } from "../components/analysis/ScoreRing.js";
import { Verdict } from "../components/analysis/Verdict.js";
import { StatChips, type Chip } from "../components/analysis/StatChips.js";
import { SectionTabs, type SectionId, type SectionTab } from "../components/analysis/SectionTabs.js";
import { MapPane } from "../components/analysis/MapPane.js";
import { HeatLayer } from "../components/heatmap/HeatLayer.js";
import { AmenityPins, RentPins } from "../components/heatmap/AmenityPins.js";
import { rankAreas } from "../components/heatmap/CitySummary.js";
import { DemandSection } from "../components/analysis/DemandSection.js";
import { MapLegend } from "../components/analysis/MapLegend.js";
import { Toolbar } from "../components/analysis/Toolbar.js";
import { ReportButton } from "../components/ReportButton.js";
import { SpotentialAI, deriveSummary } from "../components/analysis/SpotentialAI.js";
import {
  getAmenities,
  getHeatmap,
  getProperties,
  postCompetitors,
  postDemographics,
  postOpportunityGaps,
  type CompetitorsResponse,
  type DemographicsResponse,
  type AmenityLayer,
  type HeatmapCell,
  type ReportLocation,
} from "../lib/api.js";
import { appendToComparison, comparisonHref } from "../lib/compareUrl.js";
import {
  bucketBounds,
  canFetchAmenities,
  amenityBoxFor,
  canFetchGrid,
  cellAt,
  cellsWithin,
  demandBounds,
  framingRadius,
  padBounds,
  type Bounds,
} from "../lib/demand.js";
import { useDebounced } from "../lib/useDebounced.js";
import {
  DEFAULT_LOCATION,
  formatLatLng,
  isInMalaysia,
  locationSearchParams,
  parseLocationFromSearch,
  parseRentFromSearch,
  type PickedLocation,
} from "../lib/location.js";
const MAPS_API_KEY: string = import.meta.env["VITE_GOOGLE_MAPS_API_KEY"] ?? "";
/**
 * Google calls this global when the key is rejected at runtime — wrong
 * referrer, billing off, API not enabled.
 *
 * It is NOT a script load failure, so APILoadingStatus never reports it and
 * the widgets quietly replace themselves with Google's grey "Oops! Something
 * went wrong" panel. Catching it lets us say what is actually wrong instead.
 */
declare global {
  interface Window {
    gm_authFailure?: (() => void) | undefined;
  }
}
function useMapsAuthFailure(): boolean {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const previous = window.gm_authFailure;
    window.gm_authFailure = () => {
      setFailed(true);
      previous?.();
    };
    return () => {
      window.gm_authFailure = previous;
    };
  }, []);
  return failed;
}
/**
 * Location Analysis — slices 1a and 1b.
 *
 * Pick a spot, see it, and see who else is already trading there.
 *
 * Competitor data comes from our own Cloud Run service, NOT from Google
 * directly, so it must keep working when Maps does not. A blocked Maps script
 * costs you the map and Street View; it does not cost you the analysis.
 */
export default function Analysis() {
  const fromLink = useMemo(() => parseLocationFromSearch(window.location.search), []);
  const [location, setLocation] = useState<PickedLocation>(
    fromLink.ok ? fromLink.location : DEFAULT_LOCATION,
  );
  const [category, setCategory] = useState<BusinessCategory>("korean_restaurant");
  const [radiusMetres, setRadiusMetres] = useState<number>(500);
  // Feature 1e. The one figure on this page the USER supplied, so it survives
  // a reload rather than having to be retyped.
  const rentFromLink = useMemo(() => parseRentFromSearch(window.location.search), []);
  const [overrideRent, setOverrideRent] = useState<number | null>(rentFromLink.monthlyRent);
  const [unitSqft, setUnitSqft] = useState<number | null>(rentFromLink.unitSqft);
  /** Which section the tab bar is showing. Overview holds the full profile. */
  const [section, setSection] = useState<SectionId>("overview");
  /** Shared by the competitor list and the map pins, which sit side by side. */
  const [hoveredCompetitor, setHoveredCompetitor] = useState<string | null>(null);
  const heroRef = useRef<HTMLElement>(null);
  /**
   * The hero resolves once, on arrival.
   *
   * The rings expand outward like a sweep going out from the pin, which is
   * what the page is doing. `useGSAP` with a scope rather than a raw effect:
   * a killed `from` strands its targets instead of putting them back, and
   * this codebase has paid for that three times.
   */
  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap
        .timeline()
        .from(".hero-rings", { scale: 0.72, opacity: 0, duration: 1.1, ease: "power2.out" })
        .from(".hero-eyebrow", { y: 10, opacity: 0, duration: 0.4, ease: "power2.out" }, 0.05)
        .from(".hero-name", { y: 16, opacity: 0, duration: 0.55, ease: "power3.out" }, 0.12)
        .from(".hero-answer", { y: 14, opacity: 0, duration: 0.5, ease: "power2.out" }, 0.24)
        .from(
          ".chips > *",
          { y: 10, opacity: 0, duration: 0.4, stagger: 0.05, ease: "power2.out" },
          0.34,
        );
    },
    { scope: heroRef },
  );
  /**
   * The population surface under the pin, showing where the catchment came
   * from — this page's "people within 500m" is computed from that same grid.
   */
  const [demand, setDemand] = useState(false);
  /**
   * The visible map box, reported on every camera settle.
   *
   * The demand layers describe WHAT IS ON SCREEN, so they follow the real
   * viewport rather than a fixed box around the pin — that is what lets
   * zooming out give a city view, which is what City Demand was for.
   */
  const [view, setView] = useState<Bounds | null>(null);
  /** Which amenity layers are drawn, and whether rent benchmarks show. */
  const [activeLayers, setActiveLayers] = useState<Set<string>>(() => new Set());
  const [showRentPins, setShowRentPins] = useState(false);
  /**
   * Where to move the CAMERA when a ranked area or rent pin is chosen.
   *
   * Never the pin: exploring the city must not silently re-point the analysis.
   * The score, the score ring and every panel still describe the marker.
   */
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number } | null>(null);
  const onBoundsChange = useCallback((next: Bounds) => setView(next), []);
  /**
   * Two booleans, one owner each. `demand` draws the surface; this also turns
   * on when the tab is open, so opening it loads the data without the tab
   * having to reach into the map's state.
   */
  const demandActive = demand || section === "demand";
  /**
   * Whether the SHADING is on because the Demand tab turned it on, rather than
   * because the reader did.
   *
   * Opening the tab used to widen the camera and stop there, so the map went
   * wide and blank and the reader had to scroll back up to the map's own
   * Demand button before there was anything to see. The tab now shades the
   * map as it opens.
   *
   * It only takes back what it gave. Leaving the tab switches the shading off
   * if the tab switched it on, and leaves it alone if the reader turned it on
   * first. Any hand toggle, from either button, hands ownership back to the
   * reader. Without that, every other tab would inherit a map zoomed out to
   * 2.5km around a 500m question.
   */
  const shadedByTab = useRef(false);
  const selectSection = (next: SectionId) => {
    if (next === section) return;
    if (next === "demand" && !demand) {
      shadedByTab.current = true;
      setDemand(true);
    } else if (section === "demand" && shadedByTab.current) {
      shadedByTab.current = false;
      setDemand(false);
    }
    setSection(next);
  };
  const shadeByHand = (next: boolean) => {
    shadedByTab.current = false;
    setDemand(next);
  };
  // Bounds move on every pixel of a pan. Bucketed to ~110m for the query key
  // and debounced on top, so a drag collapses into one or two fetches.
  const settledView = useDebounced(view, 350);
  // Same pattern as the simulator's share links: replaceState on a debounce,
  // so dragging the pin does not stack up history entries.
  const settled = useDebounced(location, 400);
  const settledRent = useDebounced(overrideRent, 400);
  const settledSqft = useDebounced(unitSqft, 400);
  useEffect(() => {
    const url = new URL(window.location.href);
    url.search = locationSearchParams(settled, {
      monthlyRent: settledRent,
      unitSqft: settledSqft,
    }).toString();
    window.history.replaceState(null, "", url.toString());
  }, [settled, settledRent, settledSqft]);
  const pickCoordinates = useCallback(({ lat, lng }: { lat: number; lng: number }) => {
    // A map click has no address, so label it by coordinates until the user
    // searches for something. Honest rather than inventing a name.
    setLocation({ lat, lng, label: formatLatLng({ lat, lng }) });
  }, []);
  // Keyed on the ROUNDED location so nudging the pin a few metres reuses the
  // result rather than triggering another request. The server rounds
  // identically for its cache key, so the two stay in step.
  const competitors = useQuery({
    queryKey: [
      "competitors",
      roundForCache(settled.lat),
      roundForCache(settled.lng),
      radiusMetres,
      category,
    ],
    queryFn: ({ signal }) =>
      postCompetitors({ lat: settled.lat, lng: settled.lng, radiusMetres, category }, signal),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
  /**
   * Gap detection, scoped to the selected category's SECTOR.
   *
   * It used to look at all six F&B categories regardless. With fifteen
   * categories that would be fifteen Places calls per location — 2.5x the
   * cost on the most expensive route in the app. The sector is part of the
   * query key so switching between F&B and retail refetches rather than
   * showing the wrong league table.
   */
  const gaps = useQuery({
    queryKey: [
      "gaps",
      roundForCache(settled.lat),
      roundForCache(settled.lng),
      radiusMetres,
      sectorOf(category),
    ],
    queryFn: ({ signal }) =>
      postOpportunityGaps({ lat: settled.lat, lng: settled.lng, radiusMetres, category }, signal),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
  // Pure server-side computation, no external API, so cache it aggressively.
  const demographics = useQuery({
    // Radius is part of the key: the catchment sum depends on it, so a radius
    // change must refetch rather than serve a figure for the old one.
    queryKey: [
      "demographics",
      roundForCache(settled.lat),
      roundForCache(settled.lng),
      radiusMetres,
    ],
    queryFn: ({ signal }) =>
      postDemographics({ lat: settled.lat, lng: settled.lng, radiusMetres }, signal),
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
  /**
   * The population grid, only while the surface is on.
   *
   * Free to serve — a precomputed blob, no Places and no Gemini — so the whole
   * layer costs one cached request. Keyed on the ROUNDED centre so nudging the
   * pin does not refetch a grid that covers several kilometres either way.
   */
  const gridBox = settledView ? padBounds(settledView) : demandBounds(settled);
  const grid = useQuery({
    queryKey: ["analysis-grid", bucketBounds(gridBox)],
    queryFn: ({ signal }) => getHeatmap(gridBox, signal),
    enabled: demandActive && canFetchGrid(gridBox),
    staleTime: 60 * 60 * 1000,
    // Keeps the current surface on screen while a wider one loads, rather than
    // blanking the map between zoom levels.
    placeholderData: (prev) => prev,
  });
  /**
   * Transit, malls, hospitals and the rest — free, from a versioned snapshot
   * for the four shipped cities and a cached Overpass call elsewhere.
   *
   * Skipped rather than attempted past the 0.3-degree cap: firing it anyway
   * spends a round trip to be told 400, and reads to the user as a broken
   * layer rather than one that is simply out of range.
   */
  // Snapped to a seeded city box where possible, so the four shipped cities
  // answer from the in-image snapshot instead of a live Overpass call.
  const amenityBox = amenityBoxFor(settledView ?? demandBounds(settled));
  const amenities = useQuery({
    queryKey: ["analysis-amenities", bucketBounds(amenityBox)],
    queryFn: ({ signal }) => getAmenities(amenityBox, signal),
    enabled: demandActive && canFetchAmenities(amenityBox),
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
    placeholderData: (prev) => prev,
  });
  /**
   * Everything the demand panel reports, computed from WHAT IS ON SCREEN.
   *
   * The grid is deliberately fetched past the frame so the blur has no visible
   * edge — but the totals, the median, the ranked areas and the rent pins all
   * claim to describe the view, so they are computed from the view. Counting
   * the padding would quietly make every figure describe a bigger area than
   * the one being looked at.
   */
  const gridCells = grid.data?.cells ?? [];
  const amenityLayers = amenities.data?.layers ?? [];
  const inView = useMemo(
    () => (settledView ? cellsWithin(gridCells, settledView) : gridCells),
    [gridCells, settledView],
  );
  /** The cell the PIN is in — not one the reader had to click for. */
  const pinCell = useMemo(() => cellAt(gridCells, location), [gridCells, location.lat, location.lng]);
  const rankedAreas = useMemo(
    () => rankAreas(inView, amenities.data?.places ?? []),
    [inView, amenities.data],
  );
  const rentDistricts = useMemo(
    () =>
      settledView
        ? listDistricts().filter(
            (d) =>
              d.centre.lat >= settledView.south &&
              d.centre.lat <= settledView.north &&
              d.centre.lng >= settledView.west &&
              d.centre.lng <= settledView.east,
          )
        : [],
    [settledView],
  );
  // Feature 1e. Entirely local — a table lookup and a break-even, no request
  // and no cost. Null when no benchmark covers the pin and no rent was typed.
  const rent = useMemo(
    () =>
      resolveRent(
        settled,
        category,
        overrideRent && overrideRent > 0
          ? { monthlyRent: overrideRent, ...(unitSqft ? { unitSqft } : {}) }
          : undefined,
      ),
    [settled, category, overrideRent, unitSqft],
  );
  /**
   * The place name the listings search runs on, best precision first: the
   * resolved benchmark is a real trading area, the DOSM district is broader.
   */
  const listingArea = rent?.district?.label ?? demographics.data?.demographics?.district ?? null;
  /**
   * Real units for rent, from PropertyGuru via our own cache.
   *
   * `enabled` on the Rent tab specifically. This is the one query on the page
   * that reaches a third party's servers rather than our own, so firing it for
   * a tab the user never opens would be rude at their expense and pointless at
   * ours. Cached a day server-side, an hour here.
   */
  const listings = useQuery({
    queryKey: ["properties", listingArea],
    queryFn: ({ signal }) => getProperties(listingArea!, signal),
    enabled: section === "rent" && Boolean(listingArea),
    staleTime: 60 * 60 * 1000,
    // One retry at most: a block or a timeout will not fix itself, and the
    // panel degrades to portal links either way.
    retry: 1,
  });
  // Pure derivation from queries already in flight: no new endpoint, no cost.
  const score = useMemo(() => {
    if (!competitors.data) return null;
    return scoreLocation({
      competitors: competitors.data.summary,
      truncated: competitors.data.truncated,
      completeToMetres: competitors.data.completeToMetres,
      radiusMetres,
      demographics: demographics.data?.demographics ?? null,
      catchment: demographics.data?.catchment?.population ?? null,
      rent,
      category,
      point: settled,
    });
  }, [competitors.data, demographics.data, radiusMetres, rent, category, settled]);
  // Chip figures, from the same rent object the Rent tab renders.
  const sensitivity = useMemo(
    () => (rent ? rentSensitivity(rent, category, settled) : null),
    [rent, category, settled],
  );
  const breakEvenPerDay = sensitivity?.breakEvenPerDay ?? null;
  const rentLight = sensitivity
    ? ({ green: "green", amber: "amber", red: "red" } as const)[sensitivity.light]
    : undefined;
  /**
   * The location context, exactly as the PDF report and the chatbot both need
   * it. One builder so the two cannot end up grounded on different data.
   *
   * Note what it sends: inputs and already-fetched summaries, never a score.
   * The server recomputes with the shared engine.
   */
  const reportLocation = useCallback(
    (): ReportLocation => ({
      point: { lat: settled.lat, lng: settled.lng },
      label: settled.label,
      competitors: competitors.data!.summary,
      truncated: competitors.data!.truncated,
      completeToMetres: competitors.data!.completeToMetres,
      density: competitors.data!.density,
      demographics: demographics.data?.demographics ?? null,
      rentOverride: overrideRent,
      // Nearest first, so the report's table is the nearest N rather than an
      // arbitrary N. The server caps and sanitises them regardless.
      rivals: [...competitors.data!.competitors].sort(
        (a, b) => a.distanceMetres - b.distanceMetres,
      ),
    }),
    [settled, competitors.data, demographics.data, overrideRent],
  );
  /**
   * Hands the rent to the simulator so the two pages agree on it.
   *
   * The simulator reads its own scenario from `?s=`, so this only carries the
   * district and rent as a seed; anything already saved there wins. Null when
   * there is no rent to hand over.
   */
  const simulatorHref = useMemo(() => {
    if (!rent) return null;
    const params = new URLSearchParams({ rent: String(Math.round(rent.monthlyRent)), category });
    if (rent.district) params.set("district", rent.district.id);
    return `/simulator?${params.toString()}`;
  }, [rent, category]);
  /**
   * The link carried location parameters and they did not parse.
   *
   * NOT a substring test on the query string, which is what this used to be:
   * `search.includes("lat=")` also matches `?flat=1200`, so a URL that never
   * offered a location at all got a red banner apologising for one. The
   * parser already distinguishes "nothing was supplied" from "what was
   * supplied is broken", so use that instead of guessing from the raw text.
   */
  const linkWasBad = !fromLink.ok && fromLink.reason !== "no location in the link";
  /**
   * The four figures worth seeing before any tab is opened.
   *
   * Read straight off the same data the panels render, so a chip can never
   * disagree with the section behind it.
   */
  const chips: Chip[] = [
    {
      label: "Competitors",
      value: competitors.data
        ? competitors.data.truncated
          ? "20+"
          : String(competitors.data.summary.total)
        : "not yet",
      note: `within ${radiusMetres}m`,
      tone: "navy",
    },
    {
      // Not "People within 500m": that label clipped to "PEOPLE WITHIN..." in
      // a quarter-width tile, and the radius reads fine in the note.
      label: "Residents",
      value: demographics.data?.catchment
        ? demographics.data.catchment.population.toLocaleString("en-MY")
        : "no data",
      note: demographics.data?.catchment
        ? `within ${radiusMetres}m`
        : "no grid coverage",
      tone: "navy",
    },
    {
      label: "Monthly rent",
      value: rent ? `RM ${Math.round(rent.monthlyRent).toLocaleString("en-MY")}` : "no benchmark",
      note: rent ? (rent.kind === "direct" ? "your figure" : "inferred benchmark") : "no benchmark",
      tone: rent ? (rent.kind === "direct" ? "green" : "amber") : undefined,
    },
    {
      label: "Break-even",
      value: breakEvenPerDay === null ? "not available" : `${breakEvenPerDay}/day`,
      note: "to cover fixed costs",
      tone: rentLight,
    },
  ];
  const tabs: SectionTab[] = [
    { id: "overview", label: "Overview" },
    {
      id: "competition",
      label: "Competition",
      ...(competitors.data
        ? {
            badge: competitors.data.truncated
              ? "20+"
              : String(competitors.data.summary.total),
          }
        : {}),
      ...(competitors.isError ? { state: "warn" as const } : {}),
    },
    {
      id: "people",
      label: "People",
      ...(demographics.data?.catchment
        ? { badge: demographics.data.catchment.population.toLocaleString("en-MY") }
        : {}),
      ...(demographics.isError ? { state: "warn" as const } : {}),
    },
    {
      id: "demand",
      label: "Demand",
      /**
       * Residents in the VISIBLE map, which is what the panel leads with —
       * and deliberately a different figure from People's 500m catchment.
       * Zoomed out it answers "how big is this city"; zoomed in, "how busy is
       * this street". Both are honest because both name their own area.
       */
      /**
       * No badge until the grid is loaded, and NO "missing data" state either.
       * The dot means a section could not get its data; here it simply has not
       * been asked for yet, and saying "no data for this spot" over a grid that
       * covers all of Malaysia would be plainly false.
       */
      ...(demandActive && inView.length > 0
        ? { badge: formatNumber(inView.reduce((sum, c) => sum + c.population, 0)) }
        : {}),
      ...(grid.isError ? { state: "warn" as const } : {}),
    },
    {
      id: "rent",
      label: "Rent",
      ...(rent ? { badge: `RM${Math.round(rent.monthlyRent / 1000)}k` } : { state: "none" as const }),
    },
  ];
  const shell = (mapPane: ReactNode, searchNode: ReactNode) => (
    <>
      <Toolbar
        category={category}
        onCategory={setCategory}
        radiusMetres={radiusMetres}
        onRadius={setRadiusMetres}
        search={searchNode}
      />
      <div className="cockpit">
        <main className="cockpit-info">
          {/* The hero the old page never had: the score, the shape and the
              verdict in one block, before anything else. */}
          {/**
            * The hero states the answer once.
            *
            * It used to say the same thing four ways: this ring, a radar of
            * the same five dimensions, bars of the same five below, and a
            * table of the same five under those. The radar went first because
            * it was the worst of them — with two dimensions unscored it drew a
            * thin sliver that reads as a terrible location rather than as
            * missing data. It survives on /compare, where overlaying two
            * shapes is the entire point.
            *
            * The heading is the PLACE, not its coordinates. Those are still
            * on the page, once, small, under the map where the shareable link
            * lives.
            */}
          <header className="hero" ref={heroRef}>
            {/**
              * Concentric rings, not the events page's square grid.
              *
              * That grid reads as a catalogue of many things, which is what
              * that page is. This page is a report on ONE place, and rings are
              * the language it already speaks: the search radius drawn on the
              * map beside it, and the score ring itself. The texture is the
              * subject rather than decoration borrowed from elsewhere.
              */}
            <span className="hero-rings" aria-hidden="true" />
            <p className="hero-eyebrow">Location report</p>
            <h2 className="hero-name">{location.label}</h2>
            {score ? (
              <div className="hero-answer">
                <ScoreRing score={score.overall} />
                <div className="hero-said">
                  <Verdict score={score} />
                  <p className="hero-caveat">
                    A comparison aid, not a forecast. Nothing in it has been checked against real
                    business outcomes.
                  </p>
                </div>
              </div>
            ) : (
              <p className="hero-verdict">
                {competitors.isError
                  ? "The competitor lookup failed, so there is no score for this spot. Everything below still works."
                  : "Scoring this spot…"}
              </p>
            )}
            <StatChips chips={chips} />
          </header>
          {/* IN THE REPORT, NOT IN A TAB. The interpretation of everything
              below is the first thing read, and it is never a click away. */}
          <SpotentialAI
            category={category}
            radiusMetres={radiusMetres}
            location={reportLocation}
            gaps={gaps.data}
            ready={Boolean(competitors.data)}
            derived={deriveSummary({
              score,
              competitors: competitors.data,
              gaps: gaps.data,
              radiusMetres,
            })}
            // The model proposes a view change; the page's own cached fetch
            // executes it, so it never spends Places money itself.
            onAdjust={({ category: next, radiusMetres: nextRadius }) => {
              if (next) setCategory(next);
              if (nextRadius) setRadiusMetres(nextRadius);
            }}
          />
          <SectionTabs tabs={tabs} active={section} onSelect={selectSection} />
          <div className="section-body" id={`section-${section}`} role="tabpanel">
            {section === "overview" && (
              /* No card header: the tab above it already says Overview, and a
                 panel titled "Location profile" under a tab called "Overview"
                 is the page naming itself twice. */
              <section className="card">
                <div className="body">
                  {score ? (
                    <SuccessScore score={score} bare />
                  ) : (
                    <div className="small muted">
                      The profile appears once the competitor lookup lands.
                    </div>
                  )}
                </div>
              </section>
            )}
            {section === "competition" && (
              <CompetitorSection
                query={competitors}
                hoveredId={hoveredCompetitor}
                onHover={setHoveredCompetitor}
              />
            )}
            {section === "people" && <DemographicsSection query={demographics} />}
            {section === "demand" && (
              <DemandSection
                cells={inView}
                pinCell={pinCell}
                layers={amenityLayers}
                amenitiesAvailable={amenities.data?.available ?? false}
                amenitiesInRange={canFetchAmenities(amenityBox)}
                amenityReason={amenities.data?.reason ?? null}
                rentCount={rentDistricts.length}
                areas={rankedAreas}
                active={activeLayers}
                onToggle={setActiveLayers}
                showRent={showRentPins}
                onShowRent={setShowRentPins}
                surfaceOn={demand}
                onSurface={shadeByHand}
                onFlyTo={setFlyTo}
                loading={grid.isLoading}
                failed={grid.isError}
                attribution={grid.data?.attribution ?? null}
                vintage={grid.data?.vintage ?? null}
                amenityAttribution={amenities.data?.attribution ?? null}
              />
            )}
            {section === "rent" && (
              <RentPanel
                rent={rent}
                category={category}
                point={settled}
                unitSqft={unitSqft}
                overrideRent={overrideRent}
                onOverrideRent={setOverrideRent}
                onUnitSqft={setUnitSqft}
                simulatorHref={simulatorHref}
                districtName={demographics.data?.demographics?.district ?? null}
                stateName={demographics.data?.demographics?.state ?? null}
                listings={listings.data?.listings ?? []}
                listingsLoading={listings.isFetching}
                /* A refusal and an empty result are different answers, and the
                   panel needs both to say which one it got. */
                listingsAvailable={listings.data?.available ?? !listings.isError}
              />
            )}
          </div>
        </main>
        <div className="cockpit-map no-print">{mapPane}</div>
      </div>
    </>
  );
  return (
    <>
      <Masthead subtitle="Location Analysis">
        {/* Carries the pin, category and radius through, so the comparison
            starts commensurable rather than mixing search settings. */}
        <button
          type="button"
          className="tiny cta"
          onClick={() => {
            // Appends to the comparison in progress rather than replacing it,
            // so a two-location comparison can actually be assembled. Carries
            // the quoted rent, if there is one — the benchmark resolves from
            // coordinates at the other end and needs no passing.
            const next = appendToComparison(location, category, radiusMetres, overrideRent);
            window.location.assign(comparisonHref(next));
          }}
        >
          Add to comparison
        </button>
        {/* Disabled until the competitor lookup lands: a report without it
            would be a page of dashes rather than an analysis. */}
        <ReportButton
          disabled={!competitors.data}
          body={() => ({
            kind: "location",
            category,
            radiusMetres,
            location: reportLocation(),
          })}
        />
      </Masthead>
      {linkWasBad && (
        <div className="notice danger no-print" style={{ margin: 0, borderRadius: 0 }}>
          <span>
            <strong>That link&rsquo;s location could not be read</strong> &mdash;{" "}
            {fromLink.reason}. Showing Kuala Lumpur instead. Search for an address above, or drag
            the pin, to analyse the spot you meant.
          </span>
        </div>
      )}
      {!isInMalaysia(location) && (
        <div className="notice warn no-print" style={{ margin: 0, borderRadius: 0 }}>
          This point is outside Malaysia. The category and rent presets were researched for
          Malaysian F&amp;B, so treat any figures with caution.
        </div>
      )}
      {MAPS_API_KEY ? (
        <APIProvider apiKey={MAPS_API_KEY} libraries={["geocoding", "streetView", "marker"]}>
          <MapAwareBody
            location={location}
            onPick={pickCoordinates}
            onSearch={setLocation}
            radiusMetres={radiusMetres}
            competitors={competitors.data}
            hoveredCompetitor={hoveredCompetitor}
            demand={demand}
            demandActive={demandActive}
            onDemandChange={shadeByHand}
            demandCells={grid.data?.cells}
            demandState={
              grid.data ? "ready" : grid.isError ? "failed" : "loading"
            }
            amenityLayers={amenityLayers}
            activeLayers={activeLayers}
            rentDistricts={rentDistricts}
            showRentPins={showRentPins}
            setFlyTo={setFlyTo}
            flyTo={flyTo}
            onBoundsChange={onBoundsChange}
            shell={shell}
          />
        </APIProvider>
      ) : (
        shell(
          <MapPane
            location={location}
            onPick={pickCoordinates}
            disabled={
              <MapUnavailableBody reason="No Google Maps key was set when this build was made (VITE_GOOGLE_MAPS_API_KEY)." />
            }
          />,
          <NoGeocoderCard />,
        )
      )}
    </>
  );
}
/**
 * Moves the CENTRE only — never the zoom.
 *
 * The heatmap page's own FlyTo sets a zoom level too, which here would make it
 * a second owner of the camera alongside `RadiusCircle`'s framing effect, and
 * the two would race whenever both fired. Panning is safe because it composes:
 * whatever the zoom is, the centre simply moves.
 *
 * And it never touches the PIN. Flying to a dense area is exploration; the
 * analysis subject changes only by clicking or dragging the marker.
 */
function PanTo({ target }: { target: { lat: number; lng: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !target) return;
    map.panTo({ lat: target.lat, lng: target.lng });
  }, [map, target]);
  return null;
}
function MapAwareBody({
  location,
  onPick,
  onSearch,
  radiusMetres,
  competitors,
  hoveredCompetitor,
  demand,
  demandActive,
  onDemandChange,
  demandCells,
  demandState,
  amenityLayers,
  activeLayers,
  rentDistricts,
  showRentPins,
  setFlyTo,
  flyTo,
  onBoundsChange,
  shell,
}: {
  location: PickedLocation;
  onPick: (next: { lat: number; lng: number }) => void;
  onSearch: (next: PickedLocation) => void;
  radiusMetres: number;
  competitors: CompetitorsResponse | undefined;
  /** The competitor row under the cursor, so its pin can stand out. */
  hoveredCompetitor: string | null;
  /**
   * The population surface. Owned by the parent because it widens the fit
   * radius and gates the grid fetch, neither of which belongs to the map card.
   */
  demand: boolean;
  /** Drives the FRAMING: the tab or the toggle both widen the view. */
  demandActive: boolean;
  onDemandChange: (next: boolean) => void;
  /** Undefined until the grid arrives; the layer simply does not render yet. */
  demandCells: HeatmapCell[] | undefined;
  /** Loading and failed look identical on the map; the note must not. */
  demandState: "loading" | "ready" | "failed";
  amenityLayers: AmenityLayer[];
  activeLayers: Set<string>;
  rentDistricts: DistrictPreset[];
  showRentPins: boolean;
  setFlyTo: (point: { lat: number; lng: number }) => void;
  flyTo: { lat: number; lng: number } | null;
  onBoundsChange: (bounds: Bounds) => void;
  shell: (mapPane: ReactNode, searchNode: ReactNode) => ReactNode;
}) {
  const status = useApiLoadingStatus();
  const authFailed = useMapsAuthFailure();
  // Maps is the one part of this app that depends on a third-party script at
  // runtime. Its failure is confined to the map card — everything served by
  // our own backend keeps working.
  if (authFailed) {
    return shell(
      <MapPane
        location={location}
        onPick={onPick}
        disabled={
          <MapUnavailableBody reason="Google Maps refused this site's API key. The referrer restrictions on the key probably do not cover this origin." />
        }
      />,
      <NoGeocoderCard />,
    );
  }
  if (status === APILoadingStatus.FAILED) {
    return shell(
      <MapPane
        location={location}
        onPick={onPick}
        disabled={
          <MapUnavailableBody reason="Google Maps could not be loaded. An extension or network policy may be blocking it." />
        }
      />,
      <NoGeocoderCard />,
    );
  }
  return shell(
    <div data-testid="map-card">
      <MapPane
        location={location}
        onPick={onPick}
        /**
         * ONE owner for the zoom.
         *
         * CompetitorOverlay already frames the map imperatively and re-fits
         * only when this value changes. Widening the view here rather than
         * calling setZoom from the toggle means the surface and the radius
         * control cannot fight over the camera — there is only ever one number
         * asking for a framing.
         */
        /**
         * Widened by demandACTIVE, not by the shading toggle.
         *
         * Opening the Demand tab is asking an area question, and at the search
         * framing exactly one 693m cell is in view — so "residents", "median
         * cell" and "densest cell" all print the same number and the panel
         * reads as broken. The tab gets the area view and shades it; the
         * toggle beside it decides whether the shading stays.
         */
        fitRadiusMetres={framingRadius(radiusMetres, demandActive)}
        demand={demand}
        onDemandChange={onDemandChange}
        demandState={demandState}
        onBoundsChange={onBoundsChange}
        overlays={
          <>
            {/* First, so it paints under the rings and pins. HeatLayer draws
                into the overlay pane, below the markers, so the pins stay
                clickable through it. */}
            {/* The traffic ramp, as on the page this replaces. Green means the
                OPPOSITE here of what it means in the score bars, which is why
                the Demand tab carries the notice that says so. */}
            {demand && demandCells ? <HeatLayer cells={demandCells} ramp="traffic" /> : null}
            <AmenityPins layers={amenityLayers} active={activeLayers} />
            <RentPins
              districts={rentDistricts}
              show={showRentPins}
              onSelect={(district) => setFlyTo(district.centre)}
            />
            <PanTo target={flyTo} />
            <RadiusCircle
              centre={location}
              radiusMetres={radiusMetres}
              completeToMetres={competitors?.completeToMetres ?? null}
              /**
               * THE camera. MapPane's `fitRadiusMetres` above only seeds
               * `defaultBounds`, which is applied once at mount — this is the
               * live one, and changing the wrong one moves nothing.
               *
               * The ring still draws at the search radius; only the framing
               * widens, and it widens for the tab as well as the toggle.
               */
              fitRadiusMetres={framingRadius(radiusMetres, demandActive)}
            />
            {competitors && (
              <CompetitorPins
                competitors={competitors.competitors}
                completeToMetres={competitors.completeToMetres}
                hoveredId={hoveredCompetitor}
              />
            )}
          </>
        }
        {...(competitors
          ? {
              legend: (
                <MapLegend
                  radiusMetres={radiusMetres}
                  completeToMetres={competitors.completeToMetres}
                  count={competitors.summary.total}
                  truncated={competitors.truncated}
                />
              ),
            }
          : {})}
        {...(status === APILoadingStatus.LOADED
          ? {}
          : {
              disabled: (
                <div
                  style={{
                    height: "100%",
                    display: "grid",
                    placeItems: "center",
                    background: "var(--surface)",
                    color: "var(--ink-2)",
                    fontSize: 13,
                  }}
                >
                  Loading map…
                </div>
              ),
            })}
      />
    </div>,
    <AddressSearch onPick={onSearch} compact />,
  );
}
function CompetitorSection({
  query,
  hoveredId = null,
  onHover,
}: {
  query: UseQueryResult<CompetitorsResponse, unknown>;
  hoveredId?: string | null;
  onHover?: (id: string | null) => void;
}) {
  if (query.isPending) {
    return (
      <section className="card">
        <header>
          <h2>Competitors nearby</h2>
        </header>
        <div className="body small muted">Looking up competitors…</div>
      </section>
    );
  }
  if (query.isError) {
    return (
      <section className="card">
        <header>
          <h2>Competitors nearby</h2>
        </header>
        <div className="body">
          <div className="notice warn">
            Could not load competitor data. The map and everything else still works.
          </div>
        </div>
      </section>
    );
  }
  if (!query.data.placesConfigured) {
    return (
      <section className="card">
        <header>
          <h2>Competitors nearby</h2>
        </header>
        <div className="body">
          <div className="notice info">
            Competitor lookup is not configured on this deployment.
          </div>
        </div>
      </section>
    );
  }
  return (
    <>
      <CompetitorList data={query.data} hoveredId={hoveredId} {...(onHover ? { onHover } : {})} />
      <CompetitionDensity data={query.data} />
      <CompetitorScatter data={query.data} />
    </>
  );
}
function DemographicsSection({ query }: { query: UseQueryResult<DemographicsResponse, unknown> }) {
  if (query.isPending) {
    return (
      <section className="card">
        <header>
          <h2>Area demographics</h2>
        </header>
        <div className="body small muted">Looking up the district…</div>
      </section>
    );
  }
  if (query.isError) {
    return (
      <section className="card">
        <header>
          <h2>Area demographics</h2>
        </header>
        <div className="body">
          <div className="notice warn">Could not load demographic data for this point.</div>
        </div>
      </section>
    );
  }
  return <DemographicsPanel data={query.data} />;
}
/**
 * Fills the map frame when Maps cannot render.
 *
 * Kept inside the pane rather than replacing it, so the layout does not
 * reflow into something unrecognisable the moment an ad blocker fires — the
 * frame, the coordinates and the whole left column stay exactly where they
 * were.
 */
function MapUnavailableBody({ reason }: { reason: string }) {
  return (
    <div
      data-testid="maps-unavailable"
      style={{
        height: "100%",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "var(--surface)",
      }}
    >
      <div className="stack" style={{ maxWidth: 380, textAlign: "center" }}>
        <div className="notice warn">
          <span>{reason}</span>
        </div>
        <span className="small muted">
          Competitor data comes from Spotential&rsquo;s own service, not from Google directly, so
          the analysis beside this is unaffected.
        </span>
      </div>
    </div>
  );
}
/** Address lookup needs the Maps geocoder; coordinates in the URL do not. */
/** Inline, for the toolbar — address search needs the Maps geocoder. */
function NoGeocoderCard() {
  return (
    <span className="small muted">
      Address search needs Google Maps. You can still open a spot by coordinates,{" "}
      <code>?lat=3.1478&amp;lng=101.6953</code>, or drag the pin.
    </span>
  );
}
