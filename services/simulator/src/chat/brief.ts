import { callGemini, type GeminiConfig } from "../gemini.js";
import type { LocationReportInput } from "../report/model.js";
import { buildFacts, type GapFacts } from "./facts.js";
import { checkNumbers } from "./guard.js";

/**
 * The Spotential AI briefing.
 *
 * WHY THIS EXISTS. The gap table is six rows of outlets, reviews per outlet
 * and a rating, and nothing on the page said what any of it meant. Worse, the
 * write-up that was supposed to explain it was skipped whenever
 * `topOpportunity` was null — which is exactly when every category is
 * saturated, so the hardest screen to read was the one guaranteed to get no
 * prose at all.
 *
 * STRUCTURED, NOT A PARAGRAPH. Four labelled fields, so the panel can be
 * designed and so each string can be guarded separately. A blob would have to
 * be accepted or rejected whole.
 *
 * GEMINI STILL NEVER DOES ARITHMETIC. Every figure the model may use is in the
 * fact sheet, which the engine built; `checkNumbers` rejects anything else. The
 * prompt asks for that too, but the prompt is not what makes it true — a
 * refused briefing falls back to the page's own derived summary, which costs
 * nothing and cannot fail.
 */

export interface Briefing {
  /** One sentence: what this location actually is. */
  headline: string;
  /** Two to four observations, each resting on a figure from the facts. */
  readings: string[];
  /** The binding constraint, named plainly. */
  watchOut: string;
  /** One concrete thing to do next. */
  nextStep: string;
}

export type BriefOutcome =
  | { kind: "brief"; briefing: Briefing }
  /** The model cited a figure nothing accounts for, so nothing is shown. */
  | { kind: "refused"; reason: string; unsupported: number[] };

const REFUSAL =
  "The analysis was withheld because it referred to a figure this page did not measure. " +
  "The summary above is computed directly from the data and still stands.";

const PROMPT = `You are Spotential AI, briefing a Malaysian small business owner on one specific location.

You will be given a FACT SHEET produced by a deterministic engine. Every figure in it was computed, not estimated by you.

ABSOLUTE RULES
- Use ONLY figures that appear in the fact sheet. Never calculate, total, average, compare, convert or estimate any number. If you want to say "twice as many", do not: say which two figures you mean and let the reader compare them.
- If something is not in the fact sheet, say it is not known. Never fill a silence.
- Never predict success or failure. The score is a comparison aid that has never been validated against real outcomes, and you must not imply otherwise.
- Write for an owner deciding where to spend their own money. Plain English, no jargon, no marketing tone.
- Do not use dashes as punctuation. Write separate sentences instead.

WHEN EVERY CATEGORY IS SATURATED
That is a real finding and your most useful answer. Say so directly, explain what it means for someone deciding here, and do not manufacture an opportunity to be encouraging.

THE HEADLINE IS A VERDICT, NOT A DESCRIPTION
Say what this place IS for this business, in one sentence an owner could repeat to a partner. Never describe the briefing itself, never restate the inputs, and never begin with "This briefing", "This analysis", "This location report" or similar.
Good: "A fully worked Korean food street where the question is whether to be here at all."
Bad: "This briefing evaluates a site in Kuala Lumpur for a proposed Korean restaurant within a 500m radius."

Reply with JSON only, no code fence, in exactly this shape:
{
  "headline": "the verdict, one sentence",
  "readings": ["two to four observations, each resting on a figure from the fact sheet"],
  "watchOut": "the single constraint that binds hardest here",
  "nextStep": "one concrete thing the owner should do next"
}`;

/**
 * Belt and braces on top of the response schema.
 *
 * The schema is what makes valid JSON the norm; this handles the residue —
 * a code fence, or a sentence of preamble before the object — by falling back
 * to the outermost brace pair rather than discarding an otherwise good reply.
 */
function parse(text: string): Briefing | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

  let raw: unknown;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      raw = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  if (typeof raw !== "object" || raw === null) return null;

  const value = raw as Record<string, unknown>;
  const str = (key: string) => (typeof value[key] === "string" ? (value[key] as string).trim() : "");

  const readings = Array.isArray(value["readings"])
    ? (value["readings"] as unknown[])
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .map((entry) => entry.trim())
        // Capped: a model that returns forty bullets would push the tab rail
        // off the screen, and the panel is a briefing rather than a report.
        .slice(0, 4)
    : [];

  const briefing: Briefing = {
    headline: str("headline"),
    readings,
    watchOut: str("watchOut"),
    nextStep: str("nextStep"),
  };

  // A briefing with no headline and no readings is not a briefing.
  if (briefing.headline.length === 0 || briefing.readings.length === 0) return null;
  return briefing;
}

export async function briefLocation(
  config: GeminiConfig,
  location: LocationReportInput,
  gaps: GapFacts | null,
): Promise<BriefOutcome> {
  const facts = buildFacts(location, gaps);

  const { text } = await callGemini(config, {
    systemInstruction: { parts: [{ text: PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [{ text: `FACT SHEET\n\n${facts}\n\nBrief me on this location.` }],
      },
    ],
    generationConfig: {
      // Low temperature: this is interpretation of fixed figures, not writing.
      temperature: 0.2,
      /**
       * HEADROOM FOR THINKING, which is charged against this same budget.
       *
       * Measured against the live model: a trivial prompt spent 372 to 798
       * tokens on thoughts to produce 80 to 93 tokens of answer. On a full
       * fact sheet that overran a 2,048 ceiling perhaps one time in three, and
       * the response came back truncated mid-object — which presents as
       * invalid JSON and therefore as "no briefing", with nothing in the reply
       * to say why. The briefing itself is a few hundred tokens; the rest of
       * this is room for the model to think in.
       */
      maxOutputTokens: 8192,
      /**
       * THE SHAPE IS ENFORCED, NOT REQUESTED.
       *
       * Asking for JSON in the prompt produced valid JSON about two times in
       * three; the rest came back fenced, wrapped in a sentence of preamble,
       * or truncated mid-object, and every one of those renders as "no
       * briefing" to a reader. Same lesson this codebase already recorded for
       * the simulator: a prompt is not a constraint, so give the constraint a
       * mechanism. `parse` below still guards the remainder.
       */
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          headline: { type: "STRING" },
          readings: { type: "ARRAY", items: { type: "STRING" } },
          watchOut: { type: "STRING" },
          nextStep: { type: "STRING" },
        },
        required: ["headline", "readings", "watchOut", "nextStep"],
      },
    },
  });

  const briefing = text ? parse(text) : null;
  if (!briefing) {
    return { kind: "refused", reason: REFUSAL, unsupported: [] };
  }

  /**
   * EVERY FIELD IS GUARDED, and one bad field refuses the whole briefing.
   *
   * Showing three good paragraphs and silently dropping a fourth would leave
   * the reader with no way to know something was withheld, and the dropped one
   * is exactly the one that invented a number.
   *
   * The question argument is empty on purpose: unlike a chat reply there is no
   * user utterance here, so the fact sheet is the only legitimate source.
   */
  const unsupported = new Set<number>();
  for (const field of [briefing.headline, briefing.watchOut, briefing.nextStep, ...briefing.readings]) {
    for (const value of checkNumbers(field, facts, "").unsupported) unsupported.add(value);
  }

  if (unsupported.size > 0) {
    return { kind: "refused", reason: REFUSAL, unsupported: [...unsupported] };
  }

  return { kind: "brief", briefing };
}
