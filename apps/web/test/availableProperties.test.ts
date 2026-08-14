import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MUDAH_REGIONS,
  PORTALS,
  searchTerm,
  stateLabel,
} from "../src/components/analysis/AvailableProperties.js";

/**
 * Available properties — the outbound portal searches in the Rent tab.
 *
 * These test the URL BUILDERS, never the portals themselves. The forms were
 * verified by hand against the live sites (see the component's comments for
 * what was measured); what can regress silently afterwards is the mapping
 * code, and that is what is pinned here.
 */

const guru = PORTALS.find((p) => p.id === "propertyguru")!;
const mudah = PORTALS.find((p) => p.id === "mudah")!;

describe("searchTerm", () => {
  it("keeps a plain trading area intact", () => {
    expect(searchTerm("Bangsar")).toBe("Bangsar");
    expect(searchTerm("Mont Kiara")).toBe("Mont Kiara");
  });

  it("takes the first place named and drops the city suffix", () => {
    // Measured: the full label returns 111 PropertyGuru cards, "Jalan TAR"
    // returns 1,064. The slash and the suffix each narrow the match badly.
    expect(searchTerm("Jalan TAR / Dang Wangi, KL")).toBe("Jalan TAR");
    expect(searchTerm("KLCC, KL")).toBe("KLCC");
    expect(searchTerm("SS15, Selangor")).toBe("SS15");
  });

  it("does not strip a city name that is the area itself", () => {
    expect(searchTerm("Kuala Lumpur")).toBe("Kuala Lumpur");
    expect(searchTerm("Johor Bahru")).toBe("Johor Bahru");
  });
});

describe("PropertyGuru", () => {
  it("uses the retail path, which is what actually filters to retail", () => {
    // The earlier `property-for-rent?...&property_type=C` was rewritten by
    // their 301 to `isCommercial=false` — the inverse — and returned
    // residential. This asserts the form that survives the redirect.
    const href = guru.href({ area: "KLCC", state: "W.P. Kuala Lumpur" });
    expect(href).toBe("https://www.propertyguru.com.my/retail-shops-for-rent?freetext=KLCC");
    expect(href).not.toContain("property_type");
    expect(href).not.toContain("isCommercial");
  });

  it("encodes an area with a space", () => {
    expect(guru.href({ area: "Mont Kiara", state: null })).toContain("freetext=Mont%20Kiara");
  });

  it("works without a state, because it searches by area", () => {
    expect(guru.href({ area: "Kuantan", state: null })).toContain("freetext=Kuantan");
  });

  it("carries no tracking parameters", () => {
    const href = guru.href({ area: "Bangsar", state: null })!;
    expect(href).not.toMatch(/utm_|gclid/);
  });
});

describe("Mudah", () => {
  it("searches the state region, not the area", () => {
    // Mudah implements its category as a freetext query, so adding the area
    // makes it "shop office AND klcc" — 2 ads against 80 for the region.
    const context = { area: "KLCC", state: "W.P. Kuala Lumpur" };
    expect(mudah.href(context)).toBe("https://www.mudah.my/kuala-lumpur/shop-office-for-rent");
    expect(mudah.href(context)).not.toContain("KLCC");
    expect(mudah.href(context)).not.toContain("?q=");
  });

  it("says statewide, so the link does not imply area precision", () => {
    expect(mudah.scope({ area: "KLCC", state: "W.P. Kuala Lumpur" })).toBe(
      "shop & office · Kuala Lumpur, statewide",
    );
  });

  it("drops out entirely rather than guessing when there is no state", () => {
    expect(mudah.href({ area: "KLCC", state: null })).toBeNull();
    expect(mudah.scope({ area: "KLCC", state: null })).toBeNull();
  });

  it("drops out for a state name it does not know", () => {
    expect(mudah.href({ area: "Somewhere", state: "Atlantis" })).toBeNull();
  });
});

describe("stateLabel", () => {
  it("writes the federal territories the way people say them", () => {
    expect(stateLabel("W.P. Kuala Lumpur")).toBe("Kuala Lumpur");
    expect(stateLabel("W.P. Putrajaya")).toBe("Putrajaya");
    expect(stateLabel("W.P. Labuan")).toBe("Labuan");
  });

  it("leaves an ordinary state alone", () => {
    expect(stateLabel("Selangor")).toBe("Selangor");
    expect(stateLabel("Pulau Pinang")).toBe("Pulau Pinang");
  });
});

/**
 * The regression this file mainly exists for.
 *
 * A state missing from the table does not throw and does not show an error —
 * the Mudah link just quietly disappears for everyone in that state. Read the
 * real DOSM reference data rather than a hand-copied list, so that a refresh
 * introducing or renaming a state fails here instead of in production.
 */
describe("Mudah region coverage", () => {
  const districts = JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../../../services/simulator/data/population-districts.json", import.meta.url)),
      "utf-8",
    ),
  ).districts as Record<string, { state: string }>;

  const states = [...new Set(Object.values(districts).map((d) => d.state))].sort();

  it("finds the sixteen states DOSM publishes", () => {
    expect(states).toHaveLength(16);
  });

  it.each(states)("maps %s to a Mudah region", (state) => {
    expect(MUDAH_REGIONS[state]).toBeTruthy();
  });

  it("has no slug that no DOSM state points at", () => {
    expect(Object.keys(MUDAH_REGIONS).sort()).toEqual(states);
  });
});
