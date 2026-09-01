import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { formatNumber, type BusinessCategory, type LocationScore } from "@spotential/sim-engine";
import type { CompetitorsResponse } from "../../lib/api.js";
import {
  postLocationAsk,
  postLocationBrief,
  type Briefing,
  type ChatTurn,
  type GapsResponse,
  type ReportLocation,
} from "../../lib/api.js";

/**
 * Spotential AI — one surface for the whole location report.
 *
 * IT LIVES IN THE PAGE, NOT IN A TAB, and that is the point of it. The gap
 * write-up and the chat panel used to be two tabs, and the write-up was
 * skipped entirely whenever no category stood out — which is exactly when
 * every category is saturated and the table is hardest to read. So the one
 * screen that most needed prose was guaranteed to get none, and it was two
 * clicks away regardless.
 *
 * THE DERIVED LINE RENDERS FIRST AND ALWAYS. It is computed from the score
 * object, costs nothing and cannot fail, so an unreachable model, a refused
 * briefing or a deployment with no Gemini key all still leave a reader with a
 * sentence that is true. The AI briefing arrives underneath it. That ordering
 * is the whole safety argument: the deterministic core keeps working when the
 * AI layer does not.
 *
 * THE MODEL NEVER DOES ARITHMETIC. It is handed a fact sheet the engine built,
 * and a server-side guard refuses any field citing a number that is not in it.
 * A refusal shows the derived line alone rather than a plausible invention.
 */

/**
 * The sentence that always renders.
 *
 * DERIVED, NEVER GENERATED, and the reason this panel is safe to put at the
 * top of the report: it is read straight off the score object, so it costs
 * nothing, cannot fail, and cannot contradict the figures beneath it. When
 * Gemini is unreachable, refused by the guard, or simply not configured, this
 * is what the reader is left with, and it is still true.
 *
 * Exported so it can be tested on its own, without a browser or a model.
 */
export function deriveSummary(input: {
  score: LocationScore | null;
  competitors: CompetitorsResponse | undefined;
  gaps: GapsResponse | undefined;
  radiusMetres: number;
}): string {
  const { score, competitors, gaps, radiusMetres } = input;
  if (!score) return "Scoring this spot from the data on the page.";

  const scored = score.dimensions.filter((d) => d.kind !== "unavailable");
  const parts: string[] = [`This spot scores ${Math.round(score.overall)} out of 100.`];

  if (scored.length >= 2) {
    const sorted = [...scored].sort((a, b) => b.score - a.score);
    const best = sorted[0]!;
    const worst = sorted[sorted.length - 1]!;
    // Within a few points there is no strongest or weakest to name, and
    // pretending otherwise is the false precision /compare already refuses.
    parts.push(
      best.score - worst.score < 10
        ? `No single dimension stands out across the ${scored.length} that could be measured.`
        : `${best.label} carries it and ${worst.label.toLowerCase()} drags it down.`,
    );
  }

  if (competitors) {
    const count = competitors.truncated
      ? "at least 20"
      : formatNumber(competitors.summary.total);
    parts.push(
      `There ${competitors.summary.total === 1 && !competitors.truncated ? "is" : "are"} ${count} of this type inside ${formatNumber(radiusMetres)}m.`,
    );
  }

  // The finding the owner could not read off the table. Stated plainly.
  if (gaps && gaps.ranked.length > 0) {
    const saturated = gaps.ranked.filter((row) => row.verdict === "saturated").length;
    parts.push(
      saturated === gaps.ranked.length
        ? `Every one of the ${gaps.ranked.length} categories compared here is already crowded, which is itself the finding.`
        : gaps.topOpportunity
          ? `${gaps.topOpportunity.label} is the least crowded relative to its demand.`
          : "No category stands out as an opening.",
    );
  }

  return parts.join(" ");
}

/** Openers that map onto what the data actually holds. */
const SUGGESTIONS = [
  "Why did it score this?",
  "How crowded is it here?",
  "Is the rent reasonable?",
  "What should I watch out for?",
];

/** History is what makes a request expensive; the server caps it too. */
const MAX_TURNS = 8;

type BriefState =
  | { phase: "waiting" }
  | { phase: "thinking" }
  | { phase: "ready"; briefing: Briefing }
  /** The guard fired, or the model is unreachable. The derived line stands. */
  | { phase: "unavailable"; reason: string };

export function SpotentialAI({
  category,
  radiusMetres,
  location,
  gaps,
  ready,
  derived,
  onAdjust,
}: {
  category: BusinessCategory;
  radiusMetres: number;
  location: () => ReportLocation;
  gaps: GapsResponse | undefined;
  /** False until the analysis has something to be grounded on. */
  ready: boolean;
  /** The computed sentence. Never generated, never absent. */
  derived: string;
  onAdjust: (change: { category: BusinessCategory | null; radiusMetres: number | null }) => void;
}) {
  const [brief, setBrief] = useState<BriefState>({ phase: "waiting" });
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /**
   * Generated once the analysis lands, then left alone.
   *
   * Keyed on the figures that change what the briefing would say. The server
   * caches on a hash of the fact sheet, so a repeat of the same view costs
   * nothing at all; this key only decides when to ASK.
   */
  const key = ready
    ? `${category}:${radiusMetres}:${gaps?.ranked.length ?? 0}:${gaps?.topOpportunity?.category ?? ""}`
    : null;
  const asked = useRef<string | null>(null);

  useEffect(() => {
    if (key === null || asked.current === key) return;
    asked.current = key;

    let live = true;
    setBrief({ phase: "thinking" });

    postLocationBrief({
      category,
      radiusMetres,
      location: location(),
      gaps: gaps
        ? {
            ranked: gaps.ranked,
            noPresence: gaps.noPresence,
            topOpportunity: gaps.topOpportunity,
          }
        : null,
    })
      .then((response) => {
        if (!live) return;
        setBrief(
          response.kind === "brief"
            ? { phase: "ready", briefing: response.briefing }
            : { phase: "unavailable", reason: response.reason },
        );
      })
      .catch((caught: unknown) => {
        if (!live) return;
        setBrief({
          phase: "unavailable",
          reason:
            caught instanceof Error
              ? caught.message
              : "Could not reach the analysis. Every figure on this page is unaffected.",
        });
      });

    return () => {
      live = false;
    };
  }, [key, category, radiusMetres, location, gaps]);

  /**
   * The arrival, staggered.
   *
   * `useGSAP` reverts its own context, which matters here: a bare `useEffect`
   * calling `kill()` freezes a `from()` wherever it reached rather than
   * restoring it, and React's double mount in development would strand these
   * at partial opacity permanently.
   *
   * `clearProps` on completion is the second half. A `from()` leaves an inline
   * transform behind, and an inline transform outranks any stylesheet
   * `:hover`, so without this the CSS hover on these rows would be dead even
   * after the tween finished.
   */
  useGSAP(
    () => {
      if (brief.phase !== "ready") return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      gsap.from(".ai-reveal", {
        y: 10,
        autoAlpha: 0,
        duration: 0.5,
        ease: "power3.out",
        stagger: 0.045,
        clearProps: "transform,opacity,visibility",
      });
    },
    { dependencies: [brief.phase], scope: rootRef },
  );

  const ask = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || pending || !ready) return;

    setPending(true);
    setError(null);
    setQuestion("");
    setOpen(true);

    const history = turns.slice(-MAX_TURNS);
    setTurns((current) => [...current, { role: "user", text: trimmed }]);

    try {
      const response = await postLocationAsk({
        question: trimmed,
        category,
        radiusMetres,
        location: location(),
        history,
      });

      let reply: string;
      if (response.kind === "answer") {
        reply = response.text;
      } else if (response.kind === "adjust") {
        // The model proposes; the page's own cached fetch executes. It has not
        // seen the new view, so it must not describe it.
        onAdjust({ category: response.category, radiusMetres: response.radiusMetres });
        reply = `${response.why} The panels are updating. Ask again once they have.`;
      } else if (response.kind === "declined") {
        reply = `${response.reason}${response.suggestion ? ` ${response.suggestion}` : ""}`;
      } else {
        reply = response.reason;
      }

      setTurns((current) => [...current, { role: "model", text: reply }]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not reach the assistant. Every figure on this page is unaffected.",
      );
    } finally {
      setPending(false);
      requestAnimationFrame(() =>
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight }),
      );
    }
  };

  const thinking = brief.phase === "thinking" || brief.phase === "waiting";

  return (
    <section
      className={`aipanel ${thinking ? "is-thinking" : ""} ${
        brief.phase === "ready" ? "has-brief" : ""
      }`}
      ref={rootRef}
      aria-label="Spotential AI analysis"
    >
      <header className="ai-head">
        <span className="ai-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="ai-name">Spotential AI</span>
        {brief.phase === "ready" && (
          <span className="ai-state">reading {gaps ? "the full report" : "this location"}</span>
        )}
        {thinking && <span className="ai-state">working through the numbers</span>}
      </header>

      <div className="ai-body">
        {/**
          * Computed, never generated, and always present.
          *
          * It is the lead sentence while the model works and the only one left
          * if the model never answers. Once a briefing lands it demotes to a
          * quiet line under a label, because the two would otherwise say the
          * same thing twice at the same weight.
          *
          * It is NOT dropped at that point. Which sentences this product
          * computes and which it generates is exactly the distinction the rest
          * of the page is built on, so the label stays visible and so does the
          * figure-derived version of the answer.
          */}
        <p className="ai-derived">
          {brief.phase === "ready" && (
            <span className="ai-derived-tag">Computed from the figures on this page</span>
          )}
          {derived}
        </p>

        {brief.phase === "ready" && (
          <>
            <p className="ai-headline ai-reveal">{brief.briefing.headline}</p>

            <ul className="ai-readings">
              {brief.briefing.readings.map((reading) => (
                <li key={reading} className="ai-reveal">
                  {reading}
                </li>
              ))}
            </ul>

            <div className="ai-cards">
              {brief.briefing.watchOut && (
                <div className="ai-card watch ai-reveal">
                  <span className="ai-card-label">Watch out for</span>
                  <p>{brief.briefing.watchOut}</p>
                </div>
              )}
              {brief.briefing.nextStep && (
                <div className="ai-card next ai-reveal">
                  <span className="ai-card-label">Do this next</span>
                  <p>{brief.briefing.nextStep}</p>
                </div>
              )}
            </div>
          </>
        )}

        {thinking && (
          <div className="ai-skeleton" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        )}

        {brief.phase === "unavailable" && (
          // Says which, rather than showing an empty panel. The line above is
          // still true and still computed from the data.
          <p className="ai-unavailable">{brief.reason}</p>
        )}
      </div>

      <div className="ai-ask no-print">
        {turns.length > 0 && (
          <div className="ai-log-head">
            <span className="ai-turn-who">Conversation</span>
            <button
              type="button"
              className="tiny"
              onClick={() => {
                setTurns([]);
                setOpen(false);
                setError(null);
              }}
            >
              Clear
            </button>
          </div>
        )}

        {turns.length > 0 && (
          <div className="ai-log" ref={listRef}>
            {turns.map((turn, index) => (
              <div key={index} className={`ai-turn ${turn.role}`}>
                <span className="ai-turn-who">{turn.role === "user" ? "You" : "Spotential"}</span>
                <p>{turn.text}</p>
              </div>
            ))}
            {pending && <p className="ai-turn-pending">Working it out…</p>}
          </div>
        )}

        {error && <p className="ai-unavailable">{error}</p>}

        <form
          className="ai-form"
          onSubmit={(event) => {
            event.preventDefault();
            void ask(question);
          }}
        >
          <input
            type="text"
            value={question}
            maxLength={500}
            disabled={!ready || pending}
            placeholder={ready ? "Ask anything about this spot…" : "Waiting for the analysis…"}
            aria-label="Ask about this location"
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button type="submit" className="tiny cta" disabled={!ready || pending || !question.trim()}>
            Ask
          </button>
        </form>

        {!open && ready && (
          <div className="ai-suggestions">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="tiny"
                disabled={pending}
                onClick={() => void ask(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        <p className="ai-caveat">
          Answers cite only figures already on this page. Anything else is refused rather than
          estimated.
        </p>
      </div>
    </section>
  );
}
