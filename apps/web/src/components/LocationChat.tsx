import { useRef, useState } from "react";
import type { BusinessCategory } from "@spotential/sim-engine";
import {
  postLocationAsk,
  type ChatTurn,
  type ReportLocation,
} from "../lib/api.js";

/**
 * Ask about this location — Feature 3.
 *
 * The model never calculates. It is handed a fact sheet built by the same
 * engine the panels use, and a guard on the server refuses any answer citing a
 * number that is not in it. So the chat and the panels cannot disagree — and
 * when the guard fires the user gets a refusal rather than a plausible
 * invented figure.
 *
 * Everything on this page keeps working if the assistant is down. That is
 * stated in the failure message, because the figures beside it are still
 * correct and still usable.
 */

/** Openers that map onto what the data actually holds. */
const SUGGESTIONS = [
  "Why did it score this?",
  "How crowded is it here?",
  "Is the rent reasonable?",
  "What is the weakest dimension?",
];

/** Kept short: history is what makes a request expensive, and the server caps it too. */
const MAX_TURNS = 8;

export function LocationChat({
  category,
  radiusMetres,
  location,
  ready,
  onAdjust,
}: {
  category: BusinessCategory;
  radiusMetres: number;
  location: () => ReportLocation;
  ready: boolean;
  onAdjust: (change: { category: BusinessCategory | null; radiusMetres: number | null }) => void;
}) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const ask = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || pending || !ready) return;

    setPending(true);
    setError(null);
    setQuestion("");

    const asked: ChatTurn = { role: "user", text: trimmed };
    const history = turns.slice(-MAX_TURNS);
    setTurns((current) => [...current, asked]);

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
        reply = `${response.why} The panels are updating — ask again once they have.`;
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
          : "Could not reach the assistant. Your figures are unaffected.",
      );
    } finally {
      setPending(false);
      requestAnimationFrame(() =>
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight }),
      );
    }
  };

  return (
    <section className="card no-print">
      <header>
        <h2>Ask about this location</h2>
        {turns.length > 0 && (
          <button type="button" className="tiny" onClick={() => setTurns([])}>
            Clear
          </button>
        )}
      </header>

      <div className="body stack">
        {turns.length === 0 && (
          <div className="notice info">
            <span>
              Answers can only cite figures shown on this page. The assistant does not calculate —
              if a question needs a number nobody measured, it says so rather than estimating.
            </span>
          </div>
        )}

        {turns.length > 0 && (
          <div className="chat-log" ref={listRef}>
            {turns.map((turn, index) => (
              <div key={index} className={`chat-turn ${turn.role}`}>
                <span className="tiny muted">{turn.role === "user" ? "You" : "Spotential"}</span>
                <p>{turn.text}</p>
              </div>
            ))}
            {pending && <div className="small muted">Working it out…</div>}
          </div>
        )}

        {error && (
          <div className="notice danger">
            <span>{error}</span>
          </div>
        )}

        <form
          className="chat-form"
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
            placeholder={ready ? "Ask about this spot…" : "Waiting for the analysis…"}
            aria-label="Ask about this location"
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button type="submit" className="tiny cta" disabled={!ready || pending || !question.trim()}>
            Ask
          </button>
        </form>

        {turns.length === 0 && ready && (
          <div className="chat-suggestions">
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
      </div>
    </section>
  );
}
