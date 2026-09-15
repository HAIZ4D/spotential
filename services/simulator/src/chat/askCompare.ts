import { callGemini, type GeminiConfig } from "../gemini.js";
import { checkNumbers } from "./guard.js";
import { MAX_HISTORY_TURNS, type ChatTurn } from "./ask.js";

/**
 * Free-form questions about a comparison.
 *
 * The sibling of `askAboutLocation`, with one deliberate difference: THERE IS
 * NO `adjust_view` TOOL.
 *
 * On `/analysis` the assistant can move the category and radius controls, and
 * the page's own cached fetch then runs. Here those controls apply to every
 * site at once, so one sentence could spend a paid Places call per location on
 * a three-way comparison, against a MYR 45 monthly budget. The owner chose
 * answer-only, and removing the tool is what makes that structural rather than
 * a request in a prompt — the same reasoning that makes "Gemini never does
 * arithmetic" true in the simulator, where the model emits a patch and never a
 * figure.
 *
 * So a question about a different radius gets an explanation of where the
 * control is, which the model can give without seeing any new figure.
 */

export type CompareAskOutcome =
  | { kind: "answer"; text: string }
  | { kind: "declined"; reason: string; suggestion: string }
  | { kind: "refused"; reason: string };

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: "decline_out_of_scope",
        description:
          "Use when the facts cannot answer the question: anything about other locations, seasonality, footfall counts, lease terms, or whether a business will succeed.",
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

const SYSTEM_PROMPT = `You answer questions about a comparison between Malaysian retail locations, using ONLY the facts supplied below.

Rules, without exception:
- You NEVER calculate. Do not add, subtract, average, convert, project or estimate. Every number you write must appear verbatim in the FACTS or in the user's question. If answering would need a number that is not there, say you cannot rather than working it out.
- Never state a figure for a location, business type or radius that is not in the FACTS.
- Distinguish measured from inferred. Say which when it matters, especially for rent.
- A dimension marked NOT SCORED means no data exists. It is not zero and it is not bad. Say it is unknown and nothing more.
- A capped competitor count is a floor. Never present it as a total, and never say an unsearched distance band is empty.
- Never describe a district population as a catchment or a customer count.
- These scores are a comparison aid, not a forecast, and have not been validated against real outcomes. Do not tell the user which site to take; describe what the evidence supports and let them decide.
- You CANNOT change the business type or the radius. If the question asks about a different one, say plainly that you cannot re-run the comparison, point to the controls at the top of the page, and say what the change would likely do in direction terms only, without any figure.
- If the facts do not cover it, call decline_out_of_scope.
- Be brief: two or three sentences. Plain English, no bullet lists, no markdown.`;

const REFUSAL =
  "I could not answer that without working out a figure myself, and every number here has to " +
  "come from the panels on this page. Try asking about something shown above.";

/** Said apart from the guard refusal: these need opposite fixes. */
const TRUNCATED =
  "That answer ran past its limit and stopped mid-thought, so it is not being shown rather " +
  "than shown half-finished. Ask something narrower and it will fit.";

export async function askAboutComparison(
  config: GeminiConfig,
  question: string,
  facts: string,
  history: ChatTurn[] = [],
): Promise<CompareAskOutcome> {
  const contents = [
    ...history.slice(-MAX_HISTORY_TURNS).map((turn) => ({
      role: turn.role,
      parts: [{ text: turn.text }],
    })),
    {
      role: "user",
      parts: [
        {
          // The labels are user-controlled and length-capped upstream. They
          // sit inside the FACTS block as data, and the only callable thing
          // here is a two-string decline, so a jailbroken reply reaches
          // nothing.
          text: `${SYSTEM_PROMPT}\n\nFACTS\n=====\n${facts}\n=====\n\nQUESTION: ${question}`,
        },
      ],
    },
  ];

  const { functionCall, text, finishReason } = await callGemini(config, {
    contents,
    tools: TOOLS,
    generationConfig: {
      temperature: 0.2,
      /**
       * HEADROOM TO THINK IN, not a longer answer. 2,048 was copied from the
       * single-location assistant and is wrong here: a comparison fact sheet
       * carries two or three full location sheets plus the comparison layer,
       * so the model thinks far longer before writing, and thinking tokens are
       * charged against this same ceiling.
       *
       * Caught on the deployed model, never against a stub: the reply came
       * back at 329 characters ending "The evidence shows Suburban", with no
       * full stop and every figure in it real, so the guard passed it happily.
       */
      maxOutputTokens: 8192,
    },
  });

  if (functionCall?.name === "decline_out_of_scope") {
    const args = functionCall.args as { reason?: unknown; suggestion?: unknown };
    return {
      kind: "declined",
      reason:
        typeof args.reason === "string" ? args.reason : "That is outside what this data covers.",
      suggestion: typeof args.suggestion === "string" ? args.suggestion : "",
    };
  }

  const answer = (text ?? "").trim();
  if (!answer) return { kind: "refused", reason: REFUSAL };

  /**
   * A CUT-OFF ANSWER IS WITHHELD, not shown.
   *
   * The ceiling above should make this rare, but "rare" is not "never" and the
   * failure is nasty: prose that stops mid-sentence looks like a complete
   * thought that trails off, and the numeric guard waves it through because
   * every figure in it is genuine. A reader cannot tell they were handed half
   * an answer. `finishReason` is the only thing that knows.
   */
  if (finishReason === "MAX_TOKENS") {
    return { kind: "refused", reason: TRUNCATED };
  }

  /**
   * The mechanism behind "Gemini never does arithmetic".
   *
   * A prose answer has no shape to enforce the rule, so every number in it is
   * checked against the facts and the user's own question. Anything else means
   * the model computed something, and a refusal is a bad answer where an
   * invented figure presented as a measurement is a wrong one.
   */
  if (!checkNumbers(answer, facts, question).ok) {
    return { kind: "refused", reason: REFUSAL };
  }

  return { kind: "answer", text: answer };
}
