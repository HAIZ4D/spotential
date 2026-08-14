import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { DemographicsLookup } from "../src/demographics.js";
import { buildApp } from "../src/app.js";

/**
 * Resolving a pin to the wrong district means showing demographics for the
 * wrong two million people, so these run against the REAL data files rather
 * than fixtures.
 */

const DATA_DIR = join(process.cwd(), "services", "simulator", "data");

let lookup: DemographicsLookup;
beforeAll(async () => {
  lookup = await DemographicsLookup.load(DATA_DIR);
});

describe("the dataset itself", () => {
  it("covers every district DOSM publishes", () => {
    expect(lookup.districtCount).toBe(160);
  });

  it("is the 2025 vintage", () => {
    expect(lookup.vintage).toBe("2025");
  });
});

describe("resolving real places", () => {
  const cases: [string, number, number, string][] = [
    ["central KL", 3.1478, 101.6953, "W.P. Kuala Lumpur"],
    ["Mont Kiara", 3.1707, 101.6505, "W.P. Kuala Lumpur"],
    ["Kota Kinabalu", 5.9749, 116.0724, "Kota Kinabalu"],
    ["Batu Pahat", 1.8548, 102.9325, "Batu Pahat"],
    ["George Town", 5.4141, 100.3288, "Timur Laut"],
  ];

  for (const [label, lat, lng, expected] of cases) {
    it(`${label} resolves to ${expected}`, () => {
      const result = lookup.find({ lat, lng });
      expect(result.matched).toBe(true);
      expect(result.demographics?.district).toBe(expected);
    });
  }

  it("gives KL a plausible population", () => {
    const kl = lookup.find({ lat: 3.1478, lng: 101.6953 }).demographics;
    // ~2.07M in the 2025 data. Wide bounds: this is a sanity check, not a
    // golden vector — DOSM revises it annually.
    expect(kl?.total).toBeGreaterThan(1_500_000);
    expect(kl?.total).toBeLessThan(3_000_000);
  });

  it("returns age bands and ethnicities that roughly reconcile to the total", () => {
    const kl = lookup.find({ lat: 3.1478, lng: 101.6953 }).demographics!;
    const ageSum = Object.values(kl.age).reduce((a, b) => a + b, 0);
    const ethSum = Object.values(kl.ethnicity).reduce((a, b) => a + b, 0);

    // DOSM publishes to 0.1 thousand, so components round to within a few
    // hundred of the total rather than matching exactly.
    expect(Math.abs(ageSum - kl.total)).toBeLessThan(2_000);
    expect(Math.abs(ethSum - kl.total)).toBeLessThan(2_000);
  });
});

describe("points with no district", () => {
  it("reports no match in the South China Sea rather than guessing", () => {
    const result = lookup.find({ lat: 5.0, lng: 110.0 });
    expect(result.matched).toBe(false);
    expect(result.resolution).toBe("none");
    expect(result.demographics).toBeNull();
  });

  it("reports no match well outside Malaysia", () => {
    expect(lookup.find({ lat: 51.5072, lng: -0.1276 }).matched).toBe(false);
    expect(lookup.find({ lat: -6.2088, lng: 106.8456 }).matched).toBe(false);
  });

  it("still reports the data vintage on a miss", () => {
    const result = lookup.find({ lat: 51.5072, lng: -0.1276 });
    expect(result.vintage).toBe("2025");
  });
});

describe("POST /v1/demographics", () => {
  const app = buildApp({ demographics: undefined });
  afterAll(async () => {
    await app.close();
  });

  it("reports unavailable rather than 500ing when data is not loaded", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/demographics",
      payload: { lat: 3.1478, lng: 101.6953 },
    });
    expect(res.statusCode).toBe(503);
  });
});

describe("POST /v1/demographics with data", () => {
  let app: ReturnType<typeof buildApp>;
  beforeAll(async () => {
    app = buildApp({ demographics: await DemographicsLookup.load(DATA_DIR) });
  });
  afterAll(async () => {
    await app.close();
  });

  it("returns the district for a valid point", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/demographics",
      payload: { lat: 3.1478, lng: 101.6953 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().demographics.district).toBe("W.P. Kuala Lumpur");
    expect(res.json().matched).toBe(true);
  });

  it("rejects invalid coordinates", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/demographics",
      payload: { lat: 999, lng: 101 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns matched:false for a point outside Malaysia", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/demographics",
      payload: { lat: 51.5072, lng: -0.1276 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().matched).toBe(false);
  });
});
