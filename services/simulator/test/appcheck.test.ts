import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { callerIdOf } from "../src/appcheck.js";
import { InMemoryCompetitorStore } from "../src/competitors/store.js";
import { seedScenario } from "@spotential/sim-engine";

/**
 * App Check gates the routes that cost money, and only those.
 *
 * There is no private data in this product; what needs defending is the Gemini
 * and Places bills. Gating the free routes as well would break CI's parity
 * suite and buy nothing.
 */

const APP_CHECK = { projectNumber: "388936868171", smokeKey: "test-smoke-key" };
const inputs = seedScenario("korean_restaurant", "mont_kiara");

const app = buildApp({
  appCheck: APP_CHECK,
  competitorStore: new InMemoryCompetitorStore(),
});
afterAll(async () => {
  await app.close();
});

const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url, payload: payload as object, headers });

describe("paid routes are gated", () => {
  const paid: [string, unknown][] = [
    ["/v1/simulate/ask", { inputs, question: "what if demand drops 20%?" }],
    ["/v1/competitors", { lat: 3.15, lng: 101.71, radiusMetres: 500, category: "other_fnb" }],
    ["/v1/opportunity-gaps", { lat: 3.15, lng: 101.71, radiusMetres: 500 }],
  ];

  for (const [url, payload] of paid) {
    it(`${url} refuses a request with no App Check token`, async () => {
      const res = await post(url, payload);
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe("app_check_required");
    });

    it(`${url} refuses a malformed token rather than trusting it`, async () => {
      const res = await post(url, payload, { "x-firebase-appcheck": "not-a-jwt" });
      expect(res.statusCode).toBe(401);
    });

    it(`${url} refuses a well-formed JWT signed by nobody`, async () => {
      // A three-segment token that parses but has no valid signature. The
      // verifier must reject it, not merely check the shape.
      const forged =
        "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9." +
        Buffer.from(JSON.stringify({ aud: ["projects/388936868171"], sub: "x" })).toString(
          "base64url",
        ) +
        ".c2lnbmF0dXJl";
      const res = await post(url, payload, { "x-firebase-appcheck": forged });
      expect(res.statusCode).toBe(401);
    });
  }
});

describe("free routes stay open", () => {
  it("/v1/simulate needs no token — it costs nothing and CI's parity suite calls it", async () => {
    const res = await post("/v1/simulate", { inputs });
    expect(res.statusCode).toBe(200);
  });

  it("/v1/demographics needs no token — static files, zero marginal cost", async () => {
    const res = await post("/v1/demographics", { lat: 3.15, lng: 101.71 });
    // 503 because no data is loaded in this test app; the point is it is not 401.
    expect(res.statusCode).not.toBe(401);
  });

  it("/health stays probeable and reports enforcement", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().backends.appCheck).toBe("enforced");
  });
});

describe("the smoke key", () => {
  it("lets CI through the App Check gate", async () => {
    const res = await post(
      "/v1/competitors",
      { lat: 3.15, lng: 101.71, radiusMetres: 500, category: "other_fnb" },
      { "x-smoke-key": "test-smoke-key" },
    );
    expect(res.statusCode).toBe(200);
  });

  it("rejects a wrong smoke key", async () => {
    const res = await post(
      "/v1/competitors",
      { lat: 3.15, lng: 101.71, radiusMetres: 500, category: "other_fnb" },
      { "x-smoke-key": "guessed" },
    );
    expect(res.statusCode).toBe(401);
  });
});

describe("an unconfigured app leaves the routes open", () => {
  // Only correct for local development and tests; production always sets it,
  // and server.js warns loudly when it does not.
  it("does not gate when appCheck is absent", async () => {
    const open = buildApp({ competitorStore: new InMemoryCompetitorStore() });
    const res = await open.inject({
      method: "POST",
      url: "/v1/competitors",
      payload: { lat: 3.15, lng: 101.71, radiusMetres: 500, category: "other_fnb" },
    });
    expect(res.statusCode).toBe(200);
    expect((await open.inject({ method: "GET", url: "/health" })).json().backends.appCheck).toBe(
      "off",
    );
    await open.close();
  });
});

describe("callerIdOf", () => {
  const req = (headers: Record<string, string>) =>
    ({ headers, ip: "10.0.0.1" }) as never;

  it("prefers the anonymous UID so one carrier NAT is not one caller", () => {
    expect(callerIdOf(req({ "x-spotential-uid": "abc123XYZ_def" }))).toBe("uid:abc123XYZ_def");
  });

  it("falls back to the forwarded IP", () => {
    expect(callerIdOf(req({ "x-forwarded-for": "203.0.113.9, 10.1.1.1" }))).toBe("ip:203.0.113.9");
  });

  it("ignores a malformed UID rather than keying quota on junk", () => {
    expect(callerIdOf(req({ "x-spotential-uid": "../../etc/passwd" }))).toBe("ip:10.0.0.1");
    expect(callerIdOf(req({ "x-spotential-uid": "short" }))).toBe("ip:10.0.0.1");
  });
});
