import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import {
  CATEGORY_PRESETS,
  EVENT_TYPE_LABELS,
  entryPrice,
  eventDays,
  formatNumber,
  matchInsight,
  type EventListing,
  type EventScore,
} from "@spotential/sim-engine";
import { bandFor } from "../analysis/ScoreRing.js";
import { MetricRing, RING_KEYS } from "./MetricRing.js";
import { coverFor, posterFor } from "./posters.js";

/**
 * One event, poster first.
 *
 * The poster carries dates, venue and the whole feel of an event in a form a
 * vendor reads faster than any table, so it leads and the figures support it.
 * Everything below the image is what the decision actually turns on: how well
 * it fits, what it costs, and whether there is still room.
 *
 * THE HOVER PLATE IS DECORATION OVER A PLAIN LINK. The whole card is one
 * anchor; the overlay, the CTA and the insight are a flourish on top of it. A
 * "View details" button that only exists on hover is unreachable by keyboard
 * and invisible on touch, so nothing here may be the only way through.
 */

const DATE = new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short" });
const DATE_YEAR = new Intl.DateTimeFormat("en-MY", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function formatRun(event: EventListing): string {
  const start = new Date(event.startDate);
  const end = new Date(event.endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "Dates to be confirmed";
  if (event.startDate === event.endDate) return DATE_YEAR.format(start);
  return `${DATE.format(start)} – ${DATE_YEAR.format(end)}`;
}

export function EventCard({ event, score }: { event: EventListing; score?: EventScore }) {
  const cardRef = useRef<HTMLElement>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const scoreRef = useRef<HTMLSpanElement>(null);

  /**
   * quickTo, not a fresh tween per pointer event — the case the motion
   * guidance names for garbage churn on lists of hoverable cards.
   */
  const setters = useRef<{
    lift?: (v: number) => void;
    zoom?: (v: number) => void;
    veil?: (v: number) => void;
  }>({});

  useEffect(() => {
    if (veilRef.current) gsap.set(veilRef.current, { opacity: 0 });
  }, []);

  /**
   * The score counts up — and ONLY the score.
   *
   * It is a rounded 0-100 index whose intermediate values are meaningful, so
   * watching it climb reads as measurement. Money and dates are never animated
   * anywhere in this app for the opposite reason: counting through 6.4 to
   * reach 7 invents precision the engine did not produce.
   */
  useEffect(() => {
    const el = scoreRef.current;
    if (!el || !score) return;

    const target = Math.round(score.overall);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.textContent = String(target);
      return;
    }

    const value = { n: 0 };
    const tween = gsap.to(value, {
      n: target,
      duration: 0.8,
      ease: "power2.out",
      onUpdate: () => {
        el.textContent = String(Math.round(value.n));
      },
    });
    return () => {
      // Killing a counter leaves it mid-count, so the final value is written
      // back explicitly — the number on screen must always be the real one.
      tween.kill();
      el.textContent = String(target);
    };
  }, [score]);

  const ensure = () => {
    if (setters.current.lift || !cardRef.current) return;
    setters.current.lift = gsap.quickTo(cardRef.current, "y", {
      duration: 0.3,
      ease: "power2.out",
    });
    if (mediaRef.current) {
      setters.current.zoom = gsap.quickTo(mediaRef.current, "scale", {
        duration: 0.55,
        ease: "power2.out",
      });
    }
    if (veilRef.current) {
      /**
       * `opacity`, not `autoAlpha`.
       *
       * quickTo animates ONE property, and autoAlpha is a composite of opacity
       * and visibility — the visibility half never ran, so the plate faded
       * against a `visibility: hidden` it could not lift and stayed invisible.
       * The plate is `aria-hidden` with `pointer-events: none`, so opacity
       * alone is enough to keep it out of the way when closed.
       */
      setters.current.veil = gsap.quickTo(veilRef.current, "opacity", { duration: 0.25 });
    }
  };

  const hover = (on: boolean) => () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    ensure();
    setters.current.lift?.(on ? -6 : 0);
    setters.current.zoom?.(on ? 1.07 : 1);
    setters.current.veil?.(on ? 1 : 0);
  };

  const price = entryPrice(event);
  const days = eventDays(event);
  const full = event.availableSlots <= 0;
  const poster = posterFor(event);
  const cover = coverFor(event);
  const insight = score ? matchInsight(score) : null;
  const band = score ? bandFor(Math.round(score.overall)) : null;

  const rings = score
    ? RING_KEYS.map((r) => ({ ...r, dimension: score.dimensions.find((d) => d.key === r.key) }))
        .filter((r) => r.dimension)
    : [];

  /** Under a fifth left reads as pressure; the exact figure is always shown. */
  const scarce = !full && event.availableSlots / Math.max(1, event.totalSlots) <= 0.2;

  return (
    <article
      className={`evc${full ? " is-full" : ""}`}
      ref={cardRef}
      onMouseEnter={hover(true)}
      onMouseLeave={hover(false)}
      data-event={event.id}
    >
      <Link to={`/events/${event.slug}`} className="evc-hit">
        <span className="sr-only">{event.name} — view details</span>
      </Link>

      <div className="evc-media">
        <div className="evc-img" ref={mediaRef}>
          {poster ? (
            <img src={poster} alt="" loading="lazy" decoding="async" />
          ) : (
            <span
              className="evc-cover"
              style={{ background: `linear-gradient(140deg, ${cover.from}, ${cover.to})` }}
            >
              <b>{cover.initials}</b>
              <i>{EVENT_TYPE_LABELS[event.eventType]}</i>
            </span>
          )}
        </div>

        {/* Always-on scrim, so the chips over the poster stay legible whatever
            the artwork behind them happens to be. */}
        <span className="evc-scrim" aria-hidden="true" />

        <div className="evc-chips">
          <span className="evc-type">{EVENT_TYPE_LABELS[event.eventType]}</span>
          {scarce && <span className="evc-scarce">{event.availableSlots} left</span>}
          {full && <span className="evc-soldout">Full</span>}
        </div>

        {score && band && (
          <div className={`evc-score ${band.cls}`}>
            <span className="evc-score-n" ref={scoreRef}>
              0
            </span>
            <span className="evc-score-l">match</span>
          </div>
        )}

        <div className="evc-veil" ref={veilRef} aria-hidden="true">
          {insight && <p className="evc-why">{insight.headline}</p>}
          <span className="evc-cta">
            View details
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
              <path d="M5 12h13M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      </div>

      <div className="evc-body">
        <h3 className="evc-name">{event.name}</h3>

        <p className="evc-meta">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1116 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          <span className="evc-truncate">
            {event.venueName} · {event.state}
          </span>
        </p>
        <p className="evc-meta">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
          </svg>
          <span className="evc-truncate">
            {formatRun(event)} · {days} day{days === 1 ? "" : "s"}
          </span>
        </p>

        {event.wantedCategories.length > 0 && (
          <p className="evc-wants">
            {event.wantedCategories.slice(0, 2).map((c) => (
              <span className="evc-tag" key={c}>
                {CATEGORY_PRESETS[c].label}
              </span>
            ))}
            {event.wantedCategories.length > 2 && (
              <span className="evc-tag ghost">+{event.wantedCategories.length - 2}</span>
            )}
          </p>
        )}

        {rings.length > 0 && (
          <div className="evc-rings">
            {rings.map((r, i) => (
              <MetricRing
                key={r.key}
                dimension={r.dimension!}
                label={r.label}
                delay={0.15 + i * 0.08}
              />
            ))}
          </div>
        )}

        <footer className="evc-foot">
          <span className="evc-price">
            {price === null ? (
              <em>Price on request</em>
            ) : (
              <>
                <b>RM{formatNumber(price)}</b>
                <small>cheapest booth</small>
              </>
            )}
          </span>
          <span className={`evc-slots${full ? " is-full" : ""}`}>
            {full ? "No booths left" : `${event.availableSlots} of ${event.totalSlots}`}
          </span>
        </footer>
      </div>
    </article>
  );
}
