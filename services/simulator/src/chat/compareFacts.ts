import { compareLocations, formatNumber, scoreLocation, resolveRent } from "@spotential/sim-engine";
import type { ComparedLocation, Comparison } from "@spotential/sim-engine";
import type { LocationReportInput } from "../report/model.js";
import { buildFacts } from "./facts.js";

/**
 * The grounded fact sheet for a COMPARISON.
 *
 * PURE, and the single source of everything the three agents and the ask
 * route are allowed to say. Same contract as `buildFacts`: it is built by the
 * engine the panels use, so a figure here is by construction the figure on
 * screen, and it is also what the numeric guard checks against.
 *
 * ONE FUNCTION, not two. The prose and the allow-set have to come out of the
 * same build or they drift, and a drifted guard either refuses correct answers
 * or waves through invented ones.
 *
 * WHAT IS NOT KNOWN IS STATED EXPLICITLY, and on this page that matters more
 * than on a single location: a comparison with three of five dimensions
 * unscored is still a comparison, and a model given only the two that scored
 * will happily present them as the whole picture.
 */

/** The scores, the comparison, and the per-location sheets, built once. */
export interface ComparisonModel {
  compared: ComparedLocation[];
  comparison: Comparison;
}

/**
 * Scored the same way `/compare` scores in the browser, which is the property
 * that makes client and server agree: one implementation, called twice.
 */
export function modelComparison(locations: LocationReportInput[]): ComparisonModel {
  const compared: ComparedLocation[] = locations.map((input, index) => {
    const rent = resolveRent(
      input.point,
      input.category,
      input.rentOverride && input.rentOverride > 0 ? { monthlyRent: input.rentOverride } : undefined,
    );

    return {
      id: `loc-${index}`,
      label: input.label,
      score: scoreLocation({
        competitors: input.competitors,
        truncated: input.truncated,
        completeToMetres: input.completeToMetres,
        radiusMetres: input.radiusMetres,
        demographics: input.demographics,
        catchment: input.catchment ?? null,
        rent,
        category: input.category,
        point: input.point,
      }),
    };
  });

  return { compared, comparison: compareLocations(compared) };
}

export function buildComparisonFacts(
  locations: LocationReportInput[],
  model: ComparisonModel = modelComparison(locations),
): string {
  const { compared, comparison } = model;
  const lines: string[] = [];

  lines.push(
    `COMPARISON OF ${compared.length} LOCATIONS: ${compared.map((c) => c.label).join(", ")}.`,
    "Every location below was searched with the SAME business type and the SAME radius.",
    "Comparing different categories or radii would not be a comparison, so the page makes that unreachable.",
    "",
    "RANKING",
  );

  for (const [index, entry] of comparison.ranking.entries()) {
    lines.push(`${index + 1}. ${entry.label}: ${Math.round(entry.overall)} out of 100.`);
  }

  lines.push(
    "",
    comparison.winnerId
      ? `VERDICT: ${
          compared.find((c) => c.id === comparison.winnerId)?.label ?? "the leader"
        } scores highest, by ${formatNumber(comparison.overallSpread, 1)} points.`
      : `VERDICT: TOO CLOSE TO CALL. The overall spread is ${formatNumber(
          comparison.overallSpread,
          1,
        )} points, which is inside what these figures can support. These sites must be treated as equivalent on this evidence.`,
    "The page already states this verdict itself. Do not repeat it back as if it were your finding.",
    "",
    "DIMENSION BY DIMENSION",
  );

  const unscored: string[] = [];

  for (const dimension of comparison.dimensions) {
    const outcome = dimension.outcome;
    const cells = dimension.scores
      .map((cell) => {
        const label = compared.find((c) => c.id === cell.id)?.label ?? cell.id;
        return `${label} ${cell.score === null ? "no data" : Math.round(cell.score)}`;
      })
      .join(", ");

    if (outcome.kind === "noData") {
      unscored.push(dimension.label);
      lines.push(
        `- ${dimension.label}: NOT SCORED on any site. Excluded from every total rather than counted as zero.`,
      );
      continue;
    }

    const verdict =
      outcome.kind === "winner"
        ? `${
            compared.find((c) => c.id === outcome.winnerId)?.label ?? "one site"
          } leads by ${formatNumber(Math.abs(outcome.spread), 1)} points`
        : `too close to call, ${formatNumber(
            Math.abs(outcome.spread),
            1,
          )} points apart, which is inside what these figures support`;

    lines.push(`- ${dimension.label}: ${cells}. ${verdict}.`);
  }

  /**
   * The weight the surviving axes are carrying.
   *
   * Stated as a fact rather than left for the model to notice, because it is
   * the single most misleading thing about a sparse comparison: two measured
   * dimensions deciding a verdict reads exactly like five did.
   */
  if (unscored.length > 0) {
    lines.push(
      "",
      "WHAT IS NOT KNOWN",
      `${unscored.length} of ${comparison.dimensions.length} dimensions could not be scored on any site: ${unscored.join(", ")}.`,
      `The verdict above therefore rests on the ${
        comparison.dimensions.length - unscored.length
      } dimensions that did score, which carry more weight here than they would on a fully measured site.`,
      "Excluded is NOT the same as zero. Nothing may be said about an unscored dimension beyond that it is unscored.",
    );
  } else {
    lines.push("", "WHAT IS NOT KNOWN", "Every dimension scored on at least one site.");
  }

  lines.push(
    "No seasonal data, no footfall counts, no transacted rents and no revenue history exist for any of these sites.",
    "Rent figures are researched benchmarks unless the user entered their own quote, so that dimension is indicative.",
    "",
    "EACH LOCATION IN FULL",
    "",
  );

  // The per-location sheets, verbatim from the single-location builder, so a
  // figure the assistant may cite here is the same figure /analysis would use.
  for (const input of locations) {
    lines.push(`--- ${input.label} ---`, buildFacts(input), "");
  }

  return lines.join("\n");
}
