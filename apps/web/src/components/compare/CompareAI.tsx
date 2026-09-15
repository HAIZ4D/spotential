import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  formatNumber,
  type BusinessCategory,
  type ComparedLocation,
  type Comparison,
} from "@spotential/sim-engine";
import {
  postCompareAsk,
  postCompareBrief,
  type AgentReading,
  type ChatTurn,
  type ReportLocation,
} from "../../lib/api.js";
import { SpotentialThinking } from "../sim/SpotentialThinking.js";
import mark from "../../../img/spotential-mark.png";
import { useReveal } from "../events/useReveal.js";

/**
 * Spotential AI on a comparison: three specialists, then a question box.
 *
 * THE DERIVED LINE COMES FIRST, AND THAT ORDERING IS THE SAFETY ARGUMENT.
 * `summarise` below reads the comparison object, costs nothing and cannot
 * fail, so an unreachable model, a guard refusal, or a deployment with no
 * Gemini key all still leave a reader with something true. Everything the
 * model wrote arrives underneath it and is labelled, because which sentences
 * this product computes and which it generates is the distinction the rest of
 * the page rests on.
 *
 * THREE SPECIALISTS, NOT ONE VOICE. The Analyst says what the gaps mean in
 * trading terms, the Skeptic says what would change the answer, the Advisor
 * says what to do next. They run in parallel server-side and each is guarded
 * separately, so one refused reading is named as withheld rather than taking
 * the panel down with it.
 *
 * NONE OF THEM RESTATES THE VERDICT. `CompareHero` already computes which site
 * leads, by how much and on which dimension. A model sentence saying the same
 * thing with less authority would be worse than nothing.
 */

/**
 * The sentence that renders whatever happens to the model.
 *
 * Derived, never generated: it sits above prose that describes the same
 * figures, so a written one could contradict the computed one an inch below.
 */
function summarise(scored: ComparedLocation[], comparison: Comparison): string {
  const unscored = comparison.dimensions.filter((d) => d.outcome.kind === "noData").length;
  const total = comparison.dimensions.length;
  const leader = scored.find((s) => s.id === comparison.winnerId);

  const verdict = leader
    ? `${leader.label} scores highest, by ${formatNumber(comparison.overallSpread, 1)} points.`
    : `No site separates from the others: the spread is ${formatNumber(
        comparison.overallSpread,
        1,
      )} points, inside what these figures support.`;

  const basis =
    unscored === 0
      ? `All ${total} dimensions scored.`
      : `${unscored} of ${total} dimensions could not be scored on any site, so the verdict rests on ${
          total - unscored
        }.`;

  return `${verdict} ${basis}`;
}

const ROLE_NOTE: Record<string, string> = {
  Analyst: "what the differences mean in practice",
  Skeptic: "what would change this answer",
  Advisor: "what to do next",
};

export function CompareAI({
  category,
  radiusMetres,
  locations,
  scored,
  comparison,
}: {
  category: BusinessCategory;
  radiusMetres: number;
  locations: ReportLocation[];
  scored: ComparedLocation[];
  comparison: Comparison;
}) {
  const derived = useMemo(() => summarise(scored, comparison), [scored, comparison]);

  const brief = useQuery({
    // Keyed on what the server is actually sent, so changing a rent, a radius
    // or a category refetches rather than showing prose about old figures.
    queryKey: ["compare-brief", category, radiusMetres, JSON.stringify(locations)],
    queryFn: ({ signal }) => postCompareBrief({ category, radiusMetres, locations }, signal),
    enabled: locations.length >= 2,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });

  const readingsRef = useRef<HTMLDivElement>(null);
  useReveal(readingsRef, { selector: ":scope > .cmpai-card", stagger: 0.07, y: 14 });

  return (
    <section className="cmpx-panel cmpai">
      <header className="cmpx-panel-head">
        <span className="cmpx-kicker">Spotential AI</span>
        <h2>What this comparison is telling you</h2>
        {/* Computed, and it says so. The line between a figure this product
            derived and a sentence a model wrote is the one the whole page
            rests on. */}
        <p className="cmpai-derived">{derived}</p>
      </header>

      {brief.isPending && locations.length >= 2 && (
        <div className="cmpai-wait">
          <SpotentialThinking />
          <div>
            <p className="cmpai-wait-title">Three specialists are reading it</p>
            <p className="cmpai-wait-note">
              An analyst on what the gaps mean, a sceptic on what would change the answer, and an
              adviser on what to do next. They run at the same time and each one is checked
              against the figures on this page before you see it.
            </p>
          </div>
        </div>
      )}

      {brief.isError && (
        <div className="notice warn">
          <span>
            The written analysis could not be reached. Everything above is computed on this page
            and is unaffected.
          </span>
        </div>
      )}

      {brief.data && (
        <>
          <div className="cmpai-readings" ref={readingsRef}>
            {brief.data.readings.map((reading) => (
              <Reading key={reading.id} reading={reading} />
            ))}
          </div>

          {/* Named, not hidden. A shorter panel that looks complete is worse
              than one that says which view is missing. */}
          {brief.data.withheld.length > 0 && (
            <p className="cmpai-withheld">
              {brief.data.withheld.map((w) => w.role).join(" and ")} could not be shown:{" "}
              {brief.data.withheld.some((w) => w.reason === "refused")
                ? "a reading referred to a figure this page did not measure, so it was withheld rather than shown."
                : "that reading did not come back. The others are unaffected."}
            </p>
          )}

          <p className="cmpai-label">
            Written by Spotential AI from the figures on this page. Every number in it is checked
            against them before it is shown, and the comparison itself is computed, not generated.
          </p>
        </>
      )}

      {locations.length >= 2 && (
        <AskBox category={category} radiusMetres={radiusMetres} locations={locations} />
      )}
    </section>
  );
}

function Reading({ reading }: { reading: AgentReading }) {
  return (
    <article className={`cmpai-card ${reading.id}`}>
      <header>
        <h3>{reading.role}</h3>
        <span>{ROLE_NOTE[reading.role] ?? ""}</span>
      </header>
      <p className="cmpai-headline">{reading.headline}</p>
      <ul>
        {reading.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
    </article>
  );
}

const EXAMPLES = [
  "Which site is the safer bet and why?",
  "What am I not seeing here?",
  "What should I check before signing?",
];

function AskBox({
  category,
  radiusMetres,
  locations,
}: {
  category: BusinessCategory;
  radiusMetres: number;
  locations: ReportLocation[];
}) {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // A new comparison invalidates the conversation: answers about the old one
  // would be about figures no longer on the page.
  useEffect(() => {
    setHistory([]);
    setReply(null);
    setNote(null);
  }, [category, radiusMetres, locations.length]);

  const ask = (text: string) => {
    const asked = text.trim();
    if (!asked || busy) return;

    setBusy(true);
    setReply(null);
    setNote(null);

    void postCompareAsk({ question: asked, category, radiusMetres, locations, history })
      .then((outcome) => {
        if (outcome.kind === "answer") {
          setReply(outcome.text);
          setHistory((current) => [
            ...current,
            { role: "user", text: asked },
            { role: "model", text: outcome.text },
          ]);
          return;
        }
        if (outcome.kind === "declined") {
          setNote(`${outcome.reason}${outcome.suggestion ? ` ${outcome.suggestion}` : ""}`);
          return;
        }
        // A refusal is a bad answer; an invented figure presented as a
        // measurement is a wrong one, and only the second is unrecoverable.
        setNote(outcome.reason);
      })
      .catch((error: Error) => setNote(error.message))
      .finally(() => {
        setBusy(false);
        setQuestion("");
        logRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
  };

  return (
    <div className="cmpai-ask">
      <label className="cmpai-ask-label" htmlFor="cmpai-question">
        Ask about this comparison
      </label>

      <form
        className="cmpai-ask-form"
        onSubmit={(event) => {
          event.preventDefault();
          ask(question);
        }}
      >
        <input
          id="cmpai-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Which one would you take, and what would change your mind?"
          maxLength={500}
          disabled={busy}
        />
        <button type="submit" disabled={busy || question.trim().length < 2}>
          {busy ? "Thinking…" : "Ask"}
        </button>
      </form>

      <div className="cmpai-examples">
        {EXAMPLES.map((example) => (
          <button key={example} type="button" disabled={busy} onClick={() => ask(example)}>
            {example}
          </button>
        ))}
      </div>

      <div ref={logRef}>
        {/**
         * An HONEST waiting state, and the reason it names no stages.
         *
         * There are no progress callbacks from the model, so a bar or a
         * percentage would be measuring nothing. What it says instead is what
         * is literally happening: the question is being answered from this
         * page's figures, and every number in the reply is checked against
         * them before anybody sees it. Same reasoning as the simulator's wait,
         * which shows the parameters being considered rather than a
         * percentage.
         */}
        {busy && (
          <div className="aiwait" role="status" aria-live="polite">
            <span className="aiwait-mark" aria-hidden="true">
              <img src={mark} alt="" width={26} height={28} />
            </span>
            <span className="aiwait-body">
              <span className="aiwait-line">Reading this comparison</span>
              <span className="aiwait-note">
                Answering from the figures on this page, then checking every number in the reply
                against them.
              </span>
            </span>
          </div>
        )}

        {reply && <p className="cmpai-reply">{reply}</p>}
        {note && (
          <div className="notice warn">
            <span>{note}</span>
          </div>
        )}
      </div>

      <p className="cmpai-ask-note">
        It answers from this page only and cannot work out a figure of its own. It also cannot
        change the business type or the radius: those controls are at the top, and moving them
        re-runs the search for every site.
      </p>
    </div>
  );
}
