import {
  MAX_OPERATIONS,
  PATCHABLE_FIELDS,
  type ScenarioInputs,
  type SimulationResult,
} from "@spotential/sim-engine";

/**
 * The Gemini function-calling loop — SPEC §8.
 *
 * Plain code against the REST API. No ADK, no Agent Engine: the loop is a
 * request, a tool call, and a second request. A framework would add
 * per-session billing and indirection for something this small.
 *
 * GEMINI NEVER DOES ARITHMETIC. It has exactly two jobs — turn a question into
 * a parameter patch, and narrate a diff it has been handed. Every number the
 * user reads came out of the deterministic engine, which is why the chat and
 * the panel can never disagree.
 */

/**
 * Pinned deliberately. `gemini-flash-latest` would let the model change under
 * a patch extractor whose behaviour we depend on; a silent upgrade that starts
 * interpreting "slower" differently is not something to discover in production.
 */
export const DEFAULT_MODEL = "gemini-3.6-flash";

const AI_STUDIO_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * How to reach Gemini.
 *
 * Two transports, chosen explicitly rather than by fallback: Vertex with the
 * Cloud Run service identity in production, an AI Studio key for local
 * development where there is no metadata server. It does NOT silently fall
 * back from one to the other — a silent downgrade is exactly how the Firestore
 * cache quietly stopped working.
 */
export interface GeminiTransport {
  /** For logs and the health endpoint, so the live path is never a guess. */
  readonly name: "vertex" | "ai-studio";
  readonly model: string;
  /**
   * @param model overrides the default for this one call — the Opportunity Gap
   * write-up uses Pro while everything else stays on Flash. It is a parameter
   * rather than a spread-and-override because the URL is built inside the
   * closure, so replacing the `model` field alone would silently keep calling
   * the original model.
   */
  request(model?: string): Promise<{ url: string; headers: Record<string, string> }>;
}

export interface GeminiConfig {
  transport: GeminiTransport;
  timeoutMs?: number;
}

export function aiStudioTransport(apiKey: string, model = DEFAULT_MODEL): GeminiTransport {
  return {
    name: "ai-studio",
    model,
    async request(override?: string) {
      return {
        url: `${AI_STUDIO_ENDPOINT}/${override ?? model}:generateContent`,
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      };
    },
  };
}

export type AskOutcome =
  | { kind: "patch"; label: string; rationale: string; operations: unknown }
  | { kind: "clarification"; question: string }
  | { kind: "declined"; reason: string; suggestion: string };

interface FunctionCall {
  name: string;
  args: Record<string, unknown>;
}

/** SPEC §8.2. `operations` is an array from the very first version — retrofitting
 *  compound patches would mean rewriting the schema and every prompt. */
const TOOLS = [
  {
    functionDeclarations: [
      {
        name: "apply_scenario",
        description:
          "Change one or more scenario parameters to answer a what-if question. Use this whenever the question can be expressed as adjusting the numbers.",
        parameters: {
          type: "OBJECT",
          properties: {
            label: {
              type: "STRING",
              description: 'Short name for the scenario, e.g. "Demand -20%".',
            },
            rationale: {
              type: "STRING",
              description: "One sentence on how the question maps to these changes.",
            },
            operations: {
              type: "ARRAY",
              description: `Between 1 and ${MAX_OPERATIONS} changes, applied together.`,
              items: {
                type: "OBJECT",
                properties: {
                  field: { type: "STRING", enum: [...PATCHABLE_FIELDS] },
                  op: {
                    type: "STRING",
                    enum: ["set", "mul", "add", "pct_delta"],
                    description:
                      "set = absolute value; mul = multiply (0.8 for -20%); add = add/subtract; pct_delta = percent change (-20 for -20%).",
                  },
                  value: { type: "NUMBER" },
                },
                required: ["field", "op", "value"],
              },
            },
          },
          required: ["label", "rationale", "operations"],
        },
      },
      {
        name: "request_clarification",
        description:
          "Ask ONE short question when the request is genuinely ambiguous about which parameter or how much. Use at most once per conversation.",
        parameters: {
          type: "OBJECT",
          properties: { question: { type: "STRING" } },
          required: ["question"],
        },
      },
      {
        name: "decline_out_of_scope",
        description:
          "Use when the question cannot be answered by changing scenario parameters: for example choosing a different city, judging whether the business is a good idea, or anything needing data this simulator does not hold.",
        parameters: {
          type: "OBJECT",
          properties: {
            reason: { type: "STRING", description: "Plainly, what you cannot do." },
            suggestion: { type: "STRING", description: "The nearest thing you can do." },
          },
          required: ["reason", "suggestion"],
        },
      },
    ],
  },
];

const SYSTEM_PROMPT = `You translate what-if questions about a Malaysian F&B business into scenario parameter changes.

Rules, without exception:
- You NEVER calculate. You do not state or estimate revenue, profit, break-even or any other figure. A deterministic engine computes every number; you only choose which parameters to move.
- Always answer by calling exactly one tool.
- "Demand drops 20%" means customersPerDay with op "mul" and value 0.8.
- A question naming two changes produces two operations in one call.
- Currency is Malaysian Ringgit. cogsPct, serviceChargePct and dineInSharePct are FRACTIONS (0.32 means 32%).
- Raising avgPricePerTransaction does not change the cost of goods per unit; the engine holds that constant.
- If the question is not about changing these parameters, call decline_out_of_scope rather than inventing a patch.
- Ask for clarification at most once. If you have already asked, commit to your best reading.`;

function narrationPrompt(
  question: string,
  label: string,
  before: SimulationResult,
  after: SimulationResult,
): string {
  const summarise = (r: SimulationResult) =>
    JSON.stringify({
      monthlyRevenue: r.steady.revenue,
      monthlyProfit: r.steady.profit,
      fixedMonthlyCosts: r.steady.fixedMonthlyCosts,
      paybackMonth: r.breakEven.paybackMonth,
      paybackBand: [r.breakEven.paybackBandLow, r.breakEven.paybackBandHigh],
      cashBreakEvenMonth: r.breakEven.cashBreakEvenMonth,
      peakCashRequirement: r.cash.peakCashRequirement,
      operatingTransactionsPerDay: r.breakEven.operatingTransactionsPerDay,
    });

  return `The user asked: "${question}"
Scenario applied: ${label}

BEFORE: ${summarise(before)}
AFTER:  ${summarise(after)}

Write two or three sentences explaining what changed and why it matters to a small business owner.

You MUST only use figures that appear above. Do not compute anything new, do not estimate, and do not introduce any number that is not in the BEFORE or AFTER data. Amounts are Malaysian Ringgit; write them as RM with thousands separators. If payback is null, say the scenario does not break even within two years. Be direct and concrete. No preamble, no bullet points.`;
}

/** Shared with the location chatbot, so there is one place that scrubs credentials. */
export async function callGemini(
  config: GeminiConfig,
  body: unknown,
  modelOverride?: string,
): Promise<{ functionCall?: FunctionCall; text?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 20_000);

  try {
    const { url, headers } = await config.transport.request(modelOverride);
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      // Scrub any credential the upstream error body might echo back, so a
      // token or key can never reach the logs.
      const secret = headers["x-goog-api-key"] ?? headers["Authorization"] ?? "";
      const safe = secret ? detail.replaceAll(secret, "[REDACTED]") : detail;
      throw new Error(`Gemini responded ${response.status}: ${safe.slice(0, 200)}`);
    }

    const json = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string; functionCall?: FunctionCall }[] } }[];
    };
    const parts = json.candidates?.[0]?.content?.parts ?? [];

    const call = parts.find((p) => p.functionCall)?.functionCall;
    const text = parts
      .map((p) => p.text)
      .filter(Boolean)
      .join("")
      .trim();

    return { ...(call ? { functionCall: call } : {}), ...(text ? { text } : {}) };
  } finally {
    clearTimeout(timer);
  }
}

/** Step 1: question in, tool call out. No numbers are produced here. */
export async function extractPatch(
  config: GeminiConfig,
  question: string,
  inputs: ScenarioInputs,
  alreadyClarified: boolean,
): Promise<AskOutcome> {
  const { functionCall } = await callGemini(config, {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Current scenario (JSON):\n${JSON.stringify(inputs)}\n\n${
              alreadyClarified ? "You have already asked for clarification once. Commit to your best reading.\n\n" : ""
            }Question: ${question}`,
          },
        ],
      },
    ],
    tools: TOOLS,
    toolConfig: { functionCallingConfig: { mode: "ANY" } },
    generationConfig: { temperature: 0 },
  });

  if (!functionCall) {
    return {
      kind: "declined",
      reason: "I could not turn that into a change to your figures.",
      suggestion: 'Try naming a number to change, for example "what if rent goes up 10%?"',
    };
  }

  const args = functionCall.args ?? {};
  switch (functionCall.name) {
    case "apply_scenario":
      return {
        kind: "patch",
        label: typeof args["label"] === "string" ? args["label"] : "Scenario",
        rationale: typeof args["rationale"] === "string" ? args["rationale"] : "",
        operations: args["operations"],
      };
    case "request_clarification":
      return {
        kind: "clarification",
        question:
          typeof args["question"] === "string" ? args["question"] : "Which figure should change?",
      };
    case "decline_out_of_scope":
      return {
        kind: "declined",
        reason:
          typeof args["reason"] === "string"
            ? args["reason"]
            : "That is outside what this simulator can answer.",
        suggestion: typeof args["suggestion"] === "string" ? args["suggestion"] : "",
      };
    default:
      return {
        kind: "declined",
        reason: "I could not turn that into a change to your figures.",
        suggestion: "Try naming a figure to change.",
      };
  }
}

/**
 * The Opportunity Gap write-up.
 *
 * The one place the tech stack calls for Pro rather than Flash: this is
 * genuine synthesis — naming a concept from a ranked table — rather than the
 * structured extraction Flash handles elsewhere.
 *
 * Same contract as every other Gemini call here: it receives an ALREADY
 * COMPUTED table and generates no numbers of its own. The ranking on screen
 * and the prose beneath it cannot disagree, because only one of them does
 * arithmetic.
 */
/**
 * NOT gemini-2.5-pro. It still appears in the models list but returns 404 with
 * "no longer available to new users" — listing a model is not the same as
 * being able to call it, so probe before pinning.
 *
 * Preview rather than a `-latest` alias: the floating alias would change the
 * model under us. If this preview is eventually retired the call 404s, the
 * catch below returns an empty string, and the ranked table still renders —
 * the write-up is a bonus, never the product.
 */
/**
 * Step 2: narrate a diff that has already been computed.
 *
 * Narration failing is not worth failing the request over — the user still has
 * correct numbers on screen, which is the part that matters.
 */
export async function narrate(
  config: GeminiConfig,
  question: string,
  label: string,
  before: SimulationResult,
  after: SimulationResult,
): Promise<string> {
  try {
    const { text } = await callGemini(config, {
      contents: [{ role: "user", parts: [{ text: narrationPrompt(question, label, before, after) }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
    });
    return text ?? "";
  } catch {
    return "";
  }
}
