import { callGemini, type GeminiConfig } from "../gemini.js";
import { checkNumbers } from "./guard.js";

/**
 * Specialists, and the reason they are several calls rather than one.
 *
 * NOT AN AGENT FRAMEWORK. This is plain code calling the Gemini API directly,
 * which is a non-negotiable in this project: no ADK, no Agent Engine, no
 * orchestration layer. "Agent" here means a prompt with one job, its own
 * output schema and its own pass through the numeric guard.
 *
 * ONE RUNNER, TWO ROSTERS. The comparison panel runs three specialists on a
 * comparison; the location panel runs four on a single site. The machinery is
 * identical and only the jobs differ, so the roster is an argument. Anything
 * shared between the two pages lives here; the jobs themselves live beside the
 * fact sheet they read.
 *
 * WHY NOT ONE CALL RETURNING EVERY SECTION. Two reasons, and the second is the
 * load-bearing one:
 *
 *   1. A single model asked to argue a case and doubt it in one breath hedges,
 *      and produces blander output on both halves.
 *   2. ONE BAD FIGURE USED TO LOSE EVERYTHING. The old single briefing refused
 *      whole when any field cited an unsupported number, which is the right
 *      call for one object: showing three good paragraphs and silently
 *      dropping a fourth leaves a reader unable to tell something was
 *      withheld. Split up, a refusal is CONTAINED. One specialist can be
 *      withheld and named as withheld while the others still render.
 *
 * THEY RUN IN PARALLEL, so the wait is one call's latency rather than four.
 * Measured on the single location briefing this replaced: 10 to 13s uncached.
 *
 * NONE OF THEM WRITES THE HEADLINE. Both pages compute their own lead sentence
 * from the score object and print it above this panel. A model sentence saying
 * the same thing with less authority is worse than nothing, and a model asked
 * for a headline has already been caught describing the document rather than
 * the place. Each roster's shared rules say so out loud.
 */

/** One specialist: what it is for, and what it is told to do. */
export interface AgentJob {
  /** Shown to the reader. Also what a withheld card is named by. */
  role: string;
  /** The job, appended to the roster's shared rules. */
  brief: string;
}

export interface AgentRoster<Id extends string> {
  /** Run order, which is also render order. */
  ids: Id[];
  jobs: Record<Id, AgentJob>;
  /** Rules every agent in this roster gets. */
  common: string;
  /**
   * Whether each specialist is asked for ONE ACTION alongside its reading.
   *
   * The comparison roster says no: its Advisor is entirely actions, so asking
   * the other two for one as well would produce three competing next steps.
   * The location roster says yes, because there each specialist owns a
   * different subject and the action belongs with the evidence for it.
   */
  wantsMove: boolean;
}

export interface AgentReading<Id extends string = string> {
  id: Id;
  /** What this specialist is for, shown to the reader. */
  role: string;
  /** One sentence. The finding, not a preamble. */
  headline: string;
  /** Two to four points, each resting on a figure from the facts. */
  points: string[];
  /** One thing to do about it. Present only on rosters that ask for it. */
  move?: string;
}

export type AgentOutcome<Id extends string = string> =
  | { kind: "reading"; reading: AgentReading<Id> }
  /** The model cited a figure nothing accounts for, so nothing is shown. */
  | { kind: "refused"; id: Id; role: string; unsupported: number[] }
  /** The call itself failed. Distinct from a refusal: opposite fixes. */
  | { kind: "failed"; id: Id; role: string };

/**
 * Rules every roster inherits, before its own.
 *
 * The numeric rule is repeated to the model even though `checkNumbers` is what
 * actually enforces it. A prompt is not a constraint, but a prompt plus a
 * mechanism refuses less often than a mechanism alone.
 */
export const BASE_RULES = `RULES, all of them absolute:
- NEVER calculate. Every number you write must already appear in the fact sheet, exactly as written there. Do not add, subtract, average, convert or estimate. If a figure you want is not in the sheet, describe the situation in words instead.
- If something is not in the fact sheet, say it is not known. Never fill a silence.
- These scores are a comparison aid and have never been validated against real business outcomes. Never predict success or failure.
- A dimension marked "no data" means no data exists. It does not mean zero and it does not mean bad. You may say it is unknown and nothing more.
- Write for somebody about to spend their own money. Plain English, no markdown, no bullet characters, no jargon.
- Do not use dashes as punctuation. Write separate sentences instead.
- Be concise. A headline of one sentence and two to four short points.`;

function schemaFor(wantsMove: boolean) {
  return {
    type: "OBJECT",
    properties: {
      headline: { type: "STRING" },
      points: { type: "ARRAY", items: { type: "STRING" } },
      ...(wantsMove ? { move: { type: "STRING" } } : {}),
    },
    required: wantsMove ? ["headline", "points", "move"] : ["headline", "points"],
  } as const;
}

/** Tolerant of the residue the schema does not catch: fences, preamble. */
function parse(text: string): { headline: string; points: string[]; move?: string } | null {
  const body = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  try {
    const raw = JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
    const headline = typeof raw["headline"] === "string" ? raw["headline"].trim() : "";
    const points = Array.isArray(raw["points"])
      ? raw["points"].filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      : [];
    const move = typeof raw["move"] === "string" ? raw["move"].trim() : "";
    if (!headline || points.length === 0) return null;
    return { headline, points: points.slice(0, 4), ...(move ? { move } : {}) };
  } catch {
    return null;
  }
}

async function runAgent<Id extends string>(
  config: GeminiConfig,
  roster: AgentRoster<Id>,
  id: Id,
  facts: string,
): Promise<AgentOutcome<Id>> {
  const { role, brief } = roster.jobs[id];

  const { text } = await callGemini(config, {
    systemInstruction: { parts: [{ text: `${roster.common}\n\n${BASE_RULES}\n\n${brief}` }] },
    contents: [
      {
        role: "user",
        // The labels inside the sheet are user-supplied and length-capped
        // upstream. They sit here as DATA: this call offers no tools at all,
        // so there is nothing a jailbroken reply could reach.
        parts: [{ text: `FACT SHEET\n\n${facts}\n\nDo your job on this.` }],
      },
    ],
    generationConfig: {
      // Interpretation of fixed figures, not writing. Low and deliberate.
      temperature: 0.2,
      /**
       * Headroom to THINK in, not a longer answer. Thinking tokens are charged
       * against this same ceiling: measured on the live model, a trivial
       * prompt spent 372 to 798 tokens on thoughts for 80 to 93 tokens of
       * answer, and a 2,048 ceiling truncated a full-sheet reply about one
       * time in three. A truncation presents as invalid JSON and therefore as
       * "no reading", with nothing in the response to say why.
       */
      maxOutputTokens: 8192,
      // The shape is enforced, not requested. Asking politely produced valid
      // JSON about two times in three.
      responseMimeType: "application/json",
      responseSchema: schemaFor(roster.wantsMove),
    },
  });

  const parsed = text ? parse(text) : null;
  if (!parsed) return { kind: "failed", id, role };

  /**
   * Guarded field by field, and one bad field refuses THIS agent only.
   *
   * The question argument is empty on purpose: there is no user utterance
   * here, so the fact sheet is the only legitimate source of a figure.
   */
  const unsupported = new Set<number>();
  for (const field of [parsed.headline, ...parsed.points, parsed.move ?? ""]) {
    for (const value of checkNumbers(field, facts, "").unsupported) unsupported.add(value);
  }
  if (unsupported.size > 0) {
    return { kind: "refused", id, role, unsupported: [...unsupported] };
  }

  return { kind: "reading", reading: { id, role, ...parsed } };
}

/**
 * The whole roster, in parallel, and NONE of them can take the others down.
 *
 * `allSettled` rather than `all`: a rejected call is one specialist missing,
 * not a failed panel. A thrown error becomes that agent's own `failed`
 * outcome, which the UI names, so a reader is told which view is absent rather
 * than being shown a shorter panel that looks complete.
 */
export async function runAgents<Id extends string>(
  config: GeminiConfig,
  facts: string,
  roster: AgentRoster<Id>,
): Promise<AgentOutcome<Id>[]> {
  const settled = await Promise.allSettled(
    roster.ids.map((id) => runAgent(config, roster, id, facts)),
  );

  return settled.map((result, index) => {
    const id = roster.ids[index]!;
    if (result.status === "fulfilled") return result.value;
    return { kind: "failed", id, role: roster.jobs[id].role };
  });
}

/* ------------------------------------------------------------------ *
 * The comparison roster                                               *
 * ------------------------------------------------------------------ */

export type AgentId = "analyst" | "skeptic" | "advisor";

const COMPARE_COMMON = `You are part of Spotential AI, advising a Malaysian small business owner who is comparing shopfront locations.

The page already states which site scores highest and by how much. Do NOT repeat that verdict back. Say something the page has not already said. Never call one site "better" as a matter of fact; say what the evidence supports.`;

const COMPARE_JOBS: Record<AgentId, AgentJob> = {
  analyst: {
    role: "Analyst",
    brief: `YOUR JOB: say what the differences MEAN in trading terms.

Translate the gaps into what an owner would actually experience. A competition gap is not "13.6 points", it is how many rivals sit how close. A catchment gap is how many people live within walking distance. Pick the one or two dimensions that carry the verdict and explain what trading at each site would feel like.

Good: "Twenty rivals sit within 142m of the first site against 263m at the second, so the same lunch crowd is split more ways."
Bad: "Central KL scores 63 and Suburban PJ scores 60." That is the table, and it is already on screen.`,
  },
  skeptic: {
    role: "Skeptic",
    brief: `YOUR JOB: say what would change this answer.

You are the counter-case. Name what is NOT measured, what is inferred rather than measured, and how much weight the surviving dimensions are carrying. If dimensions went unscored, say how many and what that does to the confidence of the verdict. If rent is inferred from a benchmark rather than a real quote, say so and say what would settle it.

Be specific and unwelcome rather than reassuring. If the comparison is thin, say it is thin.

Good: "Three of five dimensions could not be scored on either site, so this verdict rests on two."
Bad: "Overall this is a reasonable comparison." That tells nobody anything.`,
  },
  advisor: {
    role: "Advisor",
    brief: `YOUR JOB: say what to do next.

Actions, not observations. Each point should be something the owner could do this week, tied to a specific site by name. Getting a rent quote, visiting at trading hours, asking a landlord what the service charge includes, walking the distance to the nearest rival.

Prefer the action that would most change the picture: usually the one that fills an unscored dimension or replaces an inferred figure with a real one.

Good: "Get a written rent quote for Suburban PJ. Rent is the one axis here still running on a benchmark."
Bad: "Consider your options carefully." That is not an action.`,
  },
};

export const AGENT_IDS: AgentId[] = ["analyst", "skeptic", "advisor"];

export const COMPARE_ROSTER: AgentRoster<AgentId> = {
  ids: AGENT_IDS,
  jobs: COMPARE_JOBS,
  common: COMPARE_COMMON,
  // The Advisor is entirely actions. Asking the other two for one as well
  // would leave the panel with three competing next steps.
  wantsMove: false,
};
