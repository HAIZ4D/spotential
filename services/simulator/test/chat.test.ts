import { afterAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { aiStudioTransport } from "../src/gemini.js";
import { QuotaTracker } from "../src/quota.js";
import { buildFacts } from "../src/chat/facts.js";
import { askAboutLocation } from "../src/chat/ask.js";
import type { LocationReportInput } from "../src/report/model.js";

/**
 * The location chatbot — Feature 3.
 *
 * Two halves. The FACTS must carry the same figures the panels show, or the
 * chatbot is grounded on something the user cannot see. The ROUTE must behave
 * the way every AI path here behaves: validate first, decline plainly, and
 * never let a model failure suggest the deterministic figures are wrong.
 *
 * Gemini itself is stubbed. Live model behaviour is verified against the
 * deployed service, per the standing rule.
 */

const CENTRAL_KL: LocationReportInput = {
  point: { lat: 3.1478, lng: 101.6953 },
  label: "Central KL",
  category: "korean_restaurant",
  radiusMetres: 500,
  competitors: {
    total: 20,
    averageRating: 4.23,
    ratedCount: 20,
    totalReviews: 2060,
    nearestMetres: 60,
    operational: 20,
  },
  truncated: true,
  completeToMetres: 142,
  density: [
    { upToMetres: 250, count: 20 },
    { upToMetres: 500, count: 0 },
  ],
  demographics: {
    district: "W.P. Kuala Lumpur",
    state: "W.P. Kuala Lumpur",
    total: 2_074_100,
    age: {
      "15-19": 142_900, "20-24": 142_400, "25-29": 146_400, "30-34": 205_000,
      "35-39": 238_900, "40-44": 243_200, "45-49": 177_900, "50-54": 128_400,
      "55-59": 79_800, "60-64": 72_500,
    },
  },
  rentOverride: null,
};

describe("the fact sheet says what the panels say", () => {
  const facts = buildFacts(CENTRAL_KL);

  it("carries the same overall score the panel shows", () => {
    // Pinned elsewhere as the deployed figure for this point. If scoring
    // changes, the chatbot's grounding changes with it and this fails loudly.
    expect(facts).toContain("Overall: 40 out of 100");
  });

  it("carries every dimension with its basis and weight", () => {
    for (const label of [
      "Competition",
      "Est. monthly demand",
      "Revenue potential",
      "Competitor quality",
      "Rent sensitivity",
    ]) {
      expect(facts).toContain(label);
    }
    expect(facts).toMatch(/measured/);
    expect(facts).toMatch(/inferred/);
  });

  it("says a capped count is a floor and unsearched bands are not empty", () => {
    expect(facts).toContain("FLOOR");
    expect(facts).toMatch(/NOT SEARCHED and are not known to be empty/);
  });

  it("forbids describing the district as a catchment, in the facts themselves", () => {
    expect(facts).toMatch(/never be described as a customer count/);
  });

  it("names the rent as inferred, with its benchmark and review date", () => {
    expect(facts).toMatch(/INFERRED benchmark for Jalan TAR \/ Dang Wangi, KL/);
    expect(facts).toMatch(/reviewed \d{4}-\d{2}-\d{2}/);
  });

  it("prefers a rent the user supplied, and says so", () => {
    const supplied = buildFacts({ ...CENTRAL_KL, rentOverride: 6_000 });
    expect(supplied).toContain("Monthly rent: RM 6,000");
    expect(supplied).toMatch(/the rent the user entered/);
  });

  /**
   * A model given only positive facts fills the silence. Stating the gaps is
   * what lets it decline instead of inventing seasonality or footfall.
   */
  it("states what is NOT known", () => {
    expect(facts).toContain("WHAT IS NOT KNOWN");
    expect(facts).toMatch(/No seasonal or time-of-day demand data/);
    expect(facts).toMatch(/No footfall counts/);
    expect(facts).toMatch(/whether this business will succeed/);
  });

  it("says plainly when nothing resolved, rather than omitting the section", () => {
    const bare = buildFacts({
      ...CENTRAL_KL,
      point: { lat: 3.8077, lng: 103.326 },
      demographics: null,
    });
    expect(bare).toContain("No demographic data resolved");
    expect(bare).toMatch(/No rent benchmark covers this location/);
  });
});

// ---------------------------------------------------------------------------

/** A Gemini transport whose response we control. */
function stubGemini(response: unknown) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  return { transport: aiStudioTransport("test-key") };
}

const textReply = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] });
const callReply = (name: string, args: Record<string, unknown>) => ({
  candidates: [{ content: { parts: [{ functionCall: { name, args } }] } }] });

describe("answers are refused when the model computes", () => {
  afterAll(() => vi.restoreAllMocks());

  it("passes an answer that only quotes the facts", async () => {
    const config = stubGemini(
      textReply("It scores 40 out of 100. Competition is the weakest dimension at 0."),
    );
    const outcome = await askAboutLocation(config, "why so low?", CENTRAL_KL);

    expect(outcome.kind).toBe("answer");
    vi.restoreAllMocks();
  });

  /**
   * The failure the whole feature is built around. Nothing produced 58, and a
   * reader cannot tell it apart from the figures that are real.
   */
  it("refuses an answer containing a figure the panels never produced", async () => {
    const config = stubGemini(
      textReply("Competition scores 0 against a typical 58, so this is unusually crowded."),
    );
    const outcome = await askAboutLocation(config, "why so low?", CENTRAL_KL);

    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") {
      expect(outcome.reason).toMatch(/every number here has to come from the panels/i);
    }
    vi.restoreAllMocks();
  });

  it("refuses rather than returning an empty answer", async () => {
    const config = stubGemini(textReply(""));
    expect((await askAboutLocation(config, "hello?", CENTRAL_KL)).kind).toBe("refused");
    vi.restoreAllMocks();
  });
});

describe("tool calls", () => {
  afterAll(() => vi.restoreAllMocks());

  it("turns a different-radius question into a view change, not an answer", async () => {
    const config = stubGemini(
      callReply("adjust_view", { radiusMetres: 1000, why: "Widening to 1km." }),
    );
    const outcome = await askAboutLocation(config, "what about 1km?", CENTRAL_KL);

    expect(outcome.kind).toBe("adjust");
    if (outcome.kind === "adjust") {
      expect(outcome.radiusMetres).toBe(1000);
      expect(outcome.category).toBeNull();
    }
    vi.restoreAllMocks();
  });

  it("rejects a radius outside the searchable buckets", async () => {
    // A model naming 750m must not reach the page and blank the analysis.
    const config = stubGemini(callReply("adjust_view", { radiusMetres: 750, why: "..." }));
    expect((await askAboutLocation(config, "what about 750m?", CENTRAL_KL)).kind).toBe("declined");
    vi.restoreAllMocks();
  });

  it("rejects a business type that does not exist", async () => {
    const config = stubGemini(callReply("adjust_view", { category: "car_wash", why: "..." }));
    expect((await askAboutLocation(config, "what about car washes?", CENTRAL_KL)).kind).toBe(
      "declined",
    );
    vi.restoreAllMocks();
  });

  it("declines out of scope with the nearest thing it can do", async () => {
    const config = stubGemini(
      callReply("decline_out_of_scope", {
        reason: "There is no seasonal data here.",
        suggestion: "Ask about competitor density instead.",
      }),
    );
    const outcome = await askAboutLocation(config, "how is Ramadan?", CENTRAL_KL);

    expect(outcome.kind).toBe("declined");
    if (outcome.kind === "declined") expect(outcome.suggestion).toMatch(/competitor density/);
    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------

describe("POST /v1/location/ask", () => {
  const app = buildApp();
  afterAll(async () => {
    await app.close();
  });

  const body = {
    question: "why did this score so low?",
    category: "korean_restaurant",
    radiusMetres: 500,
    location: CENTRAL_KL,
  };

  it("reports itself unavailable rather than crashing with no Gemini", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/location/ask", payload: body });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("ai_unavailable");
  });

  it("validates the question before worrying about the model", async () => {
    for (const question of ["", "   ", "x".repeat(501)]) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/location/ask",
        payload: { ...body, question },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("invalid_question");
    }
  });

  it("rejects an unusable location context", async () => {
    const bad = await app.inject({
      method: "POST",
      url: "/v1/location/ask",
      payload: { ...body, category: "car_wash" },
    });
    expect(bad.statusCode).toBe(400);

    const noPoint = await app.inject({
      method: "POST",
      url: "/v1/location/ask",
      payload: { ...body, location: { ...CENTRAL_KL, point: { lat: 999, lng: 101 } } },
    });
    expect(noPoint.statusCode).toBe(400);
  });
});

describe("the route with Gemini configured", () => {
  afterAll(() => vi.restoreAllMocks());

  const body = {
    question: "how crowded is it?",
    category: "korean_restaurant",
    radiusMetres: 500,
    location: CENTRAL_KL,
  };

  it("answers, and never touches Places", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(textReply("Competition scores 0 — this is a dense pitch.")), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const app = buildApp({ gemini: { transport: aiStudioTransport("test-key") } });

    try {
      const res = await app.inject({ method: "POST", url: "/v1/location/ask", payload: body });
      expect(res.statusCode).toBe(200);
      expect(res.json().kind).toBe("answer");

      // One call, to Gemini. A chatbot that could spend Places money would be
      // an unbounded bill behind a text box.
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0]?.[0])).toContain("generativelanguage");
    } finally {
      spy.mockRestore();
      await app.close();
    }
  });

  it("says the figures are unaffected when the model fails", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET"));
    const app = buildApp({ gemini: { transport: aiStudioTransport("test-key") } });

    try {
      const res = await app.inject({ method: "POST", url: "/v1/location/ask", payload: body });
      expect(res.statusCode).toBe(502);
      expect(res.json().message).toMatch(/figure on the page is unaffected/);
    } finally {
      spy.mockRestore();
      await app.close();
    }
  });

  it("enforces the shared quota", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(textReply("Competition scores 0.")), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const app = buildApp({
      gemini: { transport: aiStudioTransport("test-key") },
      quota: new QuotaTracker({ perCallerPerDay: 1, globalPerDay: 10 }),
    });

    try {
      expect(
        (await app.inject({ method: "POST", url: "/v1/location/ask", payload: body })).statusCode,
      ).toBe(200);
      const second = await app.inject({
        method: "POST",
        url: "/v1/location/ask",
        payload: body,
      });
      expect(second.statusCode).toBe(429);
    } finally {
      spy.mockRestore();
      await app.close();
    }
  });
});
