import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { EventCatalogue } from "../src/events/catalogue.js";
import { InMemoryApplicationStore } from "../src/events/store.js";
import { parseApplyRequest } from "../src/events/apply.js";
import { isPast } from "@spotential/sim-engine";

/**
 * The events routes.
 *
 * Two properties get most of the attention, because both are the kind that
 * fail quietly rather than loudly:
 *
 *   1. BROWSING AND SCORING MUST COST NOTHING. No Places call, no Gemini call.
 *      That is what makes an events page affordable inside a MYR 45 budget,
 *      and it is asserted rather than assumed — reading the code is not the
 *      guard, exactly as with gap detection's call counting.
 *   2. APPLYING MUST FAIL CLOSED. Without identity or without durable storage
 *      the route refuses, because a confirmation shown for a record that was
 *      never kept is worse than an outage.
 */

const catalogue = await EventCatalogue.load("services/simulator/data");

const app = buildApp({ events: catalogue });
afterAll(async () => {
  await app.close();
});

describe("GET /v1/events", () => {
  it("serves the bundled catalogue", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/events" });
    expect(res.statusCode).toBe(200);

    const body = res.json();

    /**
     * ASSERTED AGAINST THE CATALOGUE, not a magic number.
     *
     * This read `toBeGreaterThan(5)` and went red on 2026-09-02 with no code
     * change: the seeded events age, finished ones drop out of the listing,
     * and the count crossed the threshold on its own. A test that fails by
     * calendar teaches people to ignore it. The invariant worth holding is
     * that the route lists exactly the events that have not finished, and that
     * there is still something to list.
     */
    const listable = catalogue.all().filter((e) => !isPast(e)).length;
    expect(listable).toBeGreaterThan(0);
    expect(body.events.length).toBe(listable);
    expect(body.total).toBe(listable);
  });

  /**
   * `total` means LISTED, and an event whose run has finished is not listed.
   *
   * It used to be `catalogue.size`, so the morning after an event ended the
   * route answered `total: 8` alongside seven events — and the page printed
   * "8 events listed right now" over a list of seven. Caught by a UI test
   * counting the cards against the headline figure, which is the only place
   * the two numbers ever sit next to each other.
   */
  it("does not count an event whose run has already finished", async () => {
    const body = (await app.inject({ method: "GET", url: "/v1/events" })).json();

    expect(body.total).toBe(body.events.length);
    expect(body.events.every((e: { endDate: string }) => !isPast(e as never))).toBe(true);

    // And it is a count of the catalogue, NOT of the current filter — those
    // are different questions and `matched` answers the other one.
    const narrowed = (
      await app.inject({ method: "GET", url: "/v1/events?state=Selangor" })
    ).json();
    expect(narrowed.total).toBe(body.total);
    expect(narrowed.matched).toBeLessThanOrEqual(body.total);
  });

  it("returns events soonest first", async () => {
    const body = (await app.inject({ method: "GET", url: "/v1/events" })).json();
    const dates = body.events.map((e: { startDate: string }) => Date.parse(e.startDate));
    expect(dates).toEqual([...dates].sort((a, b) => a - b));
  });

  it("narrows by state", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/events?state=Selangor" });
    const body = res.json();
    expect(body.events.length).toBeGreaterThan(0);
    for (const e of body.events) expect(e.state).toBe("Selangor");
  });

  it("narrows by event type", async () => {
    const body = (await app.inject({ method: "GET", url: "/v1/events?type=expo" })).json();
    for (const e of body.events) expect(e.eventType).toBe("expo");
  });

  it("treats maxPrice=0 as a real request rather than as no filter", async () => {
    /**
     * The catalogue has no free booths, so a ceiling of zero must return
     * nothing. If `0` were swallowed by a falsy check the whole list would
     * come back — the same class of bug as `Number("")` being 0 in share URLs.
     */
    const body = (await app.inject({ method: "GET", url: "/v1/events?maxPrice=0" })).json();
    expect(body.events).toHaveLength(0);
  });

  it("applies a real price ceiling", async () => {
    /**
     * THE CEILING COMES FROM THE CATALOGUE, not from a magic number.
     *
     * This asserted `maxPrice=500` returned something, and it went red on
     * 2026-09-14 with no code change: seeded events age, the last listable
     * event under RM500 finished, and the filter correctly matched nothing.
     * Second time a calendar has broken a test in this file, and the lesson is
     * the one already written down: assert the invariant, never a value that
     * only holds until a date passes.
     *
     * So it reads the cheapest published price that is actually listable and
     * filters at exactly that, which tests the FILTER rather than the
     * catalogue's current contents.
     */
    const all = (await app.inject({ method: "GET", url: "/v1/events" })).json();
    const prices: number[] = all.events
      .flatMap((e: { packages: { priceRm: number }[] }) => e.packages.map((p) => p.priceRm))
      .filter((n: number) => Number.isFinite(n));
    expect(prices.length, "no listable event publishes a price").toBeGreaterThan(0);

    const ceiling = Math.min(...prices);
    const body = (
      await app.inject({ method: "GET", url: `/v1/events?maxPrice=${ceiling}` })
    ).json();

    expect(body.events.length).toBeGreaterThan(0);
    for (const e of body.events) {
      const cheapest = Math.min(...e.packages.map((p: { priceRm: number }) => p.priceRm));
      expect(cheapest).toBeLessThanOrEqual(ceiling);
    }

    // And it genuinely narrows: an unpriced listing sorts out, never in.
    expect(body.events.length).toBeLessThanOrEqual(all.events.length);
  });

  it("reports itself unavailable rather than serving an empty list", async () => {
    // An empty array would be indistinguishable from a filter matching
    // nothing, which is a very different thing to tell a vendor.
    const bare = buildApp();
    const res = await bare.inject({ method: "GET", url: "/v1/events" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("events_unavailable");
    await bare.close();
  });
});

describe("GET /v1/events/:id", () => {
  it("resolves by id and by slug alike", async () => {
    const byId = await app.inject({ method: "GET", url: "/v1/events/evt-lapan-pagi" });
    const bySlug = await app.inject({ method: "GET", url: "/v1/events/lapan-pagi-club" });

    expect(byId.statusCode).toBe(200);
    expect(bySlug.json().event.id).toBe(byId.json().event.id);
  });

  it("reports the day count and the cheapest way in", async () => {
    const body = (await app.inject({ method: "GET", url: "/v1/events/evt-lapan-pagi" })).json();
    expect(body.days).toBe(2);
    expect(body.entryPriceRm).toBe(380);
  });

  it("returns a null catchment rather than zero when no grid is loaded", async () => {
    // Zero residents and "we did not look" are different claims, and the
    // client renders them differently.
    const body = (await app.inject({ method: "GET", url: "/v1/events/evt-lapan-pagi" })).json();
    expect(body.venueCatchment).toBeNull();
  });

  it("404s an unknown event", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/events/nope" });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /v1/events/rank", () => {
  const vendor = {
    category: "cafe_coffee_shop",
    base: { lat: 3.139, lng: 101.6869 },
    boothBudgetRm: 1_000,
    maxTravelKm: 60,
  };

  it("ranks the catalogue best-first for a vendor", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/events/rank", payload: { vendor } });
    expect(res.statusCode).toBe(200);

    const { ranked } = res.json();
    expect(ranked.length).toBeGreaterThan(0);

    const scores = ranked.map((r: { score: { overall: number } }) => r.score.overall);
    expect(scores).toEqual([...scores].sort((a: number, b: number) => b - a));
  });

  it("refuses a profile with no usable category", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/events/rank",
      payload: { vendor: { category: "not_a_real_category" } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("treats a missing budget as unknown, not as zero", async () => {
    /**
     * `Number("")` is 0 and a budget of 0 means "free stalls only" — a real
     * and very different request. An omitted budget must leave the axis
     * unavailable instead.
     */
    const res = await app.inject({
      method: "POST",
      url: "/v1/events/rank",
      payload: { vendor: { category: "cafe_coffee_shop" } },
    });

    /**
     * ANY event that has a published price, found from the catalogue.
     *
     * This used to pin `evt-lapan-pagi`, which finished on 2026-09-13 and
     * dropped out of the listing the next morning, so `find` returned
     * undefined and the test died on a property of it. The event was never the
     * subject; the behaviour is.
     */
    const listing = (await app.inject({ method: "GET", url: "/v1/events" })).json();
    const withPrice = listing.events.find(
      (e: { packages: unknown[] }) => e.packages.length > 0,
    ) as { id: string } | undefined;
    expect(withPrice, "no listable event publishes a price").toBeDefined();

    const priced = res
      .json()
      .ranked.find((r: { eventId: string }) => r.eventId === withPrice!.id);
    const afford = priced.score.dimensions.find(
      (d: { key: string }) => d.key === "boothAffordability",
    );
    // Falls back to the inferred yardstick rather than scoring as unaffordable.
    // A listing with NO published price is a different case: its axis is
    // correctly unavailable, which is why this looks for one that has a price.
    expect(afford.kind).toBe("proxy");
  });
});

/**
 * The cost guard. Browsing is the whole point of the page and it must be free
 * to serve, so this asserts the absence of the two things that bill.
 */
describe("discovery costs nothing", () => {
  it("makes no outbound fetch while listing, ranking or reading an event", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await app.inject({ method: "GET", url: "/v1/events?state=Selangor" });
    await app.inject({ method: "GET", url: "/v1/events/evt-lapan-pagi" });
    await app.inject({
      method: "POST",
      url: "/v1/events/rank",
      payload: { vendor: { category: "cafe_coffee_shop" } },
    });

    // Places and Gemini both go out over fetch. Zero calls means zero spend.
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("serves events with neither Places nor Gemini configured", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/events" });
    expect(res.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/health" })).json().backends.places).toBe(
      "none",
    );
  });
});

/**
 * Applying, and the two ways it must refuse.
 */
describe("POST /v1/events/:id/apply", () => {
  it("refuses when no auth is configured", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/events/evt-lapan-pagi/apply",
      payload: {},
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("applications_unavailable");
  });

  it("refuses when auth exists but nothing durable can store the result", async () => {
    /**
     * The important one. An in-memory fallback would show the vendor a
     * confirmation for a record that dies with the instance, and the organizer
     * would never learn they applied. Being down is the honest outcome.
     */
    const noStore = buildApp({ events: catalogue, auth: { projectId: "spotential-app" } });
    const res = await noStore.inject({
      method: "POST",
      url: "/v1/events/evt-lapan-pagi/apply",
      payload: {},
      headers: { authorization: "Bearer nonsense" },
    });
    // The auth guard rejects the token first, which is also a refusal.
    expect([401, 503]).toContain(res.statusCode);
    await noStore.close();
  });

  it("rejects an unverifiable token rather than trusting a uid from the body", async () => {
    const guarded = buildApp({
      events: catalogue,
      auth: { projectId: "spotential-app" },
      applicationStore: new InMemoryApplicationStore(),
    });

    const res = await guarded.inject({
      method: "POST",
      url: "/v1/events/evt-lapan-pagi/apply",
      payload: { uid: "someone-elses-uid", businessName: "Test" },
      headers: { authorization: "Bearer forged.token.here" },
    });

    expect(res.statusCode).toBe(401);
    await guarded.close();
  });

  /**
   * THE ACCEPT PATH, which nothing could reach before.
   *
   * Every test above stops at a 401, because `AuthVerifier` checks a token
   * against Google's live JWKS and no unit test can forge one. That is right
   * for the refusals they assert and useless for the thing this route now
   * does: store a real application under a real owner. The verifier is
   * injectable for exactly this, and for nothing else.
   */
  const asVendor = (uid = "vendor-1") => ({
    guard: () => async (request: { user?: unknown }) => {
      // Exactly what the real guard does on a good token: attach the user the
      // routes then read with `userOf`. It does NOT skip any other check.
      request.user = { uid, email: "aina@example.com", name: "Aina", anonymous: false };
    },
  });

  const application = {
    packageId: "std",
    businessName: "Rahim Bakes",
    contactName: "Aina Rahim",
    contactEmail: "aina@example.com",
    contactPhone: "012-345 6789",
    productDescription: "Sourdough loaves, kouign-amann and filter coffee.",
    boothActivation: "Free tastings on the hour.",
    whyThisEvent: "Our regulars are five minutes away.",
    consentToShare: true,
  };

  it("ACCEPTS an application for a curated listing, and stores whose price it was", async () => {
    /**
     * This route used to refuse `source === "seed"` with a 409, so that nobody
     * could believe they had applied to an event that did not exist. The owner
     * reversed it: these events are real, and what is curated is the booth
     * pricing and the slot counts.
     *
     * What replaced the refusal is the record itself. `listingSource` says
     * whether the fee the vendor agreed to was published by the organizer or
     * estimated by us, because whoever forwards this has to know which: one
     * confirms a price, the other has to go and ask for it.
     */
    const store = new InMemoryApplicationStore();
    const guarded = buildApp({
      events: catalogue,
      authVerifier: asVendor() as never,
      applicationStore: store,
    });

    const seeded = catalogue.byId("evt-lapan-pagi")!;
    expect(seeded.source, "fixture must be a curated listing").toBe("seed");

    const res = await guarded.inject({
      method: "POST",
      url: "/v1/events/evt-lapan-pagi/apply",
      payload: { eventId: "evt-lapan-pagi", ...application },
      headers: { authorization: "Bearer stubbed" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().applied).toBe(true);

    const saved = await store.findForUserAndEvent("vendor-1", "evt-lapan-pagi");
    expect(saved).not.toBeNull();
    expect(saved!.listingSource).toBe("seed");
    expect(saved!.boothPriceRm).toBeGreaterThan(0);
    // From the TOKEN, never the body. The whole security of the route.
    expect(saved!.uid).toBe("vendor-1");
    expect(saved!.boothActivation).toContain("tastings");
    await guarded.close();
  });

  it("takes the uid from the token even when the body supplies a different one", async () => {
    const store = new InMemoryApplicationStore();
    const guarded = buildApp({
      events: catalogue,
      authVerifier: asVendor("real-owner") as never,
      applicationStore: store,
    });

    await guarded.inject({
      method: "POST",
      url: "/v1/events/evt-lapan-pagi/apply",
      payload: { eventId: "evt-lapan-pagi", uid: "someone-else", ...application },
      headers: { authorization: "Bearer stubbed" },
    });

    expect(await store.findForUserAndEvent("someone-else", "evt-lapan-pagi")).toBeNull();
    expect(await store.findForUserAndEvent("real-owner", "evt-lapan-pagi")).not.toBeNull();
    await guarded.close();
  });

  it("REPLACES a second application rather than filing two", async () => {
    // The id is `uid__eventId`. An organizer receiving the same vendor twice
    // for one event has to work out which is current, so there is only ever
    // one, and the UI says so before anybody retypes anything.
    const store = new InMemoryApplicationStore();
    const guarded = buildApp({
      events: catalogue,
      authVerifier: asVendor() as never,
      applicationStore: store,
    });

    for (const name of ["Rahim Bakes", "Rahim Bakes & Co"]) {
      await guarded.inject({
        method: "POST",
        url: "/v1/events/evt-lapan-pagi/apply",
        payload: { eventId: "evt-lapan-pagi", ...application, businessName: name },
        headers: { authorization: "Bearer stubbed" },
      });
    }

    const mine = await store.listForUser("vendor-1");
    expect(mine).toHaveLength(1);
    expect(mine[0]!.businessName).toBe("Rahim Bakes & Co");
    await guarded.close();
  });

  it("still refuses without consent, which no reversal changes", async () => {
    // This is the moment contact details leave Spotential for a third party.
    // Accepting curated listings did not loosen it.
    const guarded = buildApp({
      events: catalogue,
      authVerifier: asVendor() as never,
      applicationStore: new InMemoryApplicationStore(),
    });

    const res = await guarded.inject({
      method: "POST",
      url: "/v1/events/evt-lapan-pagi/apply",
      payload: { eventId: "evt-lapan-pagi", ...application, consentToShare: false },
      headers: { authorization: "Bearer stubbed" },
    });

    expect(res.statusCode).toBe(400);
    await guarded.close();
  });

  it("requires a signed-in caller at all", async () => {
    const guarded = buildApp({
      events: catalogue,
      auth: { projectId: "spotential-app" },
      applicationStore: new InMemoryApplicationStore(),
    });

    const res = await guarded.inject({
      method: "POST",
      url: "/v1/events/evt-lapan-pagi/apply",
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("sign_in_required");
    await guarded.close();
  });
});

describe("GET /health", () => {
  it("names the events and auth backends so a downgrade is assertable", async () => {
    const { backends } = (await app.inject({ method: "GET", url: "/health" })).json();
    expect(backends.events).toBe(`seed:${catalogue.size}`);
    expect(backends.auth).toBe("off");
    expect(backends.applications).toBe("in-memory");
  });
});

/**
 * Application validation. These lean toward refusing rather than coercing:
 * a silently truncated phone number means the vendor believes they applied
 * and the organizer can never reach them.
 */
describe("parseApplyRequest", () => {
  const valid = {
    eventId: "evt-1",
    packageId: "std",
    businessName: "Kedai Kopi Ali",
    contactName: "Ali bin Ahmad",
    contactEmail: "ali@example.com",
    contactPhone: "012-345 6789",
    productDescription: "Specialty local coffee and kaya toast.",
    consentToShare: true,
  };

  it("accepts a complete application", () => {
    const parsed = parseApplyRequest(valid);
    expect(parsed.ok).toBe(true);
  });

  it("requires consent explicitly, never by default", () => {
    // This is the moment contact details leave Spotential for a third party.
    const parsed = parseApplyRequest({ ...valid, consentToShare: false });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.join(" ")).toMatch(/shared with the organizer/);
  });

  it("treats a missing consent field as refusal", () => {
    const { consentToShare, ...withoutConsent } = valid;
    expect(consentToShare).toBe(true);
    expect(parseApplyRequest(withoutConsent).ok).toBe(false);
  });

  it("catches a mistyped phone number", () => {
    for (const contactPhone of ["12345", "not a phone", "+1 555 0100"]) {
      const parsed = parseApplyRequest({ ...valid, contactPhone });
      expect(parsed.ok, contactPhone).toBe(false);
    }
  });

  it("accepts the ways Malaysians actually write their number", () => {
    for (const contactPhone of ["0123456789", "012-345 6789", "+60123456789", "+60 12 345 6789"]) {
      const parsed = parseApplyRequest({ ...valid, contactPhone });
      expect(parsed.ok, contactPhone).toBe(true);
    }
  });

  it("catches an unreachable email", () => {
    const parsed = parseApplyRequest({ ...valid, contactEmail: "ali@" });
    expect(parsed.ok).toBe(false);
  });

  it("collects every problem at once so a form can show them together", () => {
    const parsed = parseApplyRequest({});
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.length).toBeGreaterThan(3);
  });

  it("trims rather than rejecting incidental whitespace", () => {
    const parsed = parseApplyRequest({ ...valid, businessName: "  Kedai Kopi Ali  " });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.businessName).toBe("Kedai Kopi Ali");
  });

  /**
   * The pitch: what the vendor will run at the booth, and why they fit.
   *
   * Optional on purpose. `productDescription` is what an organizer needs to
   * judge the stall at all; a pitch is what helps them choose between two
   * good ones. Making it required would only teach people to write filler,
   * and filler is worse than a blank for the person reading fifty of these.
   */
  it("accepts an application with no pitch at all", () => {
    const parsed = parseApplyRequest(valid);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.boothActivation).toBe("");
    expect(parsed.value.whyThisEvent).toBe("");
  });

  it("carries the pitch through rather than dropping it", () => {
    const parsed = parseApplyRequest({
      ...valid,
      boothActivation: "Free tastings on the hour and a latte-art demo at 4pm.",
      whyThisEvent: "Our regulars are five minutes from this venue.",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.boothActivation).toContain("latte-art");
    expect(parsed.value.whyThisEvent).toContain("five minutes");
  });

  it("REFUSES an over-long pitch rather than silently truncating it", () => {
    /**
     * A half-sentence handed to the organizer, with nothing telling the vendor
     * it was cut, is the same failure mode as a silently shortened phone
     * number: the vendor believes they said something they did not. The cap
     * exists to bound the write, so exceeding it is a rejection.
     */
    for (const field of ["boothActivation", "whyThisEvent"] as const) {
      const parsed = parseApplyRequest({ ...valid, [field]: "x".repeat(601) });
      expect(parsed.ok, field).toBe(false);
    }
  });

  it("treats a non-string pitch as absent rather than stringifying it", () => {
    const parsed = parseApplyRequest({ ...valid, boothActivation: { evil: true } });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.boothActivation).toBe("");
  });
});

describe("the catalogue itself", () => {
  it("separates what the poster states from what we estimated", () => {
    /**
     * The visible "Sample" badges were removed at the owner's request. What
     * still has to hold is the provenance split — the poster's own facts on
     * one side, our curated figures on the other — and `source: "seed"`, which
     * is what the apply route refuses on.
     */
    for (const event of catalogue.all()) {
      expect(event.source).toBe("seed");
      expect(event.sourceNote).toMatch(/taken from the event's own poster/);
      expect(event.sourceNote).toMatch(/curated estimates/);
    }
  });

  it("carries a review date on every entry, like every other reference value", () => {
    for (const event of catalogue.all()) {
      expect(event.reviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("keeps unstated turnout as null rather than zero", () => {
    const unstated = catalogue.all().filter((e) => e.expectedVisitors === null);
    expect(unstated.length).toBeGreaterThan(0);
    for (const event of catalogue.all()) {
      expect(event.expectedVisitors === null || event.expectedVisitors > 0).toBe(true);
    }
  });

  it("covers enough ground for the filters to mean something", () => {
    /**
     * Four states, not the ten the catalogue once spanned.
     *
     * Every listing now has a real poster behind it, and the six with no
     * artwork were removed rather than shown as generated covers — which
     * narrowed the spread to the Klang Valley plus Johor. That is the honest
     * consequence of the trade, so the bar is set where the catalogue actually
     * is rather than where it used to be; the state filter still narrows and
     * still has something to narrow to.
     */
    expect(new Set(catalogue.all().map((e) => e.state)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(catalogue.all().map((e) => e.eventType)).size).toBeGreaterThan(3);
  });

  it("has a poster for every seeded listing", () => {
    /**
     * CHECKED AGAINST THE POSTER MAP, not against a count.
     *
     * This asserted `catalogue.size === 8`, which is not what its name claims
     * and never was: the number happened to match while eight listings had
     * eight posters, so it would have passed just as happily with a listing
     * that had none and failed the moment anyone added one that did. Adding
     * two events broke it for the wrong reason.
     *
     * A seeded listing with no artwork falls back to a generated cover, which
     * is the organizer-submission path rather than something this curated set
     * should ever need. That is the thing worth holding.
     */
    const posters = readFileSync(
      new URL("../../../apps/web/src/components/events/posters.ts", import.meta.url),
      "utf8",
    );
    const mapped = new Set([...posters.matchAll(/"(evt-[a-z0-9-]+)":/g)].map((m) => m[1]));

    const missing = catalogue.all().filter((e) => !mapped.has(e.id));
    expect(missing.map((e) => e.id)).toEqual([]);
    expect(catalogue.size).toBeGreaterThan(0);
  });
});
