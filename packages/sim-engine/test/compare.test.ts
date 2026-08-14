import { describe, expect, it } from "vitest";
import { compareLocations, TOO_CLOSE_POINTS, type ComparedLocation } from "../src/compare.js";
import type { LocationScore, ScoreKind } from "../src/score.js";

/**
 * The comparison must inherit the score's caution rather than laundering it.
 * Two proxy-built numbers a point apart do not identify a better location.
 */

const score = (
  overall: number,
  dims: Partial<Record<string, [number, ScoreKind]>> = {},
): LocationScore => ({
  overall,
  completeness: 0.8,
  dimensions: [
    ["competition", "Competition"],
    ["footfall", "Est. monthly demand"],
    ["catchment", "Revenue potential"],
    ["rent", "Rent sensitivity"],
  ].map(([key, label]) => {
    // Rent defaults to unavailable because that is reality until 1e lands —
    // a fixture that pretends otherwise would test a state the app never has.
    const fallback: [number, ScoreKind] =
      key === "rent" ? [0, "unavailable"] : [50, "direct"];
    const [s, kind] = dims[key as string] ?? fallback;
    return { key: key as string, label: label as string, score: s, kind, weight: 0.25, note: "" };
  }),
});

const loc = (id: string, overall: number, dims = {}): ComparedLocation => ({
  id,
  label: id.toUpperCase(),
  score: score(overall, dims),
});

const outcomeFor = (result: ReturnType<typeof compareLocations>, key: string) =>
  result.dimensions.find((d) => d.key === key)!.outcome;

describe("overall ranking", () => {
  it("orders best first and names a clear winner", () => {
    const result = compareLocations([loc("kl", 34), loc("pj", 58)]);

    expect(result.ranking.map((r) => r.id)).toEqual(["pj", "kl"]);
    expect(result.winnerId).toBe("pj");
    expect(result.overallSpread).toBe(24);
  });

  it("refuses to crown a winner on a difference too small to mean anything", () => {
    // 58 vs 60 is noise from a blend of unvalidated proxies.
    const result = compareLocations([loc("a", 58), loc("b", 60)]);

    expect(result.winnerId).toBeNull();
    expect(result.overallSpread).toBe(2);
    // Still ranked, so the UI can order them — just not declared a winner.
    expect(result.ranking[0]?.id).toBe("b");
  });

  it("treats exactly the threshold as decisive", () => {
    const result = compareLocations([loc("a", 50), loc("b", 50 + TOO_CLOSE_POINTS)]);
    expect(result.winnerId).toBe("b");
  });

  it("handles three locations", () => {
    const result = compareLocations([loc("a", 40), loc("c", 70), loc("b", 55)]);
    expect(result.ranking.map((r) => r.id)).toEqual(["c", "b", "a"]);
    expect(result.winnerId).toBe("c");
  });

  it("never names a winner with only one location", () => {
    const result = compareLocations([loc("only", 90)]);
    expect(result.winnerId).toBeNull();
    expect(result.ranking).toHaveLength(1);
  });

  it("handles an empty comparison without throwing", () => {
    const result = compareLocations([]);
    expect(result.ranking).toEqual([]);
    expect(result.winnerId).toBeNull();
  });
});

describe("per-dimension outcomes", () => {
  it("names the winner on a dimension with a real gap", () => {
    const result = compareLocations([
      loc("kl", 34, { competition: [10, "direct"] }),
      loc("pj", 58, { competition: [80, "direct"] }),
    ]);

    expect(outcomeFor(result, "competition")).toEqual({
      kind: "winner",
      winnerId: "pj",
      spread: 70,
    });
  });

  it("reports a narrow dimension gap as too close", () => {
    const result = compareLocations([
      loc("a", 50, { catchment: [86, "proxy"] }),
      loc("b", 50, { catchment: [87, "proxy"] }),
    ]);
    expect(outcomeFor(result, "catchment")).toEqual({ kind: "tooClose", spread: 1 });
  });

  it("reports no data when the dimension is missing on BOTH sides", () => {
    // Rent is unavailable everywhere until 1e — the common case.
    const result = compareLocations([loc("a", 50), loc("b", 60)]);
    expect(outcomeFor(result, "rent")).toEqual({ kind: "noData" });
  });

  it("does not treat one-sided data as a win", () => {
    // Having data is not beating anything; there is nothing to compare to.
    const result = compareLocations([
      loc("a", 50, { footfall: [90, "proxy"] }),
      loc("b", 50, { footfall: [0, "unavailable"] }),
    ]);
    expect(outcomeFor(result, "footfall")).toEqual({ kind: "noData" });
  });

  it("reports a missing score as null, never as zero", () => {
    // Collapsing "no data" into 0 would show a fake tie at the bottom.
    const result = compareLocations([loc("a", 50), loc("b", 60)]);
    const rent = result.dimensions.find((d) => d.key === "rent")!;

    expect(rent.scores.every((s) => s.score === null)).toBe(true);
    expect(rent.scores.every((s) => s.kind === "unavailable")).toBe(true);
  });

  it("keeps scores in the input order so columns line up with the table", () => {
    const result = compareLocations([loc("first", 40), loc("second", 90)]);
    for (const dimension of result.dimensions) {
      expect(dimension.scores.map((s) => s.id)).toEqual(["first", "second"]);
    }
  });
});
