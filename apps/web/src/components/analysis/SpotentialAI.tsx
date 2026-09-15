import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { formatNumber, type BusinessCategory, type LocationScore } from "@spotential/sim-engine";
import type { CompetitorsResponse } from "../../lib/api.js";
import {
  postLocationAsk,
  postLocationBrief,
  type AgentReading,
  type ChatTurn,
  type GapsResponse,
  type LocationReadings,
  type ReportLocation,
} from "../../lib/api.js";
import mark from "../../../img/spotential-mark.png";

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
 * FOUR SPECIALISTS, NOT ONE ASSISTANT. Opportunity, Rivals, Customers and
 * Money each read a different section of the same fact sheet and each answer
 * in their own call. It replaced a single briefing that was asked to do all of
 * it at once and read like a general assistant because that is what it was.
 *
 * THE MODEL NEVER DOES ARITHMETIC. It is handed a fact sheet the engine built,
 * and a server-side guard refuses any field citing a number that is not in it.
 * A refusal now costs ONE CARD rather than the panel, and the missing card is
 * named: a shorter panel that looks complete is the failure the split exists
 * to avoid.
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

/**
 * The figures behind the gap reading, folded away.
 *
 * The owner asked for the Gaps tab to go, and said its table told them
 * nothing. Both are true, and neither is a reason to make the AI's claim
 * unfalsifiable: everything else on this page can be checked against a number,
 * and this section should be no different. So the table is collapsed rather
 * than deleted, exactly as the score working is.
 *
 * The five caveats come with it. They were the only honest account of what
 * this ranking cannot tell you, and they lived nowhere else.
 */
function GapWorking({ gaps }: { gaps: GapsResponse }) {
  return (
    <details className="ai-working">
      <summary>Show the figures behind this</summary>

      <ul className="ai-gap-rows">
        {gaps.ranked.map((row) => (
          <li key={row.category}>
            <span className="ai-gap-label">{row.label}</span>
            <span className="ai-gap-figs">
              {/* A capped search is a floor, never an exact count. */}
              {row.outletsAreMinimum ? `${row.outlets}+` : row.outlets} outlets
              {row.reviewsPerOutlet === null
                ? ", reviews not known"
                : `, ${formatNumber(row.reviewsPerOutlet)} reviews each`}
              {row.averageRating === null ? ", unrated" : `, ${row.averageRating}★`}
            </span>
            <span className={`ai-gap-verdict-pill ${row.verdict}`}>{row.verdict}</span>
          </li>
        ))}
      </ul>

      {gaps.noPresence.length > 0 && (
        <p className="ai-working-note">
          <strong>Not found nearby:</strong> {gaps.noPresence.map((r) => r.label).join(", ")}. Zero
          outlets is <strong>not</strong> evidence of an opening. It may mean untapped demand, or
          that there is no appetite for it here, and this data cannot tell the two apart, so these
          are left out of the ranking.
        </p>
      )}

      <ul className="ai-working-notes">
        <li>
          <strong>Reviews per outlet</strong> stands in for how busy existing operators are. It is a
          proxy, not a measure of demand.
        </li>
        <li>
          Scores are <strong>relative to the other categories at this spot</strong>, not to Malaysia.
          The claim is &ldquo;underserved compared with what else trades on this street&rdquo;.
        </li>
        <li>
          Review counts are lifetime totals, so they favour long-established businesses over busy new
          ones.
        </li>
        <li>
          Google&rsquo;s category labels are approximate. A Korean restaurant tagged simply as
          &ldquo;restaurant&rdquo; lands in the wrong bucket.
        </li>
        <li>Real demographic demand data will replace this proxy when it lands.</li>
      </ul>
    </details>
  );
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
  | { phase: "ready"; result: LocationReadings }
  /** The model is unreachable or unconfigured. The derived line stands. */
  | { phase: "unavailable"; reason: string };

/**
 * Render order, fixed here rather than taken from the response.
 *
 * The server returns whichever specialists ran, and skipped ones come back on
 * a separate list, so left to itself the panel would reshuffle as sections
 * appear and disappear between locations. It reads in the order somebody
 * actually decides: is there an opening, who is already here, who lives here,
 * what does it cost.
 */
const AGENT_ORDER = ["opportunity", "rivals", "customers", "money"] as const;

/**
 * WITHHELD AND SKIPPED ARE DIFFERENT THINGS, and the card says which.
 *
 * Withheld means the specialist answered and its answer was thrown away,
 * almost always because it cited a figure this page never measured. Skipped
 * means it was never asked, because the section it reads is empty. Printing
 * one as the other would tell a reader the model had nothing to say about rent
 * when the truth is that no benchmark reaches this point.
 */
const WITHHELD_COPY: Record<string, string> = {
  refused:
    "Withheld. This reading referred to a figure this page did not measure, so it was not shown.",
  failed: "This reading did not come back. Every figure on the page is unaffected.",
};

function Specialist({
  role,
  reading,
  quiet,
}: {
  role: string;
  reading?: AgentReading;
  /** The reason there is no reading. Computed or mapped, never generated. */
  quiet?: string;
}) {
  return (
    <article className={`ai-spec ai-reveal${reading ? "" : " is-quiet"}`}>
      <span className="ai-spec-role">{role}</span>

      {reading ? (
        <>
          <p className="ai-spec-headline">{reading.headline}</p>
          <ul className="ai-spec-points">
            {reading.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          {/* The action, marked apart from the observations above it. The
              owner's verdict on the old gap table was that it told them
              nothing they could act on, and this is the answer to that. */}
          {reading.move && (
            <p className="ai-spec-move">
              <span className="ai-spec-move-label">Do this</span>
              {reading.move}
            </p>
          )}
        </>
      ) : (
        <p className="ai-spec-quiet">{quiet}</p>
      )}
    </article>
  );
}

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
        /**
         * A reply naming no specialist at all is not a panel.
         *
         * `postLocationBrief` normalises the shape so nothing can throw, which
         * leaves one case it cannot fix: a response that parsed but described
         * nothing, which is what an older revision answering during a deploy
         * looks like. Four empty cards would be worse than saying so.
         */
        const named =
          response.readings.length + response.withheld.length + response.skipped.length;
        setBrief(
          named > 0
            ? { phase: "ready", result: response }
            : {
                phase: "unavailable",
                reason:
                  "The analysis did not come back in a form this page could read. Every figure here is unaffected.",
              },
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
          <span className="ai-state">
            {/* Counts what actually ran, so a location with two sections of
                data does not claim four specialists looked at it. */}
            {brief.result.readings.length === 1
              ? "1 specialist on this location"
              : `${brief.result.readings.length} specialists on this location`}
          </span>
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
          <div className="ai-specialists">
            {AGENT_ORDER.map((id) => {
              const reading = brief.result.readings.find((r) => r.id === id);
              if (reading) {
                return <Specialist key={id} role={reading.role} reading={reading} />;
              }

              /**
               * A specialist with no reading still gets a card.
               *
               * Dropping it would leave a panel that looks complete while a
               * whole subject is missing, which is the one failure splitting
               * this into four calls exists to prevent.
               */
              const withheld = brief.result.withheld.find((w) => w.id === id);
              if (withheld) {
                return (
                  <Specialist
                    key={id}
                    role={withheld.role}
                    quiet={WITHHELD_COPY[withheld.reason] ?? WITHHELD_COPY["failed"]!}
                  />
                );
              }

              const skipped = brief.result.skipped.find((k) => k.id === id);
              if (!skipped) return null;
              return <Specialist key={id} role={skipped.role} quiet={skipped.reason} />;
            })}
          </div>
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

        {/**
          * OUTSIDE the ready branch, deliberately.
          *
          * Nesting it inside meant a failed or refused briefing took the
          * figures down with it, leaving nothing checkable at all — the
          * opposite of the point. The model failing should cost the prose, not
          * the evidence, which is the rule the gaps table already followed
          * when it lived in its own tab.
          */}
        {gaps &&
          (gaps.ranked.length > 0 ? (
            <GapWorking gaps={gaps} />
          ) : (
            <p className="ai-working-note">
              Nothing of any tracked category trades within {gaps.radiusMetres}m of here, so there
              is no signal to compare against. That is not the same as an opening: it may equally
              mean there is no appetite for this kind of business on this street.
            </p>
          ))}
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
            {/**
              * An HONEST waiting state, not a spinner.
              *
              * Asking takes ten seconds or more and the only signal used to be
              * the word "Thinking" on the button. There are no progress
              * callbacks from the model, so a bar or a percentage would be
              * measuring nothing; what this says instead is what actually
              * happens, which is that the answer comes from this page's own
              * figures and every number in it is checked against them before
              * it is shown.
              */}
            {pending && (
              <div className="aiwait" role="status" aria-live="polite">
                <span className="aiwait-mark" aria-hidden="true">
                  <img src={mark} alt="" width={26} height={28} />
                </span>
                <span className="aiwait-body">
                  <span className="aiwait-line">Reading this location</span>
                  <span className="aiwait-note">
                    Answering from the figures on this page, then checking every number in the
                    reply against them.
                  </span>
                </span>
              </div>
            )}
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
