import { useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  CATEGORY_PRESETS,
  EVENT_TYPE_LABELS,
  formatNumber,
  listCategories,
  matchInsight,
  scoreEvent,
  type BusinessCategory,
  type VendorProfile,
} from "@spotential/sim-engine";
import { Masthead } from "../components/Masthead.js";
import { ScoreRing, bandFor } from "../components/analysis/ScoreRing.js";
import { RoiPanel } from "../components/events/RoiPanel.js";
import { ApplyPanel } from "../components/events/ApplyPanel.js";
import { EventDoDont, EventRules } from "../components/events/EventGuidance.js";
import { closingHour, openingHour } from "../components/events/guidance.js";
import { useFillBars, useReveal } from "../components/events/useReveal.js";
import { formatRun } from "../components/events/EventCard.js";
import { coverFor, posterFor, posterSizeFor } from "../components/events/posters.js";
import { useCountUp } from "../components/sim/useCountUp.js";
import { getEvent } from "../lib/api.js";

/**
 * One event, as a page for the event rather than a dashboard about it.
 *
 * THE PREVIOUS VERSION WAS SEVEN GREY CARDS IN A TWO-COLUMN COCKPIT and the
 * owner's verdict on it was messy, boring, not attractive. They were right
 * about the cause: the poster, the single most appealing thing on the page and
 * the only part an organizer actually designed, was squeezed into a 208px
 * column beside the title, and the score was hidden away in a right rail.
 * Everything carried the same weight, so nothing did.
 *
 * Three acts now, which is the shape the owner asked for:
 *
 *   1. THE POSTER, BIG. A navy aurora stage with the artwork at up to 420px,
 *      shown whole. Cropping a poster to fit a strip beheads its title, which
 *      is the part a vendor scans for.
 *   2. THE SCORE, HORIZONTAL. The ring on a white tile and the six dimensions
 *      laid out across the band rather than stacked in a rail.
 *   3. THE INFORMATION, at length. What it is, who it wants, what a booth
 *      costs, the organizer's rules, our own guidance, whether it pays.
 *
 * THE SCORE SITS ON WHITE INSIDE THE NAVY, and that is measured rather than
 * preferred: `bandFor` paints the ring green, gold or red, and on navy those
 * verdict colours measure 3.6:1 and 2.5:1. The one part of the ring that has
 * to be unmistakable is the part that fails. Same finding the navbar made
 * about the logo and the thinking mark made about its disc.
 *
 * What did NOT change is the honesty. The turnout figure names the organizer
 * everywhere it appears, the ROI panel still leads with a capture rate rather
 * than a projected profit, and a curated listing still says it cannot be
 * applied to before showing anybody a form.
 *
 * The score is computed IN THE BROWSER from the same engine the server uses,
 * seeded with the venue catchment the detail route supplies. Client and server
 * agreeing is a tautology rather than a test, because there is one
 * implementation.
 */

const CATEGORY_OPTIONS = listCategories();

export default function EventDetail() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();

  const [category, setCategory] = useState<BusinessCategory>(
    (params.get("cat") as BusinessCategory) || "cafe_coffee_shop",
  );
  const [packageId, setPackageId] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["event", slug],
    queryFn: ({ signal }) => getEvent(slug, signal),
    staleTime: 10 * 60 * 1000,
  });

  const vendor: VendorProfile = useMemo(
    () => ({
      category,
      base: null,
      boothBudgetRm: params.get("budget") ? Number(params.get("budget")) : null,
      maxTravelKm: null,
    }),
    [category, params],
  );

  const score = useMemo(() => {
    if (!detail.data) return null;
    return scoreEvent({
      event: detail.data.event,
      vendor,
      venueCatchment: detail.data.venueCatchment,
      catchmentRadiusMetres: detail.data.catchmentRadiusMetres,
    });
  }, [detail.data, vendor]);

  const stageRef = useRef<HTMLDivElement>(null);
  const metersRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);
  useReveal(stageRef, { selector: ".evx-rise", stagger: 0.07, y: 22 });
  useReveal(statsRef, { selector: ":scope > *", stagger: 0.05, y: 14 });
  useFillBars(metersRef, Boolean(score));

  if (detail.isPending) {
    return (
      <>
        <Masthead subtitle="Events" />
        <div className="evx">
          {/* Holds the stage's own height, so the page does not jolt when the
              poster lands. A skeleton is a promise, and this one is kept.

              ITS OWN CLASS, not `.evx-stage`. Sharing the class meant a
              locator for the stage matched the placeholder, and by the time
              anything measured it React had swapped in the real section and
              the handle was stale: `boundingBox()` came back null against an
              element that had just passed a visibility check. */}
          <div className="evx-skeleton" />
        </div>
      </>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <>
        <Masthead subtitle="Events" />
        <div className="evx">
          <div className="notice danger" style={{ margin: 24 }}>
            <span>
              That event could not be loaded. <Link to="/events">Back to all events</Link>.
            </span>
          </div>
        </div>
      </>
    );
  }

  const { event, days, entryPriceRm, venueCatchment, catchmentRadiusMetres } = detail.data;
  const poster = posterFor(event);
  const posterSize = posterSizeFor(event);
  const cover = coverFor(event);
  const selected = event.packages.find((p) => p.id === packageId) ?? event.packages[0] ?? null;
  const cheapest = event.packages.length
    ? Math.min(...event.packages.map((p) => p.priceRm))
    : entryPriceRm;

  // Derived, never generated. It sits directly on top of the ring beside it,
  // so a model-written sentence could contradict the number an inch away.
  const insight = score ? matchInsight(score) : null;
  const wanted = event.wantedCategories;
  const opens = openingHour(event.dailyHours);
  const closes = closingHour(event.dailyHours);
  const hoursPerDay = opens !== null && closes !== null && closes > opens ? closes - opens : null;

  return (
    <>
      <Masthead subtitle="Events" />

      <div className="evx">
        <nav className="crumb">
          <Link to="/events">&#8592; All events</Link>
        </nav>

        {/* ---------------- Act 1: the poster ---------------- */}
        <section className="evx-stage" ref={stageRef}>
          {/* Decoration only, and confined to this band. A drifting gradient
              behind the figures further down would fight the thing the page
              exists to show. */}
          <div className="evx-aurora" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>

          <div className="evx-stage-inner">
            <figure className={`evx-poster evx-rise${poster ? " has-art" : ""}`}>
              {poster ? (
                <img
                  src={poster}
                  alt={`${event.name} event poster`}
                  width={posterSize?.width ?? 420}
                  height={posterSize?.height ?? 560}
                  loading="eager"
                />
              ) : (
                /* No artwork exists for this listing, so the cover is built
                   rather than borrowed. Deliberately NOT a stock photograph: a
                   crowd shot would imply we know what this event looks like,
                   on a page whose whole argument is that its figures came from
                   somewhere checkable. At this size it carries the name, type
                   and dates so it reads as a designed cover rather than as a
                   picture that failed to load. */
                <span
                  className="evx-cover"
                  style={{ background: `linear-gradient(150deg, ${cover.from}, ${cover.to})` }}
                >
                  <em>{EVENT_TYPE_LABELS[event.eventType]}</em>
                  <b>{event.name}</b>
                  <i>{formatRun(event)}</i>
                  <u>{event.venueName}</u>
                </span>
              )}
            </figure>

            <div className="evx-ident">
              <div className="evx-pills evx-rise">
                <span className="evx-pill gold">{EVENT_TYPE_LABELS[event.eventType]}</span>
                {event.availableSlots > 0 ? (
                  <span className="evx-pill ghost">{event.availableSlots} booths left</span>
                ) : (
                  <span className="evx-pill full">Booths full</span>
                )}
                <span className="evx-pill ghost">{event.state}</span>
              </div>

              <h1 className="evx-title evx-rise">{event.name}</h1>

              <p className="evx-by evx-rise">
                Presented by <strong>{event.organizerName}</strong>
              </p>

              <p className="evx-summary evx-rise">{event.summary}</p>

              <dl className="evx-when evx-rise">
                <div>
                  <dt>Dates</dt>
                  <dd>
                    {formatRun(event)}
                    <span>
                      {" "}
                      &middot; {days} day{days === 1 ? "" : "s"}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Hours</dt>
                  <dd>{event.dailyHours}</dd>
                </div>
                <div>
                  <dt>Venue</dt>
                  <dd>
                    {event.venueName}
                    <span> {event.address}</span>
                  </dd>
                </div>
              </dl>

              <div className="evx-cta evx-rise">
                <a className="btn-primary" href="#apply">
                  How to get a booth
                </a>
                <a className="btn-onnavy" href="#cost">
                  What it would cost
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- Act 2: the score, horizontal ---------------- */}
        {score && insight && (
          <section className="evx-score" id="score">
            <div className="evx-score-ring">
              <ScoreRing score={score.overall} />
              <p className="evx-fit-for">
                Fit for a <strong>{CATEGORY_PRESETS[category]?.label ?? "vendor"}</strong>
              </p>
            </div>

            <div className="evx-score-body">
              <div className="evx-score-top">
                <p className="evx-insight">{insight.headline}</p>
                <label className="evx-scored-for" htmlFor="detail-category">
                  <span>Scored for</span>
                  <select
                    id="detail-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value as BusinessCategory)}
                  >
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/**
               * Six meters across, EVERY ROW THE SAME HEIGHT.
               *
               * Each one used to carry its own one-line explanation, and
               * because those lines were different lengths the bars and the
               * numbers never lined up: the band read as unfinished. The
               * explanations moved into the disclosure below, which is the
               * same treatment the Location page gives its score working, and
               * what is left is a control you can compare at a glance.
               *
               * `.dim-bars` stays because the guarantee it carries elsewhere
               * still holds: an unscored dimension draws no bar at all, since
               * a zero-length bar and a genuine zero look identical and mean
               * opposite things.
               */}
              <div className="dim-bars evx-meters" ref={metersRef}>
                {score.dimensions.map((d) => {
                  const measured = d.kind !== "unavailable";
                  return (
                    <div className="evx-meter" key={d.key}>
                      <span className="dim-bar-label">{d.label}</span>
                      <span className={`dim-bar-value ${measured ? "" : "muted"}`}>
                        {measured ? Math.round(d.score) : "not scored"}
                      </span>
                      <span className="dim-bar-track">
                        {measured && (
                          <i
                            className={`dim-bar-fill ${bandFor(Math.round(d.score)).cls}`}
                            style={{ width: `${Math.max(2, Math.min(100, d.score))}%` }}
                          />
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>

              <details className="evx-working">
                <summary>How this was scored</summary>
                <ul className="evx-working-list">
                  {score.dimensions.map((d) => (
                    <li key={d.key}>
                      <strong>{d.label}</strong>
                      {d.kind === "proxy" && <span className="evx-est">estimated</span>}
                      <span>{d.note}</span>
                    </li>
                  ))}
                </ul>
                <p className="evx-score-foot">
                  A comparison aid, not a forecast. Weights reflect how far each signal can be
                  trusted, and the organizer&apos;s own turnout estimate carries the least.
                </p>
              </details>
            </div>
          </section>
        )}

        {/* ---------------- Act 3: the information ---------------- */}

        <section className="evx-sec" id="glance">
          <header className="evx-sec-head">
            <span className="evx-kicker">At a glance</span>
            <h2>The numbers that decide it</h2>
          </header>

          <div className="evx-stats" ref={statsRef}>
            <Stat label="Days trading" value={days} />
            <Stat label="Hours a day" value={hoursPerDay} suffix="h" fallback={event.dailyHours} />
            <Stat
              label="Total trading hours"
              value={hoursPerDay === null ? null : hoursPerDay * days}
              suffix="h"
            />
            <Stat label="Booths still open" value={event.availableSlots} of={event.totalSlots} />
            <Stat label="Booths from" value={cheapest} prefix="RM" fallback="on request" />
            <Stat
              label={`Residents within ${catchmentRadiusMetres}m`}
              value={venueCatchment}
              fallback="not measured"
            />
          </div>
        </section>

        <section className="evx-sec" id="about">
          <header className="evx-sec-head">
            <span className="evx-kicker">The event</span>
            <h2>What this is, and who it wants</h2>
          </header>

          <div className="evx-prose">
            <p>
              <strong>{event.organizerName}</strong> is running {event.name} at {event.venueName},{" "}
              {event.address}. It runs {formatRun(event)}
              {days > 1 ? `, ${days} days in a row` : ""}, trading {event.dailyHours} each day.
            </p>
            <p>{event.summary}</p>
            <p>
              {event.totalSlots > 0 ? (
                <>
                  There are {formatNumber(event.totalSlots)} booths in total and{" "}
                  {formatNumber(event.availableSlots)} still open.{" "}
                </>
              ) : null}
              {wanted.length === 0
                ? "The organizer has not narrowed what they are recruiting, so any kind of stall can ask."
                : "The organizer is recruiting these kinds of stall:"}
            </p>
          </div>

          {wanted.length > 0 && (
            <ul className="evx-wanted">
              {wanted.map((c) => (
                <li key={c} className={c === category ? "is-you" : ""}>
                  {CATEGORY_PRESETS[c]?.label ?? c}
                  {c === category && <span className="evx-you">that is you</span>}
                </li>
              ))}
            </ul>
          )}

          <dl className="event-facts wide evx-facts">
            <div>
              <dt>Organizer</dt>
              <dd>{event.organizerName}</dd>
            </div>
            <div>
              <dt>Expected visitors</dt>
              <dd>
                {/* Never rendered as 0. Unstated and "we expect nobody" are
                    opposite claims, and this is the one figure on the page
                    written by the party selling the booth, so it names its
                    source everywhere it appears. */}
                {event.expectedVisitors === null ? (
                  <span className="muted">not stated</span>
                ) : (
                  <>
                    {formatNumber(event.expectedVisitors)}{" "}
                    <span className="muted">&middot; organizer&apos;s estimate, unaudited</span>
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt>Area population</dt>
              <dd>
                {venueCatchment === null ? (
                  <span className="muted">not measured here</span>
                ) : (
                  <>
                    {formatNumber(venueCatchment)}{" "}
                    <span className="muted">residents within {catchmentRadiusMetres}m</span>
                  </>
                )}
              </dd>
            </div>
          </dl>
        </section>

        <section className="evx-sec" id="booths">
          <header className="evx-sec-head">
            <span className="evx-kicker">The lot</span>
            <h2>Booths and what they cost</h2>
            <p className="evx-lede">
              Prices are for the whole run, not per day. Picking one here changes the cost working
              further down.
            </p>
          </header>

          {event.packages.length === 0 ? (
            <p className="evx-none">
              The organizer has not published booth pricing. Ask them what a stall costs. Every
              cost figure on this page follows from it.
            </p>
          ) : (
            <div className="evx-booths">
              {event.packages.map((p) => (
                <label
                  key={p.id}
                  className={`evx-booth${selected?.id === p.id ? " is-selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="booth"
                    checked={selected?.id === p.id}
                    onChange={() => setPackageId(p.id)}
                  />
                  <span className="evx-booth-head">
                    <strong>{p.label}</strong>
                    <span className="evx-booth-price">RM{formatNumber(p.priceRm)}</span>
                  </span>
                  <span className="evx-booth-meta">
                    {p.sizeLabel} &middot; {p.slotsAvailable} of {p.slots} left
                  </span>
                  {p.includes.length > 0 && (
                    <span className="evx-booth-inc">Includes {p.includes.join(", ")}</span>
                  )}
                </label>
              ))}
            </div>
          )}
        </section>

        <EventRules event={event} category={category} />
        <EventDoDont event={event} category={category} />

        <div id="cost" className="evx-embed">
          <RoiPanel
            event={event}
            category={category}
            boothCostRm={selected?.priceRm ?? entryPriceRm}
            days={days}
          />
        </div>

        <div id="apply" className="evx-embed">
          <ApplyPanel event={event} packageId={selected?.id ?? null} />
        </div>

        {/* The boxed Provenance section is gone at the owner's request. The
            NOTE is not: it is the disclosure that the booth pricing is an
            estimate rather than the organizer's published terms, and that
            matters more now that applications really send, not less. A quiet
            line at the foot of the page is not a box. */}
        <p className="evx-sourceline">
          {event.sourceNote} Reviewed {event.reviewed}.
        </p>
      </div>
    </>
  );
}

/**
 * One figure, counted up once on arrival.
 *
 * 700ms rather than the simulator's 200ms: that one is tuned for a slider
 * firing continuously, where anything slower reads as lag. Nothing is waiting
 * on these.
 *
 * AN UNRESOLVED FIGURE IS WORDS, NEVER A ZERO. Loading, genuinely absent and
 * actually zero are three different statements and the tile has to say which.
 */
function Stat({
  label,
  value,
  prefix = "",
  suffix = "",
  of,
  fallback = "not stated",
}: {
  label: string;
  value: number | null;
  prefix?: string;
  suffix?: string;
  of?: number;
  fallback?: string;
}) {
  const counted = useCountUp(value ?? 0, 700);

  return (
    <div className="evx-stat">
      <span className="evx-stat-label">{label}</span>
      {value === null ? (
        <span className="evx-stat-value is-absent">{fallback}</span>
      ) : (
        <span className="evx-stat-value">
          {prefix}
          {formatNumber(Math.round(counted))}
          {suffix}
          {of !== undefined && <small> of {formatNumber(of)}</small>}
        </span>
      )}
    </div>
  );
}
