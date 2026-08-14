import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { aiStudioTransport } from "../src/gemini.js";
import { QuotaTracker } from "../src/quota.js";
import { seedScenario } from "@spotential/sim-engine";

/**
 * The AI route's guard rails, tested WITHOUT calling Gemini.
 *
 * Everything here is about what happens around the model: validation, quota,
 * and the promise that a failing AI layer never takes the deterministic core
 * with it. The live model calls are exercised separately in the .ai suite.
 */

const inputs = seedScenario("korean_restaurant", "mont_kiara");

describe("POST /v1/simulate/ask — without Gemini configured", () => {
  const app = buildApp();
  afterAll(async () => {
    await app.close();
  });

  it("reports itself unavailable rather than crashing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/simulate/ask",
      payload: { inputs, question: "what if demand drops 20%?" },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("ai_unavailable");
  });

  it("still validates the scenario before worrying about the model", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/simulate/ask",
      payload: { inputs: { ...inputs, cogsPct: 40 }, question: "hello" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_scenario");
  });

  it("rejects an empty or oversized question", async () => {
    for (const question of ["", "   ", "x".repeat(501)]) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/simulate/ask",
        payload: { inputs, question },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("invalid_question");
    }
  });

  it("does not break the deterministic route", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/simulate", payload: { inputs } });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.breakEven.paybackMonth).toBe(7);
  });
});

describe("quota", () => {
  it("allows up to the per-caller limit then refuses", () => {
    const quota = new QuotaTracker({ perCallerPerDay: 3, globalPerDay: 100 });
    for (let i = 0; i < 3; i += 1) {
      expect(quota.check("caller-a").allowed).toBe(true);
      quota.record("caller-a");
    }
    const blocked = quota.check("caller-a");
    expect(blocked.allowed).toBe(false);
    expect(blocked.allowed === false && blocked.reason).toContain("still work");
  });

  it("keeps callers independent", () => {
    const quota = new QuotaTracker({ perCallerPerDay: 1, globalPerDay: 100 });
    quota.record("caller-a");
    expect(quota.check("caller-a").allowed).toBe(false);
    expect(quota.check("caller-b").allowed).toBe(true);
  });

  it("trips the global breaker even across many callers", () => {
    const quota = new QuotaTracker({ perCallerPerDay: 100, globalPerDay: 5 });
    for (let i = 0; i < 5; i += 1) quota.record(`caller-${i}`);
    const blocked = quota.check("caller-fresh");
    expect(blocked.allowed).toBe(false);
    expect(blocked.allowed === false && blocked.reason).toContain("everyone");
  });

  it("rolls over after a day", () => {
    const quota = new QuotaTracker({ perCallerPerDay: 1, globalPerDay: 10 });
    const now = Date.now();
    quota.record("caller-a", now);
    expect(quota.check("caller-a", now).allowed).toBe(false);
    expect(quota.check("caller-a", now + 25 * 60 * 60 * 1000).allowed).toBe(true);
  });

  it("prunes expired callers so the map does not grow forever", () => {
    const quota = new QuotaTracker({ perCallerPerDay: 5, globalPerDay: 100 });
    const now = Date.now();
    quota.record("caller-a", now);
    expect(quota.snapshot().callers).toBe(1);
    quota.prune(now + 25 * 60 * 60 * 1000);
    expect(quota.snapshot().callers).toBe(0);
  });
});

describe("quota is enforced before Gemini is ever called", () => {
  // The key is a placeholder: if the quota gate leaks, the request would try
  // to reach Gemini and fail differently, which is exactly what this asserts.
  const quota = new QuotaTracker({ perCallerPerDay: 0, globalPerDay: 100 });
  const app = buildApp({
    gemini: { transport: aiStudioTransport("not-a-real-key") },
    quota,
  });
  afterAll(async () => {
    await app.close();
  });

  it("returns 429 without spending a call", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/simulate/ask",
      payload: { inputs, question: "what if demand drops 20%?" },
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe("quota_exceeded");
  });
});
