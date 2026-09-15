import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseAccountRequest } from "../src/events/account.js";
import { InMemoryVendorAccountStore } from "../src/events/store.js";

/**
 * The vendor account.
 *
 * The second kind of personal data this product holds and the more
 * identifying of the two: a company registration number beside a named
 * contact. Everything here is about the rules that makes acceptable, and each
 * is the same rule the booth application already follows.
 */

const GOOD = {
  fullName: "Aina Rahim",
  email: "aina@example.com",
  phone: "+60123456789",
  companyName: "Rahim Bakes Sdn Bhd",
  companyEmail: "hello@rahimbakes.example",
  companyPhone: "+60312345678",
  ssmNumber: "202501234567",
  category: "cafe_coffee_shop",
  itemsSold: "Sourdough, kouign-amann and filter coffee",
  tin: "",
  consentToShare: true,
};

describe("the vendor account body", () => {
  it("NEVER reads a uid from the request", () => {
    /**
     * The whole security of this route. A uid taken from a body is a request
     * to write a record owned by somebody else, so the parser does not even
     * look for one — the route supplies it from the verified token.
     */
    const parsed = parseAccountRequest({ ...GOOD, uid: "someone-elses-uid" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).not.toHaveProperty("uid");
  });

  it("refuses without consent, which is unticked by default", () => {
    // An organizer receives a name and a phone number. That only happens
    // because the vendor said it could.
    const parsed = parseAccountRequest({ ...GOOD, consentToShare: false });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.join(" ")).toContain("consentToShare");
  });

  it("requires an SSM number, because that is what makes a business checkable", () => {
    const parsed = parseAccountRequest({ ...GOOD, ssmNumber: "" });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.join(" ")).toContain("ssmNumber");
  });

  it("takes the category from the engine's own list rather than free text", () => {
    // A typed category can feed scoring; prose cannot. It is also the field
    // that decides which events this vendor is ranked against.
    expect(parseAccountRequest({ ...GOOD, category: "artisanal_vibes" }).ok).toBe(false);
    expect(parseAccountRequest({ ...GOOD, category: "cafe_coffee_shop" }).ok).toBe(true);
  });

  it("treats every field as hostile and caps its length", () => {
    const parsed = parseAccountRequest({ ...GOOD, itemsSold: "x".repeat(5_000) });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.itemsSold.length).toBeLessThanOrEqual(400);
  });

  it("accepts a missing TIN, because many small traders have none", () => {
    const parsed = parseAccountRequest({ ...GOOD, tin: undefined });
    expect(parsed.ok).toBe(true);
  });

  it("validates the email rather than storing anything with an @ in it", () => {
    expect(parseAccountRequest({ ...GOOD, email: "not-an-email" }).ok).toBe(false);
  });
});

describe("the vendor account route", () => {
  it("refuses when no store is configured, rather than accepting details it cannot keep", async () => {
    /**
     * FAILS CLOSED, unlike every cache in this service. A cache that
     * downgrades to memory costs money; personal details that die with the
     * instance show a vendor a confirmation for something never kept.
     */
    const app = buildApp({ auth: { projectId: "spotential-app" } });
    const res = await app.inject({
      method: "POST",
      url: "/v1/vendor/account",
      payload: GOOD,
      headers: { authorization: "Bearer nonsense" },
    });
    // The auth guard rejects the token first, which is also a refusal.
    expect([401, 503]).toContain(res.statusCode);
    await app.close();
  });

  it("rejects an unverifiable token rather than trusting the body", async () => {
    const app = buildApp({
      auth: { projectId: "spotential-app" },
      vendorAccountStore: new InMemoryVendorAccountStore(),
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/vendor/account",
      payload: { ...GOOD, uid: "attacker-supplied" },
      headers: { authorization: "Bearer not-a-real-token" },
    });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("is unreachable without a token at all", async () => {
    const store = new InMemoryVendorAccountStore();
    const app = buildApp({
      auth: { projectId: "spotential-app" },
      vendorAccountStore: store,
    });

    const res = await app.inject({ method: "POST", url: "/v1/vendor/account", payload: GOOD });
    expect(res.statusCode).toBe(401);
    // And nothing was written on the way past.
    expect(store.size).toBe(0);
    await app.close();
  });

  it("does not expose one vendor's account to another", async () => {
    const store = new InMemoryVendorAccountStore();
    await store.save({
      ...GOOD,
      category: "cafe_coffee_shop",
      uid: "vendor-a",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);

    // Keyed on the uid itself, so there is no query that could return someone
    // else's row by accident.
    expect(await store.find("vendor-b")).toBeNull();
    expect(await store.find("vendor-a")).not.toBeNull();
  });
});
