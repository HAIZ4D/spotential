import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { buildFacts, type GapFacts } from "../src/chat/facts.js";
import { InMemoryBriefingStore } from "../src/chat/store.js";
import type { GeminiTransport } from "../src/gemini.js";
import type { LocationReportInput } from "../src/report/model.js";

/**
 * The Spotential AI briefing.
 *
 * The feature exists because of a specific reporting failure: the gap write-up
 * was skipped whenever `topOpportunity` was null, which is exactly when every
 * category is saturated. The screen that most needed prose was guaranteed to
 * get none. The first test here is that case.
 */

const POINT = { lat: 3.1478, lng: 101.6953 };

const LOCATION: LocationReportInput = {
  point: POINT,
  label: "Kuala Lumpur",
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
};

/** Every category crowded and no winner: the state in the owner's screenshot. */
const ALL_SATURATED: GapFacts = {
  ranked: [
    "Fast-casual takeaway",
    "Korean restaurant",
    "Cafe / coffee shop",
    "Casual dining / mamak",
    "Bubble tea / dessert",
    "Other (F&B)",
  ].map((label, i) => ({
    label,
    outlets: i === 0 ? 10 : 20,
    outletsAreMinimum: i !== 0,
    reviewsPerOutlet: [232, 379, 281, 379, 205, 212][i]!,
    averageRating: [4.3, 4.41, 4.42, 4.41, 4.33, 4.55][i]!,
    verdict: "saturated",
  })),
  noPresence: [],
  topOpportunity: null,
};

/**
 * A transport that resolves. The reply body comes from the stubbed `fetch`
 * below, which is what `callGemini` actually reads.
 */
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
 * A FRESH Response per call, not a shared one.
 *
 * `mockResolvedValue` hands back the same object every time, and a Response
 * body is a stream that can only be read once — so the second call parsed an
 * already-consumed body, produced no text, and came back refused. It looked
 * exactly like the guard rejecting a briefing.
 */
function stubFetch(text: string) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
}

const OPPORTUNITY = {
  verdict: "No category stands out as an opening, because all 6 compared categories are saturated.",
  why: "Korean restaurants face 20 or more outlets averaging 379 reviews per outlet.",
  moves: [
    "Visit the competitor 40m away to check their peak hour pricing.",
    "Negotiate the rent below the RM 9,600 benchmark.",
  ],
};

const GOOD = JSON.stringify({
  headline: "This is a fully worked F&B street rather than an opening.",
  readings: [
    "Every one of the 6 categories compared came back saturated.",
    "The nearest competitor is 40m away.",
  ],
  watchOut: "The search filled its cap within 421m, so the count is a floor.",
  nextStep: "Compare this against a second location before committing.",
  opportunity: OPPORTUNITY,
});

const post = (app: ReturnType<typeof buildApp>, payload: unknown) =>
  app.inject({ method: "POST", url: "/v1/location/brief", payload: payload as object });

const body = (gaps: GapFacts | null = ALL_SATURATED) => ({
  category: "korean_restaurant",
  radiusMetres: 500,
  location: LOCATION,
  gaps,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the briefing", () => {
  it("writes one even when EVERY category is saturated", async () => {
    // The bug: prose was skipped precisely here, so the hardest screen to read
    // got no help at all.
    const facts = buildFacts(LOCATION, ALL_SATURATED);
    expect(facts).toContain("NO CATEGORY STANDS OUT");
    expect(facts).toContain("Every one of the 6 categories compared is already crowded");

    stubFetch(GOOD);
    const app = buildApp({ gemini: { transport: TRANSPORT } });
    const res = await post(app, body());

    expect(res.statusCode).toBe(200);
    expect(res.json().kind).toBe("brief");
    expect(res.json().briefing.headline).toContain("fully worked");
    expect(res.json().briefing.readings).toHaveLength(2);
    await app.close();
  });

  it("REFUSES a briefing that cites a figure the page never measured", async () => {
    /**
     * 87 appears nowhere in the fact sheet. A model that produces it has
     * computed something, and an invented figure presented as a measurement is
     * the one failure this product cannot absorb. A refusal is a bad answer;
     * that would be a wrong one.
     */
    stubFetch(
      JSON.stringify({
        headline: "Trade here runs 87% above the city average.",
        readings: ["The nearest competitor is 40m away."],
        watchOut: "The result cap filled within 421m.",
        nextStep: "Negotiate hard.",
        opportunity: OPPORTUNITY,
      }),
    );

    const app = buildApp({ gemini: { transport: TRANSPORT } });
    const res = await post(app, body());

    expect(res.statusCode).toBe(200);
    expect(res.json().kind).toBe("refused");
    expect(res.json().unsupported).toContain(87);
    await app.close();
  });

  it("refuses the WHOLE briefing when one field invents a figure", async () => {
    // Dropping the bad field and showing the rest would leave the reader with
    // no way to know something was withheld, and the dropped one is exactly
    // the one that made a number up.
    stubFetch(
      JSON.stringify({
        headline: "A dense F&B street.",
        readings: ["The nearest competitor is 40m away.", "Footfall is around 9400 a day."],
        watchOut: "The result cap filled within 421m.",
        nextStep: "Compare against a quieter site.",
        opportunity: OPPORTUNITY,
      }),
    );

    const app = buildApp({ gemini: { transport: TRANSPORT } });
    const res = await post(app, body());

    expect(res.json().kind).toBe("refused");
    expect(res.json().unsupported).toContain(9400);
    await app.close();
  });

  it("serves a repeat request from cache without calling the model again", async () => {
    const fetchSpy = stubFetch(GOOD);
    const store = new InMemoryBriefingStore();
    const app = buildApp({ gemini: { transport: TRANSPORT }, briefingStore: store });

    const first = await post(app, body());
    expect(first.json().cached).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const second = await post(app, body());
    expect(second.json().cached).toBe(true);
    // The whole reason this renders on every page view rather than behind a
    // button: a second look spends nothing.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(1);
    await app.close();
  });

  it("regenerates when a figure moves, rather than describing stale numbers", async () => {
    const fetchSpy = stubFetch(GOOD);
    const store = new InMemoryBriefingStore();
    const app = buildApp({ gemini: { transport: TRANSPORT }, briefingStore: store });

    await post(app, body());
    // Same point, wider radius. The key is a hash of the FACTS, so this is a
    // fresh briefing rather than old prose sitting beside new figures.
    await post(app, {
      ...body(),
      radiusMetres: 1000,
      location: { ...LOCATION, radiusMetres: 1000 },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(store.size).toBe(2);
    await app.close();
  });

  it("never caches a refusal", async () => {
    // A refusal is a property of one model reply, not of the location. Caching
    // it would freeze a location out of ever getting a briefing.
    const fetchSpy = stubFetch(
      JSON.stringify({
        headline: "Trade here runs 87% above average.",
        readings: ["The nearest competitor is 40m away."],
        watchOut: "Watch the rent.",
        nextStep: "Compare sites.",
        opportunity: OPPORTUNITY,
      }),
    );
    const store = new InMemoryBriefingStore();
    const app = buildApp({ gemini: { transport: TRANSPORT }, briefingStore: store });

    await post(app, body());
    expect(store.size).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("says so plainly when the model is not configured", async () => {
    const app = buildApp({});
    const res = await post(app, body());
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("ai_unavailable");
    await app.close();
  });

  it("rejects a malformed location instead of guessing one", async () => {
    const app = buildApp({ gemini: { transport: TRANSPORT } });
    const res = await post(app, {
      ...body(),
      location: { ...LOCATION, point: { lat: 999, lng: 0 } },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("survives a model that wraps its JSON in a code fence", async () => {
    stubFetch("```json\n" + GOOD + "\n```");
    const app = buildApp({ gemini: { transport: TRANSPORT } });
    const res = await post(app, body());
    expect(res.json().kind).toBe("brief");
    await app.close();
  });

  it("refuses rather than half-renders when the reply is not JSON at all", async () => {
    stubFetch("Sorry, I cannot help with that.");
    const app = buildApp({ gemini: { transport: TRANSPORT } });
    const res = await post(app, body());
    expect(res.json().kind).toBe("refused");
    await app.close();
  });
});

describe("the gap facts", () => {
  it("states the zero-outlet caveat rather than letting the model infer demand", () => {
    const facts = buildFacts(LOCATION, {
      ...ALL_SATURATED,
      noPresence: [{ label: "Healthy food" }],
    });
    expect(facts).toContain("Zero outlets is NOT evidence of an opening");
    expect(facts).toContain("Healthy food");
  });

  it("names the least crowded category when there is one", () => {
    const facts = buildFacts(LOCATION, {
      ...ALL_SATURATED,
      ranked: ALL_SATURATED.ranked.map((row, i) =>
        i === 0 ? { ...row, verdict: "opportunity" } : row,
      ),
      topOpportunity: { label: "Fast-casual takeaway" },
    });
    expect(facts).toContain("Least crowded relative to its demand: Fast-casual takeaway.");
    expect(facts).toContain("5 of 6 categories compared are already crowded");
  });

  it("says nothing about gaps when none were supplied", () => {
    // The PDF and the plain chat route both pass no gaps, and an empty heading
    // would invite the model to fill it.
    expect(buildFacts(LOCATION, null)).not.toContain("CATEGORY SATURATION");
  });
});

describe("the opportunity block", () => {
  it("refuses a briefing whose ADVICE invents a figure", () => {
    // The moves are the part a reader acts on, so they are guarded exactly
    // like everything else. 9400 is in no fact sheet.
    stubFetch(
      JSON.stringify({
        headline: "A fully worked street.",
        readings: ["The nearest competitor is 40m away."],
        watchOut: "The cap filled within 421m.",
        nextStep: "Compare sites.",
        opportunity: {
          verdict: "No category stands out.",
          why: "Everything is saturated.",
          moves: ["Target 9400 walk-ins a month to clear the rent."],
        },
      }),
    );
    const app = buildApp({ gemini: { transport: TRANSPORT } });
    return post(app, body()).then(async (res) => {
      expect(res.json().kind).toBe("refused");
      expect(res.json().unsupported).toContain(9400);
      await app.close();
    });
  });

  it("refuses a briefing with no opportunity verdict at all", async () => {
    /**
     * Silence about a gap reads as "there is none", which is a claim the model
     * never made. An empty verdict is not a briefing.
     */
    stubFetch(
      JSON.stringify({
        headline: "A fully worked street.",
        readings: ["The nearest competitor is 40m away."],
        watchOut: "The cap filled within 421m.",
        nextStep: "Compare sites.",
        opportunity: { verdict: "", why: "", moves: [] },
      }),
    );
    const app = buildApp({ gemini: { transport: TRANSPORT } });
    const res = await post(app, body());
    expect(res.json().kind).toBe("refused");
    await app.close();
  });

  it("caps the moves so a runaway reply cannot fill the page", async () => {
    stubFetch(
      JSON.stringify({
        headline: "A fully worked street.",
        readings: ["The nearest competitor is 40m away."],
        watchOut: "The cap filled within 421m.",
        nextStep: "Compare sites.",
        opportunity: {
          verdict: "No category stands out.",
          why: "Everything is saturated.",
          moves: ["One", "Two", "Three", "Four", "Five", "Six", "Seven"],
        },
      }),
    );
    const app = buildApp({ gemini: { transport: TRANSPORT } });
    const res = await post(app, body());
    expect(res.json().briefing.opportunity.moves).toHaveLength(4);
    await app.close();
  });

  it("puts the absent categories in the facts as a warning, never as a gap", () => {
    // What the model is told is what stops it naming an empty category as the
    // opening. The prose rule is tested live; this pins the input to it.
    const facts = buildFacts(LOCATION, {
      ...ALL_SATURATED,
      noPresence: [{ label: "Healthy food" }],
    });
    const absent = facts.indexOf("Categories with NO outlets at all nearby");
    expect(absent).toBeGreaterThan(-1);
    expect(facts.indexOf("Zero outlets is NOT evidence of an opening")).toBeGreaterThan(absent);
  });
});

describe("the cache key covers the shape, not just the facts", () => {
  it("does not serve an entry written under a different briefing shape", async () => {
    /**
     * The production bug this exists to stop. The key was a hash of the fact
     * sheet alone, so when the briefing grew an `opportunity` block the
     * entries written by the previous revision were still served, and the new
     * UI rendered a gap section with an empty heading. A cache key has to
     * cover the SHAPE of what it stores as well as the inputs behind it.
     */
    const store = new InMemoryBriefingStore();
    const facts = buildFacts(LOCATION, ALL_SATURATED);

    // An entry keyed the OLD way: the facts hash with no shape marker.
    const { createHash } = await import("node:crypto");
    const legacyKey = createHash("sha256").update(facts).digest("hex").slice(0, 40);
    await store.save({
      key: legacyKey,
      briefing: { headline: "stale", readings: ["stale"], watchOut: "", nextStep: "" } as never,
      generatedAt: Date.now(),
    });

    stubFetch(GOOD);
    const app = buildApp({ gemini: { transport: TRANSPORT }, briefingStore: store });
    const res = await post(app, body());

    // Regenerated rather than served stale, and the new field is present.
    expect(res.json().cached).toBe(false);
    expect(res.json().briefing.opportunity.verdict).not.toBe("");
    await app.close();
  });
});
