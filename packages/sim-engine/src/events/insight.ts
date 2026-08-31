import type { ScoreDimension } from "../score.js";
import type { EventScore } from "./score.js";

/**
 * "Why this event?" — the match, explained.
 *
 * DERIVED FROM THE SCORE, NEVER WRITTEN BY A MODEL, and that is the whole
 * design. This sentence sits directly on top of the figures it describes, so a
 * generated one could contradict the very number beside it — the same reason
 * the PDF cover summary is derived rather than prompted. It also costs nothing
 * and cannot fail, which is what lets it render on every card in the grid
 * rather than behind a button and a spend limit.
 *
 * It reads the dimensions the engine already produced and says which one is
 * carrying the match and which is dragging it — the two facts a vendor
 * actually wants before clicking through. If a real narration is ever wanted,
 * Gemini can paraphrase THIS rather than compute its own; the shape stays
 * honest either way.
 */

export interface MatchInsight {
  /** One sentence, safe to print beside the score. */
  headline: string;
  /** The dimension carrying the match. Null when nothing scored well. */
  strength: ScoreDimension | null;
  /** The dimension holding it back. Null when nothing is notably weak. */
  drag: ScoreDimension | null;
  tone: "strong" | "mixed" | "weak";
}

/** Plain-language stem per dimension, phrased as the reason it helps. */
const STRENGTH: Record<string, string> = {
  categoryFit: "the organizer is recruiting exactly what you sell",
  boothAffordability: "the booth sits comfortably inside your budget",
  vendorCompetition: "few other stalls will be chasing the same shoppers",
  travel: "it is close to where you are based",
  catchment: "it sits in a densely populated area",
  visitorDraw: "the organizer expects a big crowd per booth",
};

/** And the reason it hurts. Deliberately not the negation of the above. */
const DRAG: Record<string, string> = {
  categoryFit: "the organizer is mainly after other kinds of vendor",
  boothAffordability: "the booth is expensive relative to your budget",
  vendorCompetition: "a lot of stalls will be competing for the same shoppers",
  travel: "it is a long way from your base",
  catchment: "few people live around the venue",
  visitorDraw: "the expected crowd is thin once split across the booths",
};

/** Above this a dimension is worth praising; below it, worth warning about. */
const GOOD = 70;
const POOR = 45;

export function matchInsight(score: EventScore): MatchInsight {
  const scored = score.dimensions.filter((d) => d.kind !== "unavailable");

  if (scored.length === 0) {
    return {
      headline: "Not enough is known about this event to judge the match.",
      strength: null,
      drag: null,
      tone: "weak",
    };
  }

  /**
   * Ranked by CONTRIBUTION, not by raw score.
   *
   * A dimension scoring 100 on a 0.08 weight is not what is carrying the
   * match; one scoring 80 on a 0.28 weight is. Sorting on score alone would
   * keep crediting the axis the engine trusts least.
   */
  const byContribution = [...scored].sort((a, b) => b.score * b.weight - a.score * a.weight);
  const byShortfall = [...scored].sort(
    (a, b) => (100 - b.score) * b.weight - (100 - a.score) * a.weight,
  );

  const strength = byContribution[0] ?? null;
  const worst = byShortfall[0] ?? null;
  const drag = worst && worst.score < POOR ? worst : null;

  const tone: MatchInsight["tone"] =
    score.overall >= GOOD ? "strong" : score.overall >= POOR ? "mixed" : "weak";

  /**
   * A strength has to clear the GOOD bar, not merely avoid being poor.
   *
   * Testing this at the POOR threshold called a 50-out-of-100 category fit
   * "a good fit: the organizer is recruiting exactly what you sell", which
   * overstates a middling number sitting right next to it on the card.
   */
  const good = strength && strength.score >= GOOD ? STRENGTH[strength.key] : null;
  const bad = drag ? DRAG[drag.key] : null;

  let headline: string;
  if (good && bad) {
    headline = `Strong on ${dimensionWord(strength!)} — ${good} — but ${bad}.`;
  } else if (good) {
    headline = `A good fit: ${good}.`;
  } else if (bad) {
    headline = `Worth a closer look: ${bad}.`;
  } else {
    headline = "A middling match on every measure — nothing stands out either way.";
  }

  return { headline, strength, drag, tone };
}

/** The dimension's label, lowercased for mid-sentence use. */
function dimensionWord(d: ScoreDimension): string {
  return d.label.toLowerCase();
}
