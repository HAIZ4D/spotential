import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { buildFacts, type GapFacts } from "../src/chat/facts.js";
import { locationRoster, LOCATION_AGENT_IDS } from "../src/chat/locationAgents.js";
import { InMemoryReadingsStore } from "../src/chat/store.js";
import type { GeminiTransport } from "../src/gemini.js";
import type { LocationReportInput } from "../src/report/model.js";

/**
 * The four specialists on one location.
 *
 * MOST OF THIS FILE IS THE OLD BRIEFING'S, ported rather than binned. Those
 * cases were arrived at one production failure at a time, and deleting a page
 * is not deleting its guarantees: the saturated-street case, the numeric
 * guard, the cache discipline and the legacy-shape entry all still describe
 * behaviour this route has. Three things genuinely changed meaning, and each
 * says so where it sits.
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

/**
 * The same location with somebody living near it.
 *
 * The bare fixture above has no demographics, and the test app has no
 * population grid, so its Customers specialist has nothing to read. That is
 * deliberate and useful: the default case exercises the skip path. This one is
 * for when all four are meant to run.
 */
const WITH_PEOPLE: LocationReportInput = {
  ...LOCATION,
  demographics: {
    district: "Kuala Lumpur",
    state: "W.P. Kuala Lumpur",
    total: 2074100,
    age: { "25-29": 210000, "30-34": 205000 },
    ethnicity: { Bumiputera: 900000 },
  } as never,
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

const reply = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/**
 * A FRESH Response per call, not a shared one.
 *
 * `mockResolvedValue` hands back the same object every time, and a Response
 * body is a stream that can only be read once, so the second specialist parsed
 * an already-consumed body and came back failed. It looked exactly like the
 * guard refusing a reading.
 */
function stubFetch(text: string) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => reply(text));
}

/**
 * Different replies for different specialists.
 *
 * Each agent's system instruction names the section it reads, which is the
 * only thing distinguishing one call from another on the wire. Matching on
 * that is what lets a test give ONE specialist a bad answer and assert the
 * others survive it, which is the whole containment claim.
 */
function stubByAgent(replies: { marker: string; text: string }[], fallback: string) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const body = String((init as RequestInit | undefined)?.body ?? "");
    const match = replies.find((entry) => body.includes(entry.marker));
    return reply(match ? match.text : fallback);
  });
}

const OPPORTUNITY_MARKER = "CATEGORY SATURATION NEARBY section";
const RIVALS_MARKER = "read the COMPETITORS section";
const MONEY_MARKER = "read the RENT section";

const GOOD = JSON.stringify({
  headline: "This is a fully worked F&B street rather than an opening.",
  points: [
    "Every one of the 6 categories compared came back saturated.",
    "The nearest competitor is 40m away.",
  ],
  move: "Visit at 421m out to see where the search actually stopped.",
});

const post = (app: ReturnType<typeof buildApp>, payload: unknown) =>
  app.inject({ method: "POST", url: "/v1/location/brief", payload: payload as object });

const body = (gaps: GapFacts | null = ALL_SATURATED, location = LOCATION) => ({
  category: "korean_restaurant",
  radiusMetres: 500,
  location,
  gaps,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the four specialists", () => {
  it("still write something when EVERY category is saturated", async () => {
    // The bug that created this panel: prose was skipped precisely here, so
    // the hardest screen to read got no help at all.
    const facts = buildFacts(LOCATION, ALL_SATURATED);
    expect(facts).toContain("NO CATEGORY STANDS OUT");
    expect(facts).toContain("Every one of the 6 categories compared is already crowded");

    stubFetch(GOOD);
    const app = buildApp({ gemini: { transport: TRANSPORT } });
    const res = await post(app, body());

    expect(res.statusCode).toBe(200);
    expect(res.json().kind).toBe("readings");
    expect(res.json().readings.map((r: { id: string }) => r.id)).toContain("opportunity");
    expect(res.json().readings[0].points).toHaveLength(2);
    await app.close();
  });

  it("does not call a specialist that has nothing to read", async () => {
    /**
     * COUNTED, not read off the code. This is both the cost control and the
     * quality control: a model asked to write about an absence writes filler,
     * and filler beside real findings teaches a reader that the cards are
     * decoration. The bare fixture has no demographics and the test app has no
     * population grid, so Customers has no section.
     */
    const fetchSpy = stubFetch(GOOD);
    const app = buildApp({ gemini: { transport: TRANSPORT } });
    const res = await post(app, body());

    expect(fetchSpy).toHaveBeenCalledTimes(3);

    const skipped = res.json().skipped as { id: string; role: string; reason: string }[];
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.id).toBe("customers");
    // Named, with a computed reason. A card that simply vanished would read as
    // "there is nothing to say about customers here", a claim nobody made.
    expect(skipped[0]!.role).toBe("Customers");
    expect(skipped[0]!.reason).toMatch(/not known/);
    await app.close();
  });

  it("runs all four when every section has something in it", async () => {
    const fetchSpy = stubFetch(GOOD);
    const app = buildApp({ gemini: { transport: TRANSPORT } });
    const res = await post(app, body(ALL_SATURATED, WITH_PEOPLE));

    expect(fetchSpy).toHaveBeenCalledTimes(LOCATION_AGENT_IDS.length);
    expect(res.json().skipped).toHaveLength(0);
    expect(res.json().readings).toHaveLength(4);
    await app.close();
  });

  it("REFUSES a reading that cites a figure the page never measured", async () => {
    /**
     * 87 appears nowhere in the fact sheet. A model that produces it has
     * computed something, and an invented figure presented as a measurement is
     * the one failure this product cannot absorb. A refusal is a bad answer;
     * that would be a wrong one.
     */
    stubFetch(
      JSON.stringify({
        headline: "Trade here runs 87% above the city average.",
        points: ["The nearest competitor is 40m away."],
        move: "Negotiate hard.",
      }),
    );

    const app = buildApp({ gemini: { transport: TRANSPORT } });
    const res = await post(app, body());

    expect(res.statusCode).toBe(200);
    expect(res.json().readings).toHaveLength(0);
    expect(res.json().withheld).toHaveLength(3);
    expect(res.json().withheld[0].reason).toBe("refused");
    await app.close();
  });

  it("withholds ONE specialist rather than the whole panel", async () => {
    /**
     * A DELIBERATE REVERSAL of the old briefing's behaviour, and the reversal
     * is the improvement.
     *
     * One object had to be refused whole: showing three good paragraphs and
     * silently dropping a fourth left the reader unable to tell that anything
     * was withheld, and the dropped one was exactly the one that invented a
     * number. Four separately-guarded specialists change that, because a
     * missing one can be NAMED. So a bad figure now costs one card.
     */
    stubByAgent(
      [{ marker: RIVALS_MARKER, text: JSON.stringify({
        headline: "A dense street.",
        points: ["Footfall is around 9400 a day."],
        move: "Count the door traffic yourself.",
      }) }],
      GOOD,
    );

    const app = buildApp({ gemini: { transport: TRANSPORT } });
    const res = await post(app, body());

    const readings = res.json().readings as { id: string }[];
    const withheld = res.json().withheld as { id: string; reason: string }[];

    expect(withheld).toHaveLength(1);
    expect(withheld[0]!.id).toBe("rivals");
    expect(withheld[0]!.reason).toBe("refused");
    // The other two survive it. That is the containment claim.
    expect(readings.map((r) => r.id).sort()).toEqual(["money", "opportunity"]);
    await app.close();
  });

  it("guards the MOVE as tightly as the reading", async () => {
    // The move is the part a reader acts on, so an invented figure there is
    // worse than one in an observation, not better.
    stubByAgent(
      [{ marker: MONEY_MARKER, text: JSON.stringify({
        headline: "The rent is a benchmark rather than a quote.",
        points: ["Break-even needs 71 customers a day."],
        move: "Target 9400 walk-ins a month to clear the rent.",
      }) }],
      GOOD,
    );

    const app = buildApp({ gemini: { transport: TRANSPORT } });
    const res = await post(app, body());

    const withheld = res.json().withheld as { id: string; unsupported?: number[] }[];
    expect(withheld.map((w) => w.id)).toEqual(["money"]);
    await app.close();
  });

  it("caps the points so a runaway reply cannot fill the page", async () => {
    stubFetch(
      JSON.stringify({
        headline: "A fully worked street.",
        points: ["One", "Two", "Three", "Four", "Five", "Six", "Seven"],
        move: "Compare a second site.",
      }),
    );
    const app = buildApp({ gemini: { transport: TRANSPORT } });
    const res = await post(app, body());
    expect(res.json().readings[0].points).toHaveLength(4);
    await app.close();
  });

  it("serves a repeat request from cache without calling the model again", async () => {
    const fetchSpy = stubFetch(GOOD);
    const store = new InMemoryReadingsStore();
    const app = buildApp({ gemini: { transport: TRANSPORT }, readingsStore: store });

    const first = await post(app, body());
    expect(first.json().cached).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    const second = await post(app, body());
    expect(second.json().cached).toBe(true);
    // The whole reason this renders on every page view rather than behind a
    // button: a second look spends nothing.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(store.size).toBe(1);

    // Recomputed on a hit rather than stored, so it can never go stale against
    // the readings it sits beside.
    expect(second.json().skipped).toHaveLength(1);
    await app.close();
  });

  it("regenerates when a figure moves, rather than describing stale numbers", async () => {
    const fetchSpy = stubFetch(GOOD);
    const store = new InMemoryReadingsStore();
    const app = buildApp({ gemini: { transport: TRANSPORT }, readingsStore: store });

    await post(app, body());
    // Same point, wider radius. The key is a hash of the FACTS, so this is a
    // fresh set rather than old prose sitting beside new figures.
    await post(app, {
      ...body(),
      radiusMetres: 1000,
      location: { ...LOCATION, radiusMetres: 1000 },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(6);
    expect(store.size).toBe(2);
    await app.close();
  });

  it("never caches an incomplete set", async () => {
    /**
     * A refusal is a property of one model reply rather than of this location,
     * so the next attempt may well pass. Caching a partial set would be worse
     * than caching nothing: it would make the missing specialist permanent for
     * a week.
     */
    const fetchSpy = stubByAgent(
      [{ marker: RIVALS_MARKER, text: JSON.stringify({
        headline: "Trade here runs 87% above average.",
        points: ["The nearest competitor is 40m away."],
        move: "Compare sites.",
      }) }],
      GOOD,
    );
    const store = new InMemoryReadingsStore();
    const app = buildApp({ gemini: { transport: TRANSPORT }, readingsStore: store });

    await post(app, body());
    expect(store.size).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
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
    expect(res.json().readings).toHaveLength(3);
    await app.close();
  });

  it("names a specialist whose reply would not parse, rather than dropping it", async () => {
    // "failed" and "refused" are logged and reported apart because they need
    // opposite fixes: this one usually means the reply was truncated.
    stubByAgent([{ marker: OPPORTUNITY_MARKER, text: "Sorry, I cannot help with that." }], GOOD);
    const app = buildApp({ gemini: { transport: TRANSPORT } });
    const res = await post(app, body());

    const withheld = res.json().withheld as { id: string; role: string; reason: string }[];
    expect(withheld).toEqual([{ id: "opportunity", role: "Opportunity", reason: "failed" }]);
    expect(res.json().readings).toHaveLength(2);
    await app.close();
  });
});

describe("which specialists have material", () => {
  it("skips Money when no rent benchmark reaches the point", () => {
    // Deep in the South China Sea. No curated benchmark covers it, and an
    // estimated rent is the one thing this panel must never produce.
    const { roster, skipped } = locationRoster(
      { ...WITH_PEOPLE, point: { lat: 5.5, lng: 110.5 } },
      ALL_SATURATED,
    );
    expect(roster.ids).not.toContain("money");
    expect(skipped.map((s) => s.id)).toEqual(["money"]);
    expect(skipped[0]!.reason).toMatch(/No rent benchmark/);
  });

  it("skips Rivals when nothing of the type trades nearby, and says so carefully", () => {
    const { roster, skipped } = locationRoster(
      { ...WITH_PEOPLE, competitors: { ...LOCATION.competitors, total: 0 }, truncated: false },
      ALL_SATURATED,
    );
    expect(roster.ids).not.toContain("rivals");
    // Absence of rivals is not evidence of an opening, and the card must not
    // let a reader take it as one.
    expect(skipped[0]!.reason).toContain("not the same as an opening");
  });

  it("skips Customers when the grid measured nobody, rather than writing about zero", () => {
    /**
     * `typeof 0 === "number"`, so a measured zero used to count as material and
     * the specialist wrote "about 0 residents live within the 500m search
     * radius". Caught against the live model, not in a test.
     */
    const { roster, skipped } = locationRoster(
      { ...LOCATION, catchment: 0, demographics: null },
      ALL_SATURATED,
    );
    expect(roster.ids).not.toContain("customers");

    // And it says WHICH zero. Kontur is Malaysia only, so a zero out here more
    // often means the pin is off the grid than that the street is empty.
    const reason = skipped.find((s) => s.id === "customers")!.reason;
    expect(reason).toContain("Malaysia only");
    expect(reason).toContain("measured nobody");
  });

  it("still reads a real catchment", () => {
    const { roster } = locationRoster({ ...LOCATION, catchment: 6457 }, ALL_SATURATED);
    expect(roster.ids).toContain("customers");
  });

  it("skips Opportunity when no category comparison was run", () => {
    const { roster } = locationRoster(WITH_PEOPLE, null);
    expect(roster.ids).not.toContain("opportunity");
    expect(roster.ids).toContain("rivals");
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

  it("puts the absent categories in the facts as a warning, never as a gap", () => {
    // What the model is told is what stops it naming an empty category as the
    // opening. The prose rule is verified live; this pins the input to it.
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
  it("does not serve an entry written under a different shape", async () => {
    /**
     * The production bug this exists to stop. The key was a hash of the fact
     * sheet alone, so when the briefing grew an `opportunity` block the
     * entries written by the previous revision were still served, and the new
     * UI rendered a gap section with an empty heading. A cache key has to
     * cover the SHAPE of what it stores as well as the inputs behind it, which
     * is exactly the case here: entries written by the single briefing hold a
     * `briefing` object where this revision expects `readings`.
     */
    const store = new InMemoryReadingsStore();
    const facts = buildFacts(LOCATION, ALL_SATURATED);

    // An entry keyed the OLD way: the facts hash with the briefing's marker.
    const { createHash } = await import("node:crypto");
    const legacyKey = createHash("sha256")
      .update(`2-opportunity\n${facts}`)
      .digest("hex")
      .slice(0, 40);
    await store.save({
      key: legacyKey,
      readings: [{ id: "stale", role: "Stale", headline: "stale", points: ["stale"] }],
      generatedAt: Date.now(),
    });

    stubFetch(GOOD);
    const app = buildApp({ gemini: { transport: TRANSPORT }, readingsStore: store });
    const res = await post(app, body());

    // Regenerated rather than served stale.
    expect(res.json().cached).toBe(false);
    expect(res.json().readings.map((r: { id: string }) => r.id)).not.toContain("stale");
    await app.close();
  });
});
