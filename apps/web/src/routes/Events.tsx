import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { CATEGORY_PRESETS, entryPrice, formatNumber, type BusinessCategory, type EventScore, type VendorProfile } from "@spotential/sim-engine";
import { Masthead } from "../components/Masthead.js";
import { EventCard } from "../components/events/EventCard.js";
import { FilterBar, type FilterState } from "../components/events/FilterBar.js";
import { HeroTile } from "../components/events/HeroTile.js";
import { getEvents, rankEventsFor } from "../lib/api.js";
import { useDebounced } from "../lib/useDebounced.js";

/**
 * Events — discovery for MSMEs.
 *
 * Not a directory. A vendor with fifteen bazaars in front of them does not need
 * another list; they need to know which three are worth their money — so the
 * page is built around ranking, and the controls exist to narrow what gets
 * ranked rather than to be the feature. They sit along the TOP now: they are
 * set once and left alone, while the results are what you live in, so the grid
 * gets the full width.
 *
 * IT COSTS NOTHING TO SERVE. The catalogue is a file in the Cloud Run image and
 * the score is arithmetic in the shared engine — no Places, no Gemini, no map.
 * That is what makes this affordable inside the budget, and why the route is
 * not App Check'd: gating it would only break discovery for anyone whose
 * reCAPTCHA is blocked, for no saving at all.
 */

/** Must match `background-size` on `.hero-grid-bg`, or the loop jumps. */
const HERO_GRID_CELL = 34;

const DEFAULT_VENDOR: VendorProfile = {
  category: "cafe_coffee_shop",
  base: null,
  boothBudgetRm: null,
  maxTravelKm: null,
};

export default function Events() {
  const [params, setParams] = useSearchParams();
  const gridRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);

  /**
   * ONE map from filter field to URL parameter, read and written through the
   * same table.
   *
   * The reader took `q` and the writer set `query`, so every keystroke wrote a
   * parameter nothing read back — the input was controlled by a value that
   * never changed and typing appeared to do nothing at all. Naming the pair in
   * one place is what stops that returning.
   */
  const PARAM: Record<keyof FilterState, string> = {
    query: "q",
    state: "state",
    budget: "budget",
    sort: "sort",
  };

  const filters: FilterState = {
    query: params.get(PARAM.query) ?? "",
    state: params.get(PARAM.state) ?? "",
    budget: params.get(PARAM.budget) ?? "",
    sort: params.get(PARAM.sort) ?? "match",
  };

  /**
   * Sorting by best match IS ranking — one request, one control.
   *
   * There used to be a separate toggle beside a sort order, which left the
   * page with two ways to ask the same thing and no answer for what should
   * happen when they disagreed.
   */
  const ranking = filters.sort === "match";

  const [vendor, setVendor] = useState<VendorProfile>(() => ({
    ...DEFAULT_VENDOR,
    category: (params.get("cat") as BusinessCategory) || DEFAULT_VENDOR.category,
  }));

  /** One budget field, used for filtering and for scoring alike. */
  const scoredVendor: VendorProfile = useMemo(() => {
    const raw = params.get("budget") ?? "";
    const parsed = Number(raw);
    return {
      ...vendor,
      boothBudgetRm:
        raw === "" || !Number.isFinite(parsed) || parsed < 0 ? null : parsed,
    };
  }, [vendor, params]);

  /**
   * BUILT FROM THE CURRENT URL, NOT THE CAPTURED ONE.
   *
   * This read `new URLSearchParams(params)`, and `params` is the value from
   * the render that created the handler. Two keystrokes landing before React
   * re-rendered therefore both built from the same stale base, and the second
   * overwrote the first: typing "terang" quickly produced "tg".
   *
   * It only showed on a loaded machine, because that is when the round-trip
   * through the URL is slow enough to lose the race — so it presented as a
   * flaky test rather than as the real dropped-keystrokes bug it is. The
   * functional form is handed the live params every time.
   */
  const setParam = (key: string, value: string | boolean) => {
    const v = typeof value === "boolean" ? (value ? "1" : "") : value;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (v) next.set(key, v);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  };

  const onFilter = (key: keyof FilterState, value: string) => setParam(PARAM[key], value);

  // The category rides in the URL so a scored view is shareable.
  useEffect(() => {
    // Same stale-base hazard as `setParam` above, so the same fix.
    setParams(
      (current) => {
        if (current.get("cat") === vendor.category) return current;
        const next = new URLSearchParams(current);
        next.set("cat", vendor.category);
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor.category]);

  const query = useMemo(() => {
    const f: Record<string, string> = {};
    if (filters.state) f["state"] = filters.state;
    if (filters.query) f["q"] = filters.query;
    /**
     * The budget is BOTH a filter and a scoring input, from one field.
     *
     * It caps the list at what the vendor can spend, and it is the same figure
     * the affordability axis is judged against — so entering it once does both
     * rather than asking twice. Explicit empty check, because `maxPrice=0` is
     * a real request for free stalls and must not be swallowed as "no filter".
     */
    if (filters.budget !== "") f["maxPrice"] = filters.budget;
    return f;
  }, [filters.state, filters.query, filters.budget]);

  /**
   * The URL and the inputs update on every keystroke; the FETCH waits.
   *
   * Typing "1000" into the budget passes through 1, 10 and 100 on the way, and
   * each of those genuinely matches no event — so an unthrottled fetch flashed
   * "no events match" three times before settling and read as broken. Only the
   * request is delayed, so the field itself stays instant.
   */
  const settledQuery = useDebounced(query, 300);

  /**
   * The unfiltered catalogue, purely to know the price floor.
   *
   * Free to serve and cached for an hour, so this costs a single extra request
   * per session rather than one per keystroke — and it is the only way to say
   * "the cheapest booth is RM380" at the moment the filtered list is empty.
   */
  const allPrices = useQuery({
    queryKey: ["events-all-prices"],
    queryFn: async ({ signal }) => {
      const all = await getEvents({}, signal);
      return all.events
        .map((e) => entryPrice(e))
        .filter((p): p is number => p !== null);
    },
    staleTime: 60 * 60 * 1000,
  });

  const events = useQuery({
    queryKey: ["events", settledQuery],
    queryFn: ({ signal }) => getEvents(settledQuery, signal),
    staleTime: 10 * 60 * 1000,
    // Keeps the previous list on screen while a narrower one loads, instead of
    // emptying the page between keystrokes.
    placeholderData: (prev) => prev,
  });

  /**
   * Scores come from the server because it holds the population grid, which the
   * browser does not — so the venue catchment axis is only available this way.
   * Still free: no external call on either side.
   */
  const ranked = useQuery({
    queryKey: ["events-rank", scoredVendor, settledQuery],
    queryFn: ({ signal }) => rankEventsFor(scoredVendor, settledQuery, signal),
    enabled: ranking,
    staleTime: 10 * 60 * 1000,
  });

  const scores = useMemo(() => {
    const map = new Map<string, EventScore>();
    for (const row of ranked.data?.ranked ?? []) map.set(row.eventId, row.score);
    return map;
  }, [ranked.data]);

  /**
   * States present in the CURRENT result, with counts.
   *
   * Derived from what came back rather than from the full list of Malaysian
   * states, so the filter can never offer an option that leads nowhere.
   */
  const stateCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of events.data?.events ?? []) {
      counts[e.state] = (counts[e.state] ?? 0) + 1;
    }
    return counts;
  }, [events.data]);

  /**
   * The cheapest booth anywhere, when a budget is what emptied the list.
   *
   * Null unless the budget is genuinely the binding constraint, so the empty
   * state never blames the wrong filter. Read from the UNFILTERED catalogue —
   * the filtered response is empty, which is exactly the problem.
   */
  const budgetTooLow = useMemo(() => {
    if (filters.budget === "" || !allPrices.data) return null;
    const budget = Number(filters.budget);
    if (!Number.isFinite(budget)) return null;
    const floor = Math.min(...allPrices.data);
    return Number.isFinite(floor) && floor > budget ? floor : null;
  }, [filters.budget, allPrices.data]);

  /** Cheapest way into any listed event, for the hero strip. */
  const cheapest = useMemo(() => {
    const prices = (events.data?.events ?? [])
      .map((e) => entryPrice(e))
      .filter((p): p is number => p !== null);
    return prices.length > 0 ? Math.min(...prices) : null;
  }, [events.data]);

  const list = useMemo(() => {
    const all = events.data?.events ?? [];

    if (filters.sort === "soon") {
      return [...all].sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate));
    }
    if (filters.sort === "cheap") {
      /**
       * Unpriced events sort LAST rather than first.
       *
       * "Price on request" is not free — treating a missing number as zero
       * would put every event that publishes nothing at the top of a cheapest
       * list, which is the same perverse incentive the affordability axis
       * already refuses to create.
       */
      return [...all].sort((a, b) => {
        const pa = entryPrice(a);
        const pb = entryPrice(b);
        if (pa === null && pb === null) return 0;
        if (pa === null) return 1;
        if (pb === null) return -1;
        return pa - pb;
      });
    }

    if (scores.size === 0) return all;
    return [...all].sort(
      (a, b) => (scores.get(b.id)?.overall ?? 0) - (scores.get(a.id)?.overall ?? 0),
    );
  }, [events.data, filters.sort, scores]);

  /**
   * Cards resolve in sequence as the list changes, rather than snapping in.
   *
   * useGSAP with revertOnUpdate, so re-running on a filter change puts the rows
   * back to their real styles first. A raw effect that only killed the tween
   * would leave whatever it had reached — under StrictMode's double mount that
   * means rows stranded at opacity 0.
   */
  /** The hero resolves once, on arrival. */
  useGSAP(
    () => {
      /**
       * Hands `transform` back to CSS, and marks the hero ready for hover.
       *
       * A `from` tween leaves its end values inline, and an inline transform
       * outranks any stylesheet `:hover` — so without the clear, the tiles
       * would simply never lift. Both paths below call this, including the
       * reduced-motion one, or hover would be dead for those readers.
       */
      const ready = () => {
        gsap.set(".hb-tile", { clearProps: "transform,opacity" });
        heroRef.current?.classList.add("is-ready");
      };

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        ready();
        return;
      }
      gsap
        .timeline({ onComplete: ready })
        .from(".hero-eyebrow", { y: 10, opacity: 0, duration: 0.4, ease: "power2.out" })
        .from(".events-hero h1", { y: 16, opacity: 0, duration: 0.55, ease: "power3.out" }, "-=0.25")
        .from(".events-hero p", { y: 12, opacity: 0, duration: 0.45, ease: "power2.out" }, "-=0.35")
        .from(
          ".hb-tile",
          { y: 14, opacity: 0, scale: 0.97, duration: 0.45, stagger: 0.07, ease: "power2.out" },
          "-=0.3",
        )
        .from(".hero-glow", { opacity: 0, scale: 0.9, duration: 0.9, ease: "power2.out" }, 0);

      /**
       * The grid drifts exactly ONE cell and repeats, so the loop is seamless.
       *
       * Any other distance leaves a visible jump at the wrap. It is a
       * transform rather than a background-position so it stays on the
       * compositor, and the element is oversized past the hero's bounds so the
       * drift never exposes an edge.
       */
      gsap.to(".hero-grid-bg", {
        x: HERO_GRID_CELL,
        y: HERO_GRID_CELL,
        duration: 18,
        ease: "none",
        repeat: -1,
      });
    },
    { scope: heroRef },
  );

  useGSAP(
    () => {
      if (list.length === 0) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.from(".evc", {
        y: 22,
        opacity: 0,
        scale: 0.97,
        duration: 0.5,
        // Small per-item delay: beyond about 0.06s the last card in a grid
        // feels like it is lagging behind the scroll.
        stagger: { each: 0.05, from: "start" },
        ease: "power2.out",
      });
    },
    { dependencies: [list], scope: gridRef, revertOnUpdate: true },
  );

  return (
    <>
      <Masthead subtitle="Events" />

      <div className="events-page">
        <header className="events-hero" ref={heroRef}>
          {/* A drifting map grid, which is what this product actually reads:
              cells on a map. Decorative only — nothing renders on top of it. */}
          <div className="hero-grid-bg" aria-hidden="true" />
          <div className="hero-glow" aria-hidden="true" />

          <div className="hero-copy">
            <span className="hero-eyebrow">
              <span className="hero-dot" aria-hidden="true" />
              Event matching for Malaysian MSMEs
            </span>
            <h1>
              Find the events worth <em>your</em> booth.
            </h1>
            <p>
              Spotential scores every listing against what you sell, what you can spend, how far
              you would travel and how many other stalls will chase the same shoppers, then puts
              the best matches first. A comparison aid, not a prediction.
            </p>
          </div>

          {/* Rendered whether or not the catalogue has arrived, so the hero
              does not change shape underneath the reader on first paint. */}
          <dl className="hero-bento">
            <HeroTile
              label="Events"
              value={events.data?.total}
              note="listed right now"
            />
            <HeroTile
              label="States"
              value={events.data ? Object.keys(stateCounts).length : undefined}
              note="with something on"
            />
            <HeroTile
              label="Booths from"
              value={events.data ? cheapest : undefined}
              prefix="RM"
              absent="on request"
              note="the cheapest way into any listed event"
              wide
              accent
            />
          </dl>
        </header>

        <FilterBar
          vendor={vendor}
          onVendor={setVendor}
          filters={filters}
          onFilter={onFilter}
          stateCounts={stateCounts}
          total={events.data?.total ?? 0}
        />

        {events.isPending && <p className="muted ev-status">Loading events…</p>}

        {events.isError && (
          <div className="notice danger ev-status">
            <span>Could not load events. Every other page is unaffected.</span>
          </div>
        )}

        {events.data && list.length === 0 && (
          <div className="empty-state">
            <h3>No events match those filters</h3>
            {/* Name the binding constraint and the number that would clear it.
                "Try raising the booth price" is advice; "the cheapest booth is
                RM380" is the fact that lets someone act without guessing. */}
            <p className="muted">
              {budgetTooLow !== null ? (
                <>
                  The cheapest booth in the {formatNumber(events.data.total)} listed events is{" "}
                  <strong>RM{formatNumber(budgetTooLow)}</strong>, above your budget of RM
                  {formatNumber(Number(filters.budget))}.
                </>
              ) : (
                <>
                  {formatNumber(events.data.total)} events are listed. Try widening the state or
                  clearing the search.
                </>
              )}
            </p>
            <button onClick={() => setParams(new URLSearchParams())}>Clear all filters</button>
          </div>
        )}

        {list.length > 0 && (
          <>
            <div className="ev-listhead">
              <div>
                <h2>
                  {ranking
                    ? "Best matches for your business"
                    : filters.sort === "cheap"
                      ? "Cheapest booths first"
                      : "Starting soonest"}
                </h2>
                {ranking && (
                  <p className="ev-listsub">
                    Scored for {CATEGORY_PRESETS[vendor.category].label.toLowerCase()}
                    {scoredVendor.boothBudgetRm !== null &&
                      ` on a RM${formatNumber(scoredVendor.boothBudgetRm)} budget`}
                    .
                  </p>
                )}
              </div>
              <span className="ev-count">
                {formatNumber(list.length)}
                {ranking && ranked.isPending && <em> · scoring…</em>}
              </span>
            </div>

            <div className="evc-grid" ref={gridRef}>
              {list.map((event) => {
                const score = scores.get(event.id);
                return (
                  <EventCard
                    key={event.id}
                    event={event}
                    {...(ranking && score ? { score } : {})}
                  />
                );
              })}
            </div>
          </>
        )}

        <p className="ev-foot tiny muted">
          Dates, venues and opening hours come from each event's own poster. Booth pricing and
          slot counts are curated estimates, so these are not live bookings and applications open
          when organizers publish their events here.
        </p>
      </div>
    </>
  );
}
