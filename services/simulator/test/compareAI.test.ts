import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { buildComparisonFacts, modelComparison } from "../src/chat/compareFacts.js";
import { runAgents, AGENT_IDS, COMPARE_ROSTER } from "../src/chat/agents.js";
import { askAboutComparison } from "../src/chat/askCompare.js";
import { InMemoryReadingsStore, readingsKey } from "../src/chat/store.js";
import type { GeminiTransport } from "../src/gemini.js";
import type { LocationReportInput } from "../src/report/model.js";

/**
 * The comparison assistant: three specialists on one grounded fact sheet.
 *
 * What is worth pinning here is not the prose. It is the four properties that
 * make a generating surface safe to put next to real figures:
 *
 *   1. EVERY NUMBER COMES FROM THE FACTS. The guard is the mechanism behind
 *      "Gemini never does arithmetic" in prose, where there is no patch shape
 *      to enforce it.
 *   2. ONE BAD AGENT DOES NOT TAKE THE OTHERS DOWN. That is the whole reason
 *      for three calls rather than one object.
 *   3. THE ASSISTANT CANNOT MOVE THE CONTROLS. Offering no tool is the
 *      structural form of that, rather than a sentence in a prompt.
 *   4. CACHE BEFORE QUOTA, and refusals are never cached.
 */

const base = (label: string, lat: number, lng: number): LocationReportInput => ({
  point: { lat, lng },
  label,
  category: "korean_restaurant",
  radiusMetres: 500,
  competitors: {
    total: 20,
    averageRating: 4.3,
    ratedCount: 18,
    totalReviews: 5600,
    nearestMetres: 40,
    operational: 19,
  },
  truncated: true,
  completeToMetres: 421,
  density: [{ upToMetres: 500, count: 20 }],
  demographics: null,
  rentOverride: null,
});

const LOCATIONS = [base("Central KL", 3.1478, 101.6953), base("Suburban PJ", 3.1073, 101.6067)];

const TRANSPORT: GeminiTransport = {
  name: "ai-studio",
  model: "test",
  async request() {
    return {
      url: "https://example.invalid/model:generateContent",
      headers: { "content-type": "application/json" },
    };
  },
};

/**
 * A FRESH Response per call. `mockResolvedValue` hands back one object and a
 * Response body is a stream that can only be read once, so the second agent
 * would parse an already-consumed body and look exactly like a guard refusal.
 */
function stubFetch(replies: string[]) {
  let index = 0;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    const text = replies[Math.min(index, replies.length - 1)]!;
    index += 1;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

const reading = (headline: string, points: string[]) => JSON.stringify({ headline, points });

/** Cites only figures the sheet carries. */
const GROUNDED = reading("The lunch crowd is split more ways at the first site.", [
  "Both sites filled the 20-result cap, so each count is a floor rather than a total.",
  "The nearest rival sits 40m away.",
]);

/** Cites a figure nothing accounts for. */
const INVENTED = reading("Footfall is around 8,450 people a day.", [
  "Roughly 61% of them pass the door before noon.",
]);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the comparison fact sheet", () => {
  it("names the unscored dimensions and says what they do to the verdict", () => {
    /**
     * The most misleading thing about a sparse comparison is that a verdict
     * resting on two dimensions reads exactly like one resting on five. The
     * sheet states that rather than leaving the model to notice it.
     */
    const facts = buildComparisonFacts(LOCATIONS);
    expect(facts).toContain("WHAT IS NOT KNOWN");
    expect(facts).toMatch(/could not be scored on any site/);
    expect(facts).toMatch(/carry more weight here than they would/);
  });

  it("tells the model the verdict is already on the page", () => {
    // An agent that restates the computed verdict adds a less authoritative
    // copy of a sentence the reader has already seen.
    expect(buildComparisonFacts(LOCATIONS)).toContain("Do not repeat it back");
  });

  it("carries every location's own sheet, so a cited figure is the page's figure", () => {
    const facts = buildComparisonFacts(LOCATIONS);
    for (const location of LOCATIONS) expect(facts).toContain(location.label);
    expect(facts).toContain("SUCCESS SCORE");
  });

  it("scores through the same engine the browser uses", () => {
    // Client and server agreeing is a tautology rather than a test, because
    // there is one implementation. This pins that it is being called.
    const model = modelComparison(LOCATIONS);
    expect(model.compared).toHaveLength(2);
    expect(model.comparison.dimensions.length).toBeGreaterThan(0);
  });
});

describe("the three agents", () => {
  it("runs one call per specialist", async () => {
    const fetchSpy = stubFetch([GROUNDED]);
    const outcomes = await runAgents({ transport: TRANSPORT }, buildComparisonFacts(LOCATIONS), COMPARE_ROSTER);

    expect(outcomes).toHaveLength(AGENT_IDS.length);
    expect(fetchSpy).toHaveBeenCalledTimes(AGENT_IDS.length);
    expect(outcomes.every((o) => o.kind === "reading")).toBe(true);
  });

  it("REFUSES an agent that cites a figure nothing accounts for", async () => {
    stubFetch([INVENTED]);
    const outcomes = await runAgents({ transport: TRANSPORT }, buildComparisonFacts(LOCATIONS), COMPARE_ROSTER);

    expect(outcomes.every((o) => o.kind === "refused")).toBe(true);
    const first = outcomes[0]!;
    if (first.kind !== "refused") throw new Error("expected a refusal");
    // The offending figures are reported, not just the fact of refusal:
    // "refused" and "failed" need opposite fixes.
    expect(first.unsupported).toContain(8450);
  });

  it("lets ONE agent be refused without losing the other two", async () => {
    /**
     * The whole reason this is three calls rather than one object. A single
     * reply that trips the guard on one figure currently loses every
     * paragraph, including the good ones.
     */
    stubFetch([GROUNDED, INVENTED, GROUNDED]);
    const outcomes = await runAgents({ transport: TRANSPORT }, buildComparisonFacts(LOCATIONS), COMPARE_ROSTER);

    expect(outcomes.filter((o) => o.kind === "reading")).toHaveLength(2);
    expect(outcomes.filter((o) => o.kind === "refused")).toHaveLength(1);
  });

  it("names the specialist that was withheld, rather than going quiet", async () => {
    stubFetch([GROUNDED, INVENTED, GROUNDED]);
    const outcomes = await runAgents({ transport: TRANSPORT }, buildComparisonFacts(LOCATIONS), COMPARE_ROSTER);
    const withheld = outcomes.find((o) => o.kind !== "reading");

    expect(withheld).toBeDefined();
    if (!withheld) return;
    // A shorter panel that looks complete is worse than one that says a view
    // is missing.
    expect(withheld.role.length).toBeGreaterThan(0);
    expect(AGENT_IDS).toContain(withheld.id);
  });

  it("treats an unparseable reply as failed, which is a different thing", async () => {
    // A truncated reply presents as invalid JSON with nothing in it to say
    // why. "Failed" and "refused" need opposite fixes, so they stay apart.
    stubFetch(["not json at all"]);
    const outcomes = await runAgents({ transport: TRANSPORT }, buildComparisonFacts(LOCATIONS), COMPARE_ROSTER);
    expect(outcomes.every((o) => o.kind === "failed")).toBe(true);
  });
});

describe("asking about a comparison", () => {
  it("refuses an answer that works out a figure of its own", async () => {
    stubFetch(["The gap works out at about 47% more rivals per square kilometre."]);
    const outcome = await askAboutComparison(
      { transport: TRANSPORT },
      "which is busier?",
      buildComparisonFacts(LOCATIONS),
    );
    expect(outcome.kind).toBe("refused");
  });

  it("allows a figure the user themselves typed", async () => {
    // Refusing a number the reader supplied would make the assistant unable to
    // repeat the question back.
    stubFetch(["At a budget of 7777 ringgit the rent axis is the one to settle first."]);
    const outcome = await askAboutComparison(
      { transport: TRANSPORT },
      "what if my budget is 7777?",
      buildComparisonFacts(LOCATIONS),
    );
    expect(outcome.kind).toBe("answer");
  });
});

describe("what the assistant is NOT given", () => {
  it("offers no tool that could change the comparison", async () => {
    /**
     * THE STRUCTURAL FORM OF "ANSWER ONLY".
     *
     * `/v1/location/ask` gives the model an `adjust_view` tool, and the page's
     * own cached fetch then runs. Here category and radius apply to every
     * site, so one sentence could spend a paid Places call per location
     * against a MYR 45 monthly budget. The owner chose answer-only, and the
     * way to mean it is to not hand over the tool: a prompt is not a
     * constraint, which is the lesson the simulator's patch shape already
     * encodes.
     *
     * Read off the REQUEST BODY rather than the source, so this still holds if
     * somebody adds a tool without noticing what it costs.
     */
    let sent: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      sent = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "No figures here." }] } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    await askAboutComparison(
      { transport: TRANSPORT },
      "compare these at 250m instead",
      buildComparisonFacts(LOCATIONS),
    );

    const tools = (sent?.["tools"] ?? []) as { functionDeclarations?: { name: string }[] }[];
    const names = tools.flatMap((t) => t.functionDeclarations ?? []).map((f) => f.name);

    expect(names).not.toContain("adjust_view");
    // Declining IS offered: refusing to answer has to stay available.
    expect(names).toContain("decline_out_of_scope");
  });

  it("gives the agents no tools at all", async () => {
    // The three specialists only write. Nothing they emit is executable, so a
    // jailbroken reply reaches nothing.
    let sent: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      sent = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: GROUNDED }] } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    await runAgents({ transport: TRANSPORT }, buildComparisonFacts(LOCATIONS), COMPARE_ROSTER);
    expect(sent?.["tools"]).toBeUndefined();
  });
});

describe("a reply that ran out of room", () => {
  it("WITHHOLDS a cut-off answer rather than showing half a thought", async () => {
    /**
     * FOUND ON THE DEPLOYED MODEL, never against a stub.
     *
     * Thinking tokens are charged against `maxOutputTokens`, and a comparison
     * fact sheet is three times the size of a single location's, so the model
     * thinks far longer before it writes. The ceiling had been copied across
     * from the single-location assistant, and the reply came back at 329
     * characters ending "The evidence shows Suburban" with no full stop.
     *
     * The nasty part is that the numeric guard PASSED it: every figure in the
     * fragment was real. Prose truncation does not fail loudly the way a
     * truncated JSON object does, so a reader is handed a confident half
     * answer with nothing to say it was cut.
     */
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                finishReason: "MAX_TOKENS",
                content: { parts: [{ text: "The evidence shows Suburban" }] },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    const outcome = await askAboutComparison(
      { transport: TRANSPORT },
      "which is the safer bet?",
      buildComparisonFacts(LOCATIONS),
    );

    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") return;
    // Said apart from the guard refusal: these need opposite fixes, and a
    // category-only failure already cost a deploy cycle once with Overpass.
    expect(outcome.reason).toMatch(/ran past its limit/);
    expect(outcome.reason).not.toMatch(/working out a figure/);
  });

  it("asks for enough headroom that it should not happen often", async () => {
    let sent: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      sent = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "Fine." }] } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    await askAboutComparison({ transport: TRANSPORT }, "why?", buildComparisonFacts(LOCATIONS));
    const config = (sent?.["generationConfig"] ?? {}) as { maxOutputTokens?: number };
    expect(config.maxOutputTokens).toBeGreaterThanOrEqual(8192);
  });
});

describe("the routes", () => {
  const payload = { category: "korean_restaurant", radiusMetres: 500, locations: LOCATIONS };

  it("refuses a comparison of one", async () => {
    const app = buildApp({ gemini: { transport: TRANSPORT } });
    const res = await app.inject({
      method: "POST",
      url: "/v1/compare/brief",
      payload: { ...payload, locations: [LOCATIONS[0]] },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("says so plainly when no model is configured", async () => {
    // The deterministic half of every page keeps working without Gemini, and
    // the failure has to name itself rather than looking like a bug.
    const app = buildApp({});
    const res = await app.inject({ method: "POST", url: "/v1/compare/brief", payload });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("ai_unavailable");
    await app.close();
  });

  it("serves a second identical request from cache, spending nothing", async () => {
    /**
     * CACHE BEFORE QUOTA, and before the model. A page view costs one call a
     * week rather than one per refresh, per share and per reader.
     */
    const store = new InMemoryReadingsStore();
    const fetchSpy = stubFetch([GROUNDED]);
    const app = buildApp({ gemini: { transport: TRANSPORT }, readingsStore: store });

    const first = await app.inject({ method: "POST", url: "/v1/compare/brief", payload });
    expect(first.json().cached).toBe(false);
    const calls = fetchSpy.mock.calls.length;

    const second = await app.inject({ method: "POST", url: "/v1/compare/brief", payload });
    expect(second.json().cached).toBe(true);
    expect(fetchSpy.mock.calls.length, "a cache hit must not call the model").toBe(calls);
    await app.close();
  });

  it("NEVER caches a partial set, so a missing specialist cannot become permanent", async () => {
    const store = new InMemoryReadingsStore();
    stubFetch([GROUNDED, INVENTED, GROUNDED]);
    const app = buildApp({ gemini: { transport: TRANSPORT }, readingsStore: store });

    const res = await app.inject({ method: "POST", url: "/v1/compare/brief", payload });
    expect(res.json().readings).toHaveLength(2);
    expect(res.json().withheld).toHaveLength(1);
    expect(store.size, "a refusal is one bad roll, not a property of this comparison").toBe(0);
    await app.close();
  });

  it("regenerates rather than serving an entry written under an older shape", async () => {
    /**
     * Caught in production once and nowhere else: the key hashed the facts
     * alone, so entries from a previous revision were served into a UI that
     * expected more fields. The key carries a shape version for that reason.
     */
    const store = new InMemoryReadingsStore();
    const facts = buildComparisonFacts(LOCATIONS);
    await store.save({
      key: `legacy-${facts.length}`,
      readings: [{ id: "analyst", role: "Analyst", headline: "stale", points: ["stale"] }],
      generatedAt: Date.now(),
    });

    stubFetch([GROUNDED]);
    const app = buildApp({ gemini: { transport: TRANSPORT }, readingsStore: store });
    const res = await app.inject({ method: "POST", url: "/v1/compare/brief", payload });

    expect(res.json().cached).toBe(false);
    expect(await store.find(readingsKey(facts))).not.toBeNull();
    await app.close();
  });

  it("rejects a question that is empty or absurdly long", async () => {
    const app = buildApp({ gemini: { transport: TRANSPORT } });
    for (const question of ["", "x".repeat(501)]) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/compare/ask",
        payload: { ...payload, question },
      });
      expect(res.statusCode).toBe(400);
    }
    await app.close();
  });
});
