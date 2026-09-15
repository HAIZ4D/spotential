import { useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  en,
  formatCurrency,
  formatNumber,
  PATCHABLE_FIELDS,
  type PatchableField,
  type PatchOp,
  type SimulationResult,
} from "@spotential/sim-engine";
import { postAsk, type AskResponse } from "../lib/api.js";
import { SpotentialThinking } from "./sim/SpotentialThinking.js";
import type { ScenarioState } from "../state/useScenario.js";

/**
 * The what-if console — SPEC §7.3 and §8.
 *
 * THE MODEL NEVER CALCULATES. It turns a question into a parameter patch; the
 * deterministic engine computes; the narration describes numbers it was
 * handed. So the console and the figures below it are reading from the same
 * result object and cannot disagree.
 *
 * That used to be a claim the reader had to take on trust, because the patch
 * itself was invisible. The chips now show exactly which parameters the model
 * moved and to what, so the structural honesty is on screen rather than in a
 * comment: if it could only change these eighteen numbers, it could not have
 * invented the profit figure.
 *
 * A patch lands on a BRANCH. The pinned baseline stays put, the affected
 * inputs light up in the rail, and one click reverts.
 *
 * WHY IT IS THE HERO NOW. This was a 300px box wedged above seventeen form
 * fields, with the figures it moved in a different column entirely — so the
 * one thing this page is for was the smallest thing on it, and cause and
 * effect were never on screen together.
 */

/**
 * Human names for the fields a patch may touch.
 *
 * Keyed off `PATCHABLE_FIELDS`, so the type breaks here if the engine ever
 * lets the model move something new without anyone naming it for a reader.
 */
const FIELD_LABELS: Record<PatchableField, string> = {
  avgPricePerTransaction: "Average price",
  customersPerDay: "Customers / day",
  cogsPct: "Cost of goods",
  monthlyRent: "Monthly rent",
  staffCount: "Staff",
  avgMonthlyWage: "Average wage",
  utilities: "Utilities",
  marketing: "Marketing",
  miscMonthly: "Misc & maintenance",
  licensingFees: "Licensing & permits",
  initialInvestment: "Initial investment",
  securityDepositMonths: "Rent deposit",
  monthsToMaturity: "Months to full capacity",
  daysOpenPerWeek: "Days open per week",
  openHoursPerDay: "Open hours per day",
  seats: "Seats",
  serviceChargePct: "Service charge",
  dineInSharePct: "Dine-in share",
};

const EXAMPLES = [
  "what if demand drops 20%?",
  "what if rent goes up 10%?",
  "what if I open 6 days instead of 7?",
  "what if I hire one more person?",
];

export function AskPanel({ scenario }: { scenario: ScenarioState }) {
  const { inputs, result, baselineResult, applyAiScenario, revertToBaseline, isDirty } = scenario;

  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  /** SPEC §8.3 — one clarifying round, then the model must commit. */
  const [clarified, setClarified] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);

  const ask = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || pending) return;

    setPending(true);
    setError(null);

    try {
      const response = await postAsk(inputs, trimmed, clarified);
      setAnswer(response);

      if (response.kind === "patch") {
        applyAiScenario(response.inputs, response.changedFields);
        setClarified(false);
        setQuestion("");
      } else if (response.kind === "clarification") {
        setClarified(true);
      } else {
        setClarified(false);
      }
    } catch (caught) {
      // The deterministic core is untouched. Say so, because the figures on
      // screen are still correct and still usable.
      setError(caught instanceof Error ? caught.message : en.ai.failed);
      setAnswer(null);
    } finally {
      setPending(false);
    }
  };

  /**
   * The answer arriving, staggered.
   *
   * `useGSAP` reverts its own context: a bare `useEffect` calling `kill()`
   * freezes a `from()` wherever it reached rather than restoring it, and
   * React's double mount in development would strand these permanently.
   * `clearProps` on completion matters too — a `from()` leaves an inline
   * transform behind, and an inline transform outranks any stylesheet
   * `:hover`.
   */
  useGSAP(
    () => {
      if (answer?.kind !== "patch") return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      gsap.from(".sim-reveal", {
        y: 10,
        autoAlpha: 0,
        duration: 0.45,
        ease: "power3.out",
        stagger: 0.05,
        clearProps: "transform,opacity,visibility",
      });
    },
    { dependencies: [answer?.kind, answer?.kind === "patch" ? answer.label : ""], scope: rootRef },
  );

  const patchDeltas = answer?.kind === "patch" ? describeDeltas(baselineResult, result) : null;
  const state = pending ? "thinking" : focused ? "listening" : "idle";

  return (
    <section
      className={`simconsole no-print is-${state}`}
      ref={rootRef}
      aria-label="What-if console"
    >
      {/* Decorative only. Three drifting blobs, killed under reduced motion. */}
      <div className="aurora" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>

      <div className="simconsole-inner">
        <header className="sim-head">
          <span className="ai-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="ai-name">Spotential AI</span>
          {pending && <span className="ai-state">{en.ai.thinking}</span>}
        </header>

        {/* The page explained in two lines. It used to open with a KPI strip
            and a form, and never said what it was for. */}
        <h1 className="sim-title">Ask what would happen.</h1>
        <p className="sim-sub">
          Type a question in plain English. Spotential AI changes the numbers it is allowed to
          change, and the figures below recalculate. It never writes a figure itself.
        </p>

        <form
          className="sim-form"
          onSubmit={(event) => {
            event.preventDefault();
            void ask(question);
          }}
        >
          <input
            type="text"
            value={question}
            maxLength={500}
            disabled={pending}
            // It had only a placeholder before, which is not a name.
            aria-label="Ask a what-if question"
            placeholder="what if demand drops 20%?"
            onChange={(event) => setQuestion(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
          <button type="submit" className="sim-ask" disabled={pending || !question.trim()}>
            {pending ? "…" : "Ask"}
          </button>
        </form>

        {!answer && !pending && !error && (
          <div className="sim-examples">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => {
                  setQuestion(example);
                  void ask(example);
                }}
              >
                {example}
              </button>
            ))}
          </div>
        )}

        {/**
          * THE WAIT, MADE HONEST AND ALIVE.
          *
          * Measured against the live model at 13, 22 and 46 seconds. Three
          * pulsing bars over that long reads as broken, so the wait shows the
          * eighteen parameters the model is allowed to move, with a light
          * sweeping across them.
          *
          * It is a metaphor for "choosing among these", NOT a progress bar.
          * There are no progress callbacks from the model, so anything that
          * looked like measured progress would be measuring nothing — and this
          * page's whole argument is that its figures come from somewhere. The
          * caption says what it is, and the honest estimate sits underneath.
          *
          * The payoff is that these are the same chips the answer lights up,
          * so the reader watches the patch being chosen and then sees which
          * ones it picked.
          */}
        {pending && (
          <div className="sim-thinking" aria-hidden="true">
            {/* The mark carries the wait; the chips below give it meaning. */}
            <div className="sim-thinking-mark">
              <SpotentialThinking />
            </div>
            <p className="sim-thinking-cap">Choosing which of these to move</p>
            <div className="sim-scan">
              {PATCHABLE_FIELDS.map((field, index) => (
                <span
                  key={field}
                  className="sim-scan-chip"
                  style={{ animationDelay: `${(index % 9) * 90}ms` }}
                >
                  {FIELD_LABELS[field]}
                </span>
              ))}
            </div>
            <p className="sim-thinking-note">It only ever changes these. Usually about 15 seconds.</p>
          </div>
        )}

        {/* The same promise, for a screen reader, without the decoration. */}
        {pending && (
          <p className="sr-only" role="status">
            {en.ai.thinking}
          </p>
        )}

        {error && <p className="sim-note warn">{error}</p>}

        {answer?.kind === "clarification" && <p className="sim-note">{answer.question}</p>}

        {answer?.kind === "declined" && (
          <p className="sim-note">
            {answer.reason}
            {answer.suggestion ? ` ${answer.suggestion}` : ""}
          </p>
        )}

        {answer?.kind === "patch" && (
          <div className="sim-answer">
            <div className="sim-answer-head sim-reveal">
              <span className="sim-label">{answer.label}</span>
              {patchDeltas && <span className="sim-deltas">{patchDeltas}</span>}
            </div>

            {/**
             * THE PATCH ITSELF, named.
             *
             * The model returns operations on parameters, never figures. Showing
             * them turns "Gemini never does arithmetic" from a promise into
             * something the reader can check at a glance, and it also answers
             * the question they actually have: what did it just change?
             */}
            {answer.operations.length > 0 && (
              <ul className="sim-ops sim-reveal">
                {answer.operations.map((op) => (
                  <li key={`${op.field}-${op.op}-${op.value}`} className="sim-op-picked">
                    <span className="sim-op-field">
                      {FIELD_LABELS[op.field as PatchableField] ?? op.field}
                    </span>
                    <span className="sim-op-change">{describeOp(op.op as PatchOp, op.value)}</span>
                  </li>
                ))}
              </ul>
            )}

            {answer.narration && <p className="sim-narration sim-reveal">{answer.narration}</p>}

            <div className="sim-actions sim-reveal">
              <button
                type="button"
                className="sim-keep"
                onClick={() => {
                  scenario.pinBaseline();
                  setAnswer(null);
                }}
              >
                {en.ai.keepScenario}
              </button>
              <button
                type="button"
                className="sim-revert"
                onClick={() => {
                  revertToBaseline();
                  setAnswer(null);
                }}
              >
                {en.ai.revert}
              </button>
            </div>
          </div>
        )}

        {isDirty && answer?.kind !== "patch" && (
          <div className="sim-actions">
            <button type="button" className="sim-revert" onClick={revertToBaseline}>
              {en.ai.revert}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/** Keeps a decimal when there is one; `formatNumber` rounds to whole units. */
function num(value: number): string {
  return Number.isInteger(value) ? formatNumber(value) : String(Number(value.toFixed(2)));
}

const signed = (value: number, suffix = "") =>
  `${value >= 0 ? "+" : "−"}${num(Math.abs(value))}${suffix}`;

/**
 * Plain words for a patch operation. The engine applies it; this only names it.
 *
 * EXHAUSTIVE OVER `PatchOp` on purpose. The first version guessed the
 * vocabulary — "multiply" and "increment" — and the engine's is
 * `set | mul | add | pct_delta`, so every operation fell through to the
 * default branch and a 15% rent rise rendered as "Monthly rent set to 1",
 * `1.15` having been rounded to a whole number on the way out.
 *
 * A chip that misdescribes the patch is worse than no chip: the whole point of
 * showing the patch is that a reader can check what the model actually did.
 * Typing it to `PatchOp` means a new operation breaks the build here rather
 * than quietly printing nonsense.
 */
export function describeOp(op: PatchOp, value: number): string {
  switch (op) {
    case "set":
      return `set to ${num(value)}`;
    case "mul": {
      const pct = (value - 1) * 100;
      return Math.abs(pct) < 0.05 ? "unchanged" : signed(pct, "%");
    }
    case "add":
      return signed(value);
    case "pct_delta":
      return signed(value, "%");
  }
}

/** Every figure here comes from the engine, never from the model. */
function describeDeltas(before: SimulationResult, after: SimulationResult): string {
  const profit = after.steady.profit - before.steady.profit;
  const parts = [`profit ${profit >= 0 ? "+" : "−"}${formatCurrency(Math.abs(profit))}`];

  if (after.breakEven.paybackMonth !== null && before.breakEven.paybackMonth !== null) {
    const months = after.breakEven.paybackMonth - before.breakEven.paybackMonth;
    if (months !== 0) {
      parts.push(`break-even ${months > 0 ? "+" : "−"}${Math.abs(months)} mo`);
    }
  } else if (after.breakEven.paybackMonth === null) {
    parts.push("never breaks even");
  }

  return parts.join(" · ");
}
