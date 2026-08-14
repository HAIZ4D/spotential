import {
  CATEGORY_PRESETS,
  formatCurrency,
  formatNumber,
  formatPercent,
  resolveRent,
  rentSensitivity,
  scoreLocation,
} from "@spotential/sim-engine";
import type { LocationReportInput } from "../report/model.js";

/**
 * The grounded fact sheet — Feature 3.
 *
 * PURE, and the single source of everything the chatbot is allowed to say.
 * Built by the same engine the panels use, so a figure here is by construction
 * the figure on screen.
 *
 * It is also what the numeric guard checks against, which is why the prose and
 * the allow-set come out of ONE function rather than two: if they were built
 * separately they would drift, and a drifted guard either refuses correct
 * answers or waves through invented ones.
 *
 * WHAT IS NOT KNOWN IS STATED EXPLICITLY. A model given only positive facts
 * fills the silence; a model told "there is no seasonal data" declines instead.
 */

const KIND_WORD = {
  direct: "measured",
  proxy: "inferred",
  unavailable: "not available",
} as const;

const WORKING_AGE = [
  "15-19", "20-24", "25-29", "30-34", "35-39",
  "40-44", "45-49", "50-54", "55-59", "60-64",
];

export function buildFacts(input: LocationReportInput): string {
  const category = CATEGORY_PRESETS[input.category];
  const lines: string[] = [];

  lines.push(
    `LOCATION: ${input.label} at ${input.point.lat.toFixed(5)}, ${input.point.lng.toFixed(5)}.`,
    `BUSINESS TYPE BEING CONSIDERED: ${category.label}.`,
    `SEARCH RADIUS: ${formatNumber(input.radiusMetres)}m.`,
    "",
  );

  const rent = resolveRent(
    input.point,
    input.category,
    input.rentOverride && input.rentOverride > 0
      ? { monthlyRent: input.rentOverride }
      : undefined,
  );

  const score = scoreLocation({
    competitors: input.competitors,
    truncated: input.truncated,
    completeToMetres: input.completeToMetres,
    radiusMetres: input.radiusMetres,
    demographics: input.demographics,
    catchment: input.catchment ?? null,
    rent,
    category: input.category,
    point: input.point,
  });

  lines.push(
    "SUCCESS SCORE",
    `Overall: ${Math.round(score.overall)} out of 100.`,
    `${formatPercent(score.completeness, 0)} of the intended profile could be measured.`,
    "This score is a COMPARISON AID, not a forecast. It has never been validated against real business outcomes.",
    "",
    "SCORE DIMENSIONS",
  );

  for (const dimension of score.dimensions) {
    lines.push(
      `- ${dimension.label}: ${
        dimension.kind === "unavailable" ? "no data" : Math.round(dimension.score)
      } (${KIND_WORD[dimension.kind]}, weight ${
        dimension.weight > 0 ? formatPercent(dimension.weight, 0) : "0%"
      }). ${dimension.note}`,
    );
  }

  lines.push(
    "",
    "COMPETITORS",
    `Found: ${input.truncated ? "20 or more" : formatNumber(input.competitors.total)} within ${formatNumber(input.radiusMetres)}m.`,
  );

  if (input.truncated) {
    lines.push(
      "The search returned the nearest 20 and stopped, so the count is a FLOOR, not a total.",
      input.completeToMetres
        ? `Results are complete only to about ${formatNumber(input.completeToMetres)}m. Distance bands beyond that were NOT SEARCHED and are not known to be empty.`
        : "How far the results are complete is not known.",
    );
  }

  lines.push(
    input.competitors.averageRating === null
      ? "Average rating: nobody in range is rated."
      : `Average rating: ${input.competitors.averageRating} across ${formatNumber(input.competitors.ratedCount)} rated outlets, ${formatNumber(input.competitors.totalReviews)} reviews in total.`,
    input.competitors.nearestMetres === null
      ? "Nearest competitor: not known."
      : `Nearest competitor: ${formatNumber(input.competitors.nearestMetres)}m away.`,
  );

  if (input.density.length > 0) {
    lines.push("Competitors by distance band:");
    for (const band of input.density) {
      lines.push(`- within ${formatNumber(band.upToMetres)}m: ${formatNumber(band.count)}`);
    }
  }

  lines.push("", "AREA DEMOGRAPHICS");
  if (typeof input.catchment === "number") {
    lines.push(
      `CATCHMENT: about ${formatNumber(Math.round(input.catchment))} residents live within ${formatNumber(input.radiusMetres)}m of this point.`,
      "This is the figure that matters for walk-in trade. It is estimated from a 400m population grid, so treat it as an estimate rather than a count.",
    );
  }
  if (input.demographics) {
    const working = WORKING_AGE.reduce(
      (sum, band) => sum + (input.demographics?.age[band] ?? 0),
      0,
    );
    lines.push(
      `District: ${input.demographics.district}, ${input.demographics.state}.`,
      `District population: ${formatNumber(Math.round(input.demographics.total))}.`,
      `Working age 15 to 64: ${formatNumber(Math.round(working))} (${formatPercent(
        input.demographics.total > 0 ? working / input.demographics.total : 0,
        0,
      )} of residents).`,
      "This is the WHOLE administrative district, far larger than a walk-in catchment. It is context for the mix and must never be described as a customer count.",
    );
  } else {
    lines.push("No demographic data resolved for this point.");
  }

  lines.push("", "RENT");
  if (rent) {
    const sensitivity = rentSensitivity(rent, input.category, input.point);
    lines.push(
      `Monthly rent: ${formatCurrency(rent.monthlyRent)}.`,
      rent.psf !== null
        ? `That is RM${rent.psf} per square foot over ${formatNumber(rent.unitSqft ?? 0)} sqft.`
        : "No unit size was supplied, so there is no per-square-foot figure.",
      rent.kind === "direct"
        ? "This is the rent the user entered, so it is the most reliable figure here."
        : `This is an INFERRED benchmark for ${rent.district?.label}, ${formatNumber(
            rent.distanceMetres ?? 0,
          )}m from the pin, reviewed ${rent.reviewed}. It is a researched estimate, not a transacted rent.`,
      sensitivity.breakEvenPerDay === null
        ? "Break-even is unreachable at any volume."
        : `Break-even needs ${formatNumber(sensitivity.breakEvenPerDay)} customers a day, which is ${formatPercent(
            sensitivity.shareOfTypicalTrade ?? 0,
            0,
          )} of the ${formatNumber(category.customersPerDay)} a day typical for this format.`,
    );
  } else {
    lines.push(
      "No rent benchmark covers this location, and the user has not entered one.",
      "Rent is therefore excluded from the score rather than guessed.",
    );
  }

  lines.push(
    "",
    "WHAT IS NOT KNOWN",
    "- No seasonal or time-of-day demand data. Ramadan, Raya, school holidays and the monsoon all move Malaysian F&B and none of it is modelled.",
    "- No footfall counts. Demand is inferred from reviews per outlet, which is a proxy.",
    "- No information about specific premises, lease terms, licensing or planning.",
    "- No data on any location other than this one.",
    "- Nothing about whether this business will succeed. That has never been measured.",
  );

  return lines.join("\n");
}
