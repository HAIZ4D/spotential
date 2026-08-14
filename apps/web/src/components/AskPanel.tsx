import { useState } from "react";
import { en, formatCurrency, type SimulationResult } from "@spotential/sim-engine";
import { postAsk, type AskResponse } from "../lib/api.js";
import type { ScenarioState } from "../state/useScenario.js";

/**
 * Free-form what-if questions — SPEC §7.3 and §8.
 *
 * The model never calculates. It turns a question into a parameter patch; the
 * deterministic engine computes; the narration describes numbers it was
 * handed. So the chat and the panel are literally reading from the same
 * result object and cannot disagree.
 *
 * A patch lands on a BRANCH. The pinned baseline stays put, the affected
 * inputs light up, and one click reverts.
 */
export function AskPanel({ scenario }: { scenario: ScenarioState }) {
  const { inputs, result, baselineResult, applyAiScenario, revertToBaseline, isDirty } = scenario;

  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** SPEC §8.3 — one clarifying round, then the model must commit. */
  const [clarified, setClarified] = useState(false);

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
      // The deterministic core is untouched — say so, because the figures on
      // screen are still correct and still usable.
      setError(caught instanceof Error ? caught.message : en.ai.failed);
      setAnswer(null);
    } finally {
      setPending(false);
    }
  };

  const patchDeltas =
    answer?.kind === "patch" ? describeDeltas(baselineResult, result) : null;

  return (
    <section className="card no-print">
      <header>
        <h2>Ask a what-if</h2>
        {isDirty && (
          <button type="button" className="tiny" onClick={revertToBaseline}>
            {en.ai.revert}
          </button>
        )}
      </header>

      <div className="body stack">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
          style={{ display: "flex", gap: 6 }}
        >
          <input
            type="text"
            value={question}
            maxLength={500}
            placeholder="what if demand drops 20%?"
            onChange={(e) => setQuestion(e.target.value)}
            style={{
              flex: 1,
              padding: "7px 9px",
              border: "1px solid var(--line)",
              borderRadius: 7,
              font: "inherit",
            }}
          />
          <button type="submit" className="primary" disabled={pending || !question.trim()}>
            {pending ? "…" : "Ask"}
          </button>
        </form>

        {!answer && !pending && !error && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[
              "what if demand drops 20%?",
              "what if rent goes up 10%?",
              "what if I open 6 days instead of 7?",
            ].map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="tiny"
                onClick={() => {
                  setQuestion(suggestion);
                  void ask(suggestion);
                }}
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        {pending && <span className="small muted">{en.ai.thinking}</span>}

        {error && <div className="notice warn">{error}</div>}

        {answer?.kind === "clarification" && (
          <div className="notice info">
            <span>{answer.question}</span>
          </div>
        )}

        {answer?.kind === "declined" && (
          <div className="notice info">
            <div className="stack">
              <span>{answer.reason}</span>
              {answer.suggestion && <span className="small">{answer.suggestion}</span>}
            </div>
          </div>
        )}

        {answer?.kind === "patch" && (
          <div className="stack">
            <div className="spread">
              <span className="pill amber">{answer.label}</span>
              {patchDeltas && <span className="small muted">{patchDeltas}</span>}
            </div>

            {answer.narration && <p style={{ margin: 0, fontSize: 13 }}>{answer.narration}</p>}

            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                className="tiny cta"
                onClick={() => {
                  scenario.pinBaseline();
                  setAnswer(null);
                }}
              >
                {en.ai.keepScenario}
              </button>
              <button
                type="button"
                className="tiny"
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
      </div>
    </section>
  );
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
