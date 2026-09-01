import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  EVENT_TYPE_LABELS,
  formatNumber,
  listCategories,
  scoreEvent,
  type BusinessCategory,
  type VendorProfile,
} from "@spotential/sim-engine";
import { Masthead } from "../components/Masthead.js";
import { ScoreRing, bandFor } from "../components/analysis/ScoreRing.js";
import { RoiPanel } from "../components/events/RoiPanel.js";
import { ApplyPanel } from "../components/events/ApplyPanel.js";
import { formatRun } from "../components/events/EventCard.js";
import { coverFor, posterFor } from "../components/events/posters.js";
import { getEvent } from "../lib/api.js";

/**
 * One event, in full.
 *
 * The page answers three questions in order, because that is the order a
 * vendor actually asks them: does this event want me, will it pay for itself,
 * and how do I get in.
 *
 * The score is computed IN THE BROWSER from the same engine the server uses,
 * seeded with the venue catchment the detail route supplies. Client and server
 * agreeing is a tautology here rather than a test, because there is one
 * implementation — the same property the simulator relies on.
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

  if (detail.isPending) {
    return (
      <>
        <Masthead subtitle="Events" />
        <div className="cockpit events detail">
          <p className="muted" style={{ padding: 24 }}>
            Loading event…
          </p>
        </div>
      </>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <>
        <Masthead subtitle="Events" />
        <div className="cockpit events detail">
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
  const cover = coverFor(event);
  const selected = event.packages.find((p) => p.id === packageId) ?? event.packages[0] ?? null;

  return (
    <>
      <Masthead subtitle="Events" />

      <div className="cockpit events detail">
        <div className="cockpit-info">
          <nav className="crumb">
            <Link to="/events">← All events</Link>
          </nav>

          <section className="card">
            {/* The organizer's own artwork, shown whole rather than cropped —
                it carries dates, times and the vendor categories in a form a
                reader takes in faster than the table below repeats them. */}
            <div className="detail-hero">
              <div className="detail-poster">
                {poster ? (
                  <img src={poster} alt={`${event.name} event poster`} />
                ) : (
                  <span
                    className="ev-cover"
                    style={{ background: `linear-gradient(140deg, ${cover.from}, ${cover.to})` }}
                  >
                    <b>{cover.initials}</b>
                    <i>{EVENT_TYPE_LABELS[event.eventType]}</i>
                  </span>
                )}
              </div>
            </div>
            <div className="body stack">
              <div className="event-card-tags">
                <span className="pill navy">{EVENT_TYPE_LABELS[event.eventType]}</span>
                {event.availableSlots > 0 ? (
                  <span className="pill green">{event.availableSlots} booths left</span>
                ) : (
                  <span className="pill red">Booths full</span>
                )}
              </div>

              <h1 className="event-title">{event.name}</h1>
              <p className="muted">{event.summary}</p>

              <dl className="event-facts wide">
                <div>
                  <dt>When</dt>
                  <dd>
                    {formatRun(event)} · {days} day{days === 1 ? "" : "s"}
                    <span className="muted"> · {event.dailyHours}</span>
                  </dd>
                </div>
                <div>
                  <dt>Where</dt>
                  <dd>
                    {event.venueName}
                    <br />
                    <span className="muted">{event.address}</span>
                  </dd>
                </div>
                <div>
                  <dt>Organizer</dt>
                  <dd>{event.organizerName}</dd>
                </div>
                <div>
                  <dt>Expected visitors</dt>
                  <dd>
                    {/* Never rendered as 0. Unstated and "we expect nobody" are
                        opposite claims. */}
                    {event.expectedVisitors === null ? (
                      <span className="muted">not stated</span>
                    ) : (
                      <>
                        {formatNumber(event.expectedVisitors)}{" "}
                        <span className="muted">· organizer's estimate</span>
                      </>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Booths</dt>
                  <dd>
                    {formatNumber(event.availableSlots)} of {formatNumber(event.totalSlots)}{" "}
                    available
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
                        <span className="muted">
                          residents within {catchmentRadiusMetres}m
                        </span>
                      </>
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          </section>

          <section className="card">
            <header>
              <h2>Booths</h2>
            </header>
            <div className="body">
              {event.packages.length === 0 ? (
                <p className="muted">
                  The organizer has not published booth pricing. Ask them what a stall costs.
                  every figure on this page follows from it.
                </p>
              ) : (
                <div className="booth-list">
                  {event.packages.map((p) => (
                    <label
                      key={p.id}
                      className={`booth${selected?.id === p.id ? " is-selected" : ""}`}
                    >
                      <input
                        type="radio"
                        name="booth"
                        checked={selected?.id === p.id}
                        onChange={() => setPackageId(p.id)}
                      />
                      <span className="booth-main">
                        <strong>{p.label}</strong>
                        <span className="muted">
                          {p.sizeLabel} · {p.slotsAvailable} of {p.slots} left
                        </span>
                        {p.includes.length > 0 && (
                          <span className="tiny muted">Includes {p.includes.join(", ")}</span>
                        )}
                      </span>
                      <span className="booth-price">RM{formatNumber(p.priceRm)}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </section>

          {event.vendorRequirements.length > 0 && (
            <section className="card">
              <header>
                <h2>What the organizer requires</h2>
              </header>
              <div className="body">
                <ul className="tight">
                  {event.vendorRequirements.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          <RoiPanel
            event={event}
            category={category}
            boothCostRm={selected?.priceRm ?? entryPriceRm}
            days={days}
          />

          <ApplyPanel event={event} />

          <section className="card">
            <header>
              <h2>Where this listing came from</h2>
            </header>
            <div className="body">
              <p className="tiny muted">
                {event.sourceNote} Reviewed {event.reviewed}.
              </p>
            </div>
          </section>
        </div>

        <div className="cockpit-side">
          {score && (
            <section className="card sticky">
              <header>
                <h2>Opportunity score</h2>
              </header>
              <div className="body stack">
                <div className="score-hero">
                  <ScoreRing score={score.overall} />
                </div>

                <div className="field">
                  <label htmlFor="detail-category">Scored for</label>
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
                </div>

                <div className="dim-bars">
                  {score.dimensions.map((d) => {
                    const measured = d.kind !== "unavailable";
                    return (
                      <div className="dim-bar" key={d.key}>
                        <span className="dim-bar-label">{d.label}</span>
                        <span className="dim-bar-track">
                          {measured && (
                            <i
                              className={`dim-bar-fill ${bandFor(Math.round(d.score)).cls}`}
                              style={{ width: `${Math.max(1.5, Math.min(100, d.score))}%` }}
                            />
                          )}
                        </span>
                        <span className={`dim-bar-value ${measured ? "" : "muted"}`}>
                          {measured ? Math.round(d.score) : "not scored"}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <ul className="dim-notes">
                  {score.dimensions.map((d) => (
                    <li key={d.key}>
                      <strong>{d.label}</strong>
                      {d.kind === "proxy" && <span className="pill muted tiny">estimated</span>}
                      <span className="tiny muted"> {d.note}</span>
                    </li>
                  ))}
                </ul>

                <div className="notice info">
                  <span>
                    A comparison aid, not a forecast. Weights reflect how far each signal can be
                    trusted, and the organizer's own turnout estimate carries the least.
                  </span>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
