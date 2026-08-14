import type { LocationScore, ScoreKind } from "./score.js";
import { r2 } from "./basis.js";

/**
 * Side-by-side comparison — Feature 2.
 *
 * This is what the Success Score was built for. A 34 means little on its own;
 * 34 against 58 is a decision. Everything here is pure ranking over scores
 * that have already been computed.
 *
 * The comparison inherits every caveat from the score and must not launder
 * them. In particular it refuses to crown a winner on a difference too small
 * to mean anything, and it never treats "neither has data" as a tie.
 */

/**
 * Below this many points apart, two scores are indistinguishable given what
 * they are built from — a blend of proxies, none validated. Declaring a winner
 * on 86 against 87 would invent precision the inputs do not have.
 */
export const TOO_CLOSE_POINTS = 5;

export interface ComparedLocation {
  id: string;
  label: string;
  score: LocationScore;
}

export type DimensionOutcome =
  | { kind: "winner"; winnerId: string; spread: number }
  | { kind: "tooClose"; spread: number }
  | { kind: "noData" };

export interface DimensionComparison {
  key: string;
  label: string;
  /** Per location, in the order given. Null where that location has no data. */
  scores: { id: string; score: number | null; kind: ScoreKind }[];
  outcome: DimensionOutcome;
}

export interface Comparison {
  /** Best first. Locations tied within the threshold keep their input order. */
  ranking: { id: string; label: string; overall: number }[];
  dimensions: DimensionComparison[];
  /** Null when the top two are too close to separate honestly. */
  winnerId: string | null;
  overallSpread: number;
}

export function compareLocations(locations: ComparedLocation[]): Comparison {
  if (locations.length === 0) {
    return { ranking: [], dimensions: [], winnerId: null, overallSpread: 0 };
  }

  const ranking = [...locations]
    .sort((a, b) => b.score.overall - a.score.overall)
    .map((l) => ({ id: l.id, label: l.label, overall: l.score.overall }));

  const overallSpread = r2((ranking[0]?.overall ?? 0) - (ranking[ranking.length - 1]?.overall ?? 0));

  // A single location has nothing to compare against, so no winner either.
  const decisive = ranking.length > 1 && overallSpread >= TOO_CLOSE_POINTS;

  // Dimension keys come from the first location; every score has the same
  // shape, so this is stable.
  const keys = locations[0]!.score.dimensions.map((d) => ({ key: d.key, label: d.label }));

  const dimensions: DimensionComparison[] = keys.map(({ key, label }) => {
    const scores = locations.map((l) => {
      const dimension = l.score.dimensions.find((d) => d.key === key);
      return {
        id: l.id,
        // Null rather than 0: "no data" and "scored zero" are different
        // claims, and collapsing them would show a tie at the bottom.
        score: dimension && dimension.kind !== "unavailable" ? dimension.score : null,
        kind: dimension?.kind ?? ("unavailable" as ScoreKind),
      };
    });

    const measured = scores.filter((s) => s.score !== null) as {
      id: string;
      score: number;
      kind: ScoreKind;
    }[];

    // Rent sensitivity is missing everywhere until 1e, so this is the common
    // case, not an edge case.
    if (measured.length === 0) return { key, label, scores, outcome: { kind: "noData" } };

    // One side having data is not a win — there is nothing to beat.
    if (measured.length === 1) return { key, label, scores, outcome: { kind: "noData" } };

    const best = measured.reduce((a, b) => (b.score > a.score ? b : a));
    const worst = measured.reduce((a, b) => (b.score < a.score ? b : a));
    const spread = r2(best.score - worst.score);

    return {
      key,
      label,
      scores,
      outcome:
        spread >= TOO_CLOSE_POINTS
          ? { kind: "winner", winnerId: best.id, spread }
          : { kind: "tooClose", spread },
    };
  });

  return {
    ranking,
    dimensions,
    winnerId: decisive ? (ranking[0]?.id ?? null) : null,
    overallSpread,
  };
}
