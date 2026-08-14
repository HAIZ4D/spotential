import { CATEGORY_PRESETS, RADIUS_BUCKETS, type BusinessCategory } from "@spotential/sim-engine";
import type { GeminiConfig } from "../gemini.js";
import { callGemini } from "../gemini.js";
import { buildFacts } from "./facts.js";
import { checkNumbers } from "./guard.js";
import type { LocationReportInput } from "../report/model.js";

/**
 * The location chatbot — Feature 3.
 *
 * Grounded on a fact sheet rather than retrieval tools: the data is already
 * fetched and sitting in the page, the whole sheet is a couple of kilobytes,
 * and there is nothing to go and get. Tool calling is kept for the one thing
 * that is genuinely an ACTION — moving the category or radius control — which
 * follows the simulator's pattern exactly: the model proposes, deterministic
 * code executes.
 *
 * The chatbot cannot call Places. Changing the view is a control on the page,
 * and the page's existing cached fetch runs it.
 */

export type ChatTurn = { role: "user" | "model"; text: string };

export type ChatOutcome =
  | { kind: "answer"; text: string }
  | { kind: "adjust"; category: BusinessCategory | null; radiusMetres: number | null; why: string }
  | { kind: "declined"; reason: string; suggestion: string }
  | { kind: "refused"; reason: string };

/** Enough for context without letting one session grow unboundedly expensive. */
export const MAX_HISTORY_TURNS = 8;

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: "adjust_view",
        description:
          "Change the business type or the search radius being analysed, when the question asks about a different one. The page re-runs its own analysis; you must not state any figure for the new view because you have not seen it.",
        parameters: {
          type: "OBJECT",
          properties: {
            category: {
              type: "STRING",
              enum: Object.keys(CATEGORY_PRESETS),
              description: "Omit to leave the business type unchanged.",
            },
            radiusMetres: {
              type: "NUMBER",
              enum: RADIUS_BUCKETS.map(String),
              description: "Omit to leave the radius unchanged.",
            },
            why: { type: "STRING", description: "One short sentence on what you are changing." },
          },
          required: ["why"],
        },
      },
      {
        name: "decline_out_of_scope",
        description:
          "Use when the facts cannot answer the question — anything about other locations, seasonality, footfall counts, lease terms, or whether the business will succeed.",
        parameters: {
          type: "OBJECT",
          properties: {
            reason: { type: "STRING", description: "Plainly, what the data does not cover." },
            suggestion: { type: "STRING", description: "The nearest thing the data can answer." },
          },
          required: ["reason", "suggestion"],
        },
      },
    ],
  },
];

const SYSTEM_PROMPT = `You answer questions about one Malaysian retail location, using ONLY the facts supplied below.

Rules, without exception:
- You NEVER calculate. Do not add, subtract, average, convert, project or estimate. Every number you write must appear verbatim in the FACTS or in the user's question. If answering would need a number that is not there, say you cannot rather than working it out.
- Never state a figure for a location, business type or radius other than the one in the FACTS.
- Distinguish measured from inferred. Say which when it matters, especially for rent and demand.
- Never describe the district population as a catchment or a customer count.
- A capped competitor count is a floor. Never present it as a total, and never say an unsearched distance band is empty.
- The score is a comparison aid, not a forecast, and it has not been validated. Do not tell the user whether to open here; describe what the data shows and let them decide.
- If the question is about a different business type or radius, call adjust_view instead of answering.
- If the facts do not cover it, call decline_out_of_scope.
- Be brief: two or three sentences. Plain English, no bullet lists, no markdown.`;

/** Both a real refusal and the message the user sees. */
const REFUSAL =
  "I could not answer that without working out a figure myself, and every number here has to " +
  "come from the panels on this page. Try asking about something shown above.";

export async function askAboutLocation(
  config: GeminiConfig,
  question: string,
  location: LocationReportInput,
  history: ChatTurn[] = [],
): Promise<ChatOutcome> {
  const facts = buildFacts(location);

  const contents = [
    ...history.slice(-MAX_HISTORY_TURNS).map((turn) => ({
      role: turn.role,
      parts: [{ text: turn.text }],
    })),
    {
      role: "user",
      parts: [
        {
          // The label is user-controlled and already length-capped upstream.
          // It sits inside the FACTS block as data; the only executable output
          // is a two-field adjust_view, so a jailbroken model still cannot
          // reach anything.
          text: `${SYSTEM_PROMPT}\n\nFACTS\n=====\n${facts}\n=====\n\nQUESTION: ${question}`,
        },
      ],
    },
  ];

  const { functionCall, text } = await callGemini(config, {
    contents,
    tools: TOOLS,
    generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
  });

  if (functionCall?.name === "decline_out_of_scope") {
    const args = functionCall.args as { reason?: unknown; suggestion?: unknown };
    return {
      kind: "declined",
      reason: typeof args.reason === "string" ? args.reason : "That is outside what this data covers.",
      suggestion: typeof args.suggestion === "string" ? args.suggestion : "",
    };
  }

  if (functionCall?.name === "adjust_view") {
    const args = functionCall.args as {
      category?: unknown;
      radiusMetres?: unknown;
      why?: unknown;
    };

    // Validated here, not trusted. A model naming an unknown category must not
    // reach the page and blank the analysis.
    const category =
      typeof args.category === "string" && args.category in CATEGORY_PRESETS
        ? (args.category as BusinessCategory)
        : null;

    const radius = Number(args.radiusMetres);
    const radiusMetres = (RADIUS_BUCKETS as readonly number[]).includes(radius) ? radius : null;

    if (category === null && radiusMetres === null) {
      return {
        kind: "declined",
        reason: "I could not tell which business type or radius you meant.",
        suggestion: "Name one of the business types or a radius of 250m, 500m, 1km or 2km.",
      };
    }

    return {
      kind: "adjust",
      category,
      radiusMetres,
      why: typeof args.why === "string" ? args.why : "Changing the view.",
    };
  }

  const answer = (text ?? "").trim();
  if (!answer) {
    return { kind: "refused", reason: REFUSAL };
  }

  // The guard. Everything above is a prompt asking nicely; this is the part
  // that actually holds.
  const check = checkNumbers(answer, facts, question);
  if (!check.ok) {
    return { kind: "refused", reason: REFUSAL };
  }

  return { kind: "answer", text: answer };
}
