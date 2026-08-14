import { describe, expect, it } from "vitest";
import { allowedNumbers, checkNumbers, numbersIn } from "../src/chat/guard.js";

/**
 * The numeric guard — Feature 3.
 *
 * This is the mechanism that turns "Gemini never does arithmetic" from a line
 * in a prompt into something enforced. It gets the hardest tests in the
 * feature, because the failure it prevents — a plausible invented figure
 * sitting next to real ones — is the worst thing this product could do.
 */

const FACTS = [
  "Success score: 40 / 100 (100% of the profile measured)",
  "Competition: 0 (measured). 20+ competitors, ~316 per km2.",
  "Competitor quality: 32 (measured). Competitors average 4.23.",
  "Rent: RM 9,600/month, break-even 71/day.",
  "Complete to about 142m.",
  "Working age 1,577,400 (76% of residents).",
].join("\n");

describe("extracting numbers", () => {
  it("reads the formats the fact sheet emits", () => {
    expect(numbersIn("RM 9,600/month")).toEqual([9600]);
    expect(numbersIn("40 / 100")).toEqual([40, 100]);
    expect(numbersIn("142m")).toEqual([142]);
    expect(numbersIn("76% of residents")).toEqual([76]);
    expect(numbersIn("average 4.23")).toEqual([4.23]);
    expect(numbersIn("1,577,400 people")).toEqual([1577400]);
  });

  it("finds nothing in prose without figures", () => {
    expect(numbersIn("The competition here is dense.")).toEqual([]);
  });

  it("treats a thousands separator and a bare number as the same figure", () => {
    // Otherwise "RM 9,600" in the facts would not authorise "9600" in the
    // answer, and the guard would refuse a correct quotation.
    expect(numbersIn("9,600")).toEqual(numbersIn("9600"));
  });
});

describe("what an answer is allowed to say", () => {
  it("permits every figure from the facts", () => {
    const allowed = allowedNumbers(FACTS, "");
    for (const value of [40, 100, 0, 316, 32, 4.23, 9600, 71, 142, 76]) {
      expect(allowed.has(value)).toBe(true);
    }
  });

  it("permits figures the user typed themselves", () => {
    // Refusing these would stop the assistant repeating a question back.
    expect(allowedNumbers(FACTS, "what about 1000m?").has(1000)).toBe(true);
  });

  it("permits small ordinals for counting", () => {
    const allowed = allowedNumbers(FACTS, "");
    // "one of the five dimensions", "the top 3".
    for (const value of [1, 3, 5, 12]) expect(allowed.has(value)).toBe(true);
    expect(allowed.has(13)).toBe(false);
  });
});

describe("refusing computed figures", () => {
  it("passes an answer that only quotes the facts", () => {
    const answer =
      "It scores 40 out of 100. Competition is the weakest dimension at 0, with 20+ rivals " +
      "and rent of RM 9,600 a month.";
    expect(checkNumbers(answer, FACTS, "why so low?").ok).toBe(true);
  });

  /**
   * The exact failure this guard exists for: arithmetic dressed as a finding.
   * Nothing in the facts says 58, and a reader has no way to tell it apart
   * from the figures that are real.
   */
  it("refuses a figure the panels never produced", () => {
    const result = checkNumbers(
      "Competition scores 0 against a typical 58, so this is unusually crowded.",
      FACTS,
      "why so low?",
    );

    expect(result.ok).toBe(false);
    expect(result.unsupported).toContain(58);
  });

  it("refuses a percentage the model worked out itself", () => {
    const result = checkNumbers(
      "Rent takes about 23% of projected revenue.",
      FACTS,
      "is the rent high?",
    );

    expect(result.ok).toBe(false);
    expect(result.unsupported).toContain(23);
  });

  it("refuses a total the model summed", () => {
    const result = checkNumbers("The five dimensions total 230 points.", FACTS, "");
    expect(result.ok).toBe(false);
    expect(result.unsupported).toContain(230);
  });

  it("names every unsupported figure, not just the first", () => {
    const result = checkNumbers("Between 55 and 65, call it 60.", FACTS, "");
    expect(result.unsupported).toEqual([55, 65, 60]);
  });

  /**
   * The fact sheet carries 4.23; an answer saying "4.2" is rendering a real
   * measurement at lower precision, not making a new claim.
   */
  it("allows a fact rounded down to fewer decimals", () => {
    expect(checkNumbers("Rivals average 4.2 stars.", FACTS, "").ok).toBe(true);
  });

  it("does not allow precision that was never measured", () => {
    // Nothing in the facts supports 40.7 — the score is a whole 40.
    const result = checkNumbers("It scores 40.7 out of 100.", FACTS, "");
    expect(result.ok).toBe(false);
    expect(result.unsupported).toContain(40.7);
  });

  it("passes an answer with no figures at all", () => {
    expect(checkNumbers("Competition is the weakest dimension here.", FACTS, "").ok).toBe(true);
  });

  it("still applies when the facts are empty", () => {
    // A location with nothing resolved must not become a licence to invent.
    const result = checkNumbers("The score is 72.", "", "");
    expect(result.ok).toBe(false);
    expect(result.unsupported).toContain(72);
  });
});
