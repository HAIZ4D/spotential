import type { CompetitorSummary } from "./competitors.js";
import { r2 } from "./basis.js";
import { rentSensitivity, type ResolvedRent } from "./rent.js";
import type { BusinessCategory } from "./types.js";
import type { LatLng } from "./geo.js";

/**
 * The Overall Success Score and location profile — Feature 1d.
 *
 * WHAT THIS IS NOT: a forecast. Nothing here has been validated against real
 * business outcomes, and it never could be from public data. It is a weighted
 * blend of proxies, and the honest use is COMPARING two locations, not
 * believing an absolute figure. A 62 means nothing on its own; 62 against 48
 * is the point, and that is what Feature 2 will consume.
 *
 * The spider graph is the real output. The single number is a way to rank; the
 * shape is what tells an owner why.
 *
 * Every dimension declares its `kind` so the UI can show which figures are
 * measured and which are inferred. That distinction is the difference between
 * a useful tool and a confident-sounding one.
 */

export type ScoreKind = "direct" | "proxy" | "unavailable";

export interface ScoreDimension {
  key: string;
  label: string;
  /** 0-100. Zero when unavailable — read `kind` before using it. */
  score: number;
  kind: ScoreKind;
  /** Share of the final score, after renormalising over available dimensions. */
  weight: number;
  /** Plain-language reading of this dimension at this location. */
  note: string;
  /** True when the underlying data was capped, so the score is a bound. */
  isFloor?: boolean;
}

export interface LocationScore {
  /** 0-100, weighted over AVAILABLE dimensions only. */
  overall: number;
  dimensions: ScoreDimension[];
  /** Share of the intended dimensions that could actually be measured. */
  completeness: number;
}

export interface ScoreInputs {
  competitors: CompetitorSummary;
  /** Places capped the competitor search, so counts are a floor. */
  truncated: boolean;
  /**
   * Radius at which a capped search ran out — the key to scoring a truncated
   * area at all. See `competitionScore`.
   */
  completeToMetres: number | null;
  radiusMetres: number;
  demographics: { total: number; age: Record<string, number> } | null;
  /**
   * Residents within the search radius, from the 400m population grid.
   *
   * Beats `demographics` for the catchment dimension when present: it is the
   * measured thing rather than a district-wide stand-in. Null where the grid
   * has no coverage, which falls back to the district proxy.
   */
  catchment?: number | null;
  /**
   * Feature 1e. Null when the pin falls outside every curated benchmark and
   * the user has not supplied a rent — the axis then stays empty rather than
   * being filled with a national average.
   */
  rent?: ResolvedRent | null;
  /** Needed to score rent: floor area and break-even both depend on format. */
  category?: BusinessCategory;
  point?: LatLng;
}

/**
 * Weights reflect HOW MUCH WE TRUST EACH SIGNAL, not how much each factor
 * matters to a real business — we have no evidence for the latter and
 * pretending otherwise would be the least defensible part of the feature.
 */
/**
 * The original four are scaled by 0.88 and keep their mutual proportions
 * exactly (30:30:25:15). This matters: because the weights are renormalised
 * over the dimensions actually available, a location with NO rent data scores
 * precisely what it scored before Feature 1e existed. Adding a dimension must
 * not silently reprice the others.
 */
const WEIGHTS = {
  competition: 0.264,
  footfall: 0.264,
  catchment: 0.22,
  competitorQuality: 0.132,
  /** A researched benchmark, so the smallest weight of the five. */
  rent: 0.12,
} as const;

/**
 * A rent the user was actually quoted is the most reliable figure on the page
 * — better evidence than anything else here, all of which is inferred from
 * Places or DOSM. So it earns a weight the benchmark does not.
 */
const RENT_WEIGHT_WHEN_QUOTED = 0.2;

/** Working-age bands. F&B trade tracks these far more than total headcount. */
const WORKING_AGE = [
  "15-19", "20-24", "25-29", "30-34", "35-39",
  "40-44", "45-49", "50-54", "55-59", "60-64",
];

const clamp = (value: number): number => Math.max(0, Math.min(100, value));

/**
 * Competition scores on a PEAK, not a slope.
 *
 * Fewer competitors is better only up to a point. Zero outlets is not a green
 * field — it is an unproven one, and may simply mean nobody here wants this.
 * That is the same trap Opportunity Gap Detection refuses to fall into, and
 * the curve here has to agree with it or the two panels would contradict
 * each other on the same screen.
 *
 * Scores peak around a handful of competitors: enough to prove demand, few
 * enough to leave room.
 */
function competitionScore(
  outlets: number,
  completeToMetres: number | null,
): { score: number; note: string } {
  if (outlets === 0) {
    return {
      score: 35,
      note: "No competitors found. Unproven rather than open; nobody here may want this.",
    };
  }

  /**
   * A capped search needs DENSITY, not the count.
   *
   * Almost everywhere urban in Malaysia hits Places' 20-result cap at a 500m
   * radius, so scoring on the raw count pinned this dimension — the
   * highest-weighted one — at the same value everywhere and the overall score
   * stopped discriminating at all: central KL and suburban PJ came out 43 and
   * 42, which is useless for the comparison this score exists to support.
   *
   * But the radius at which the quota ran out is itself the signal. Twenty
   * outlets within 142m is a far denser pitch than twenty within 263m, and
   * that difference is exactly what a comparison needs. The cap stops being
   * lost information and becomes the measurement.
   */
  if (completeToMetres && completeToMetres > 0) {
    const areaKm2 = (Math.PI * completeToMetres ** 2) / 1_000_000;
    const perKm2 = outlets / areaKm2;

    // ~40/km² is a normal high street; 300+/km² is a food-court-dense core.
    const score = clamp(100 - ((perKm2 - 40) / 260) * 100);
    return {
      score,
      note: `${outlets}+ competitors, ~${Math.round(perKm2)} per km². ${
        perKm2 >= 250 ? "Extremely dense" : perKm2 >= 120 ? "Dense" : "Busy but not packed"
      }.`,
    };
  }

  if (outlets <= 2) {
    return { score: 78, note: `${outlets} competitor${outlets === 1 ? "" : "s"}. Thin, but some proof of demand.` };
  }
  if (outlets <= 5) return { score: 100, note: `${outlets} competitors. Demand proven, room left.` };
  if (outlets <= 9) return { score: 72, note: `${outlets} competitors. Getting busy.` };
  if (outlets <= 14) return { score: 45, note: `${outlets} competitors. Crowded.` };
  return { score: 20, note: `${outlets} competitors. Saturated.` };
}

/** Reviews per outlet: how busy the existing operators are. */
function footfallScore(summary: CompetitorSummary): { score: number; note: string } {
  if (summary.total === 0) {
    return { score: 0, note: "No outlets to measure footfall from." };
  }
  const perOutlet = summary.totalReviews / summary.total;
  // 400+ reviews per outlet reads as a genuinely busy pitch. Linear below.
  const score = clamp((perOutlet / 400) * 100);
  return {
    score,
    note: `${Math.round(perOutlet)} reviews per outlet. ${
      perOutlet >= 250 ? "Existing operators are busy" : perOutlet >= 80 ? "Moderate trade" : "Quiet"
    }.`,
  };
}

/** District working-age population. Coarse: a district is far bigger than a radius. */
/**
 * Decile breakpoints of the 500m catchment, POPULATION-WEIGHTED across
 * Malaysia. Index i is the i-th decile: [p0, p10, … p100].
 *
 * Measured from the 400m population grid with a deterministic stride through
 * cumulative population, so the reference class is "catchments as experienced
 * by Malaysians" rather than averaged over empty land. Regenerate alongside
 * the grid — see scripts/refresh-population.mjs.
 *
 * The first attempt hand-picked 1,000 and 10,000 as the ends of the scale and
 * was badly wrong: measured against the real distribution a MEDIAN site scored
 * 33. Anchors on this dimension have to come from the data.
 *
 * Source: Kontur Population 20231101. Reviewed 2026-08-13.
 */
const CATCHMENT_DECILES = [3, 169, 388, 703, 1_130, 1_680, 2_592, 3_560, 4_796, 7_213, 27_931];

/**
 * Population actually within walking distance, when we have it.
 *
 * This replaces the district proxy below, and the difference is not cosmetic:
 * the district figure for Kuala Lumpur is over two million people, while the
 * real 500m catchment is about six and a half thousand. Scoring on the district
 * meant scoring on a number nobody could ever serve, and every panel showing it
 * had to carry a warning not to multiply it into anything.
 *
 * Scored as a PERCENTILE rather than against invented anchors, which makes the
 * number interpretable — "denser than 87% of where Malaysians live" is a claim
 * a reader can check — and self-calibrating if the grid is ever refreshed.
 */
/**
 * Where a catchment sits in the national distribution, as 0-1.
 *
 * Extracted so the city heatmap can rank a hexagon on exactly the same scale
 * the Success Score uses. One implementation: if these ever diverged, the map
 * and the score would describe the same place differently, which is the class
 * of contradiction this codebase spends most of its effort avoiding.
 */
export function catchmentPercentile(catchment: number, radiusMetres: number): number {
  // The deciles describe a 500m radius. Catchment scales with area, so a
  // different radius is converted to its 500m equivalent before lookup rather
  // than compared against a distribution it does not belong to.
  const equivalent = catchment * (500 / radiusMetres) ** 2;

  for (let i = 0; i < CATCHMENT_DECILES.length - 1; i += 1) {
    const low = CATCHMENT_DECILES[i] as number;
    const high = CATCHMENT_DECILES[i + 1] as number;
    if (equivalent <= high) {
      const within = high > low ? (equivalent - low) / (high - low) : 0;
      return (i + Math.max(0, within)) / 10;
    }
  }

  return 1;
}

function measuredCatchmentScore(
  catchment: number,
  radiusMetres: number,
): { score: number; kind: ScoreKind; note: string } {
  const percentile = catchmentPercentile(catchment, radiusMetres);
  const score = r2(clamp(percentile * 100));

  return {
    score,
    kind: "direct",
    note:
      `${Math.round(catchment).toLocaleString("en-MY")} residents within ${radiusMetres}m. ` +
      `Denser than ${Math.round(percentile * 100)}% of where Malaysians live.`,
  };
}

function catchmentScore(
  demographics: ScoreInputs["demographics"],
): { score: number; kind: ScoreKind; note: string } {
  if (!demographics || demographics.total <= 0) {
    return { score: 0, kind: "unavailable", note: "No demographic data for this point." };
  }

  const workingAge = WORKING_AGE.reduce((sum, band) => sum + (demographics.age[band] ?? 0), 0);
  const share = workingAge / demographics.total;

  // Ceiling raised from 500k after verification: every urban district cleared
  // it and scored 100, flattening the dimension. 2M working-age is the top of
  // the real Malaysian range, which spreads city districts apart instead.
  const sizeScore = clamp((workingAge / 2_000_000) * 100);
  // A high working-age share matters as much as raw size for F&B.
  const shareScore = clamp(((share - 0.5) / 0.25) * 100);
  const score = r2(sizeScore * 0.6 + shareScore * 0.4);

  return {
    score,
    kind: "proxy",
    note: `${Math.round(workingAge / 1000)}k working-age in the district (${Math.round(share * 100)}% of residents).`,
  };
}

/**
 * Strong incumbents are harder to displace, so a high average rating scores
 * LOW. Genuinely ambiguous — it also signals a market that will pay for
 * quality — which is why this carries the lowest weight of the four.
 */
function competitorQualityScore(
  summary: CompetitorSummary,
): { score: number; kind: ScoreKind; note: string } {
  if (summary.averageRating === null) {
    return { score: 0, kind: "unavailable", note: "None of the nearby outlets are rated." };
  }
  // 3.0 average leaves plenty of room; 4.8 means very little.
  const score = clamp(((4.8 - summary.averageRating) / 1.8) * 100);
  return {
    score,
    kind: "direct",
    note: `Competitors average ${summary.averageRating}. ${
      summary.averageRating >= 4.4 ? "Strong incumbents, hard to displace" : "Beatable on quality"
    }.`,
  };
}

export function scoreLocation(inputs: ScoreInputs): LocationScore {
  const { competitors, truncated } = inputs;

  const competition = competitionScore(competitors.total, inputs.completeToMetres);
  const footfall = footfallScore(competitors);
  // Measured catchment wins over the district proxy wherever the grid reaches.
  const catchment =
    typeof inputs.catchment === "number" && inputs.catchment > 0
      ? measuredCatchmentScore(inputs.catchment, inputs.radiusMetres)
      : catchmentScore(inputs.demographics);
  const quality = competitorQualityScore(competitors);

  // Needs all three: a rent figure, the format that determines floor area, and
  // the point the benchmark was resolved at. Absent any of them the axis stays
  // empty, exactly as it did before Feature 1e.
  const rent =
    inputs.rent && inputs.category && inputs.point
      ? rentSensitivity(inputs.rent, inputs.category, inputs.point)
      : null;

  const dimensions: ScoreDimension[] = [
    {
      key: "competition",
      label: "Competition",
      score: competition.score,
      kind: "direct",
      weight: WEIGHTS.competition,
      note: competition.note,
      /**
       * Only a bound when we had to fall back to counting.
       *
       * Once density is used, the cap is accounted for rather than lost — 20
       * outlets within 142m is a real measurement, not a floor — so marking it
       * "≤" would be both wrong and, at a score of 0, nonsense.
       */
      ...(truncated && !inputs.completeToMetres ? { isFloor: true } : {}),
    },
    {
      key: "footfall",
      label: "Est. monthly demand",
      score: footfall.score,
      kind: competitors.total > 0 ? "proxy" : "unavailable",
      weight: WEIGHTS.footfall,
      note: footfall.note,
    },
    {
      key: "catchment",
      label: "Revenue potential",
      score: catchment.score,
      kind: catchment.kind,
      weight: WEIGHTS.catchment,
      note: catchment.note,
    },
    {
      key: "competitorQuality",
      label: "Competitor quality",
      score: quality.score,
      kind: quality.kind,
      weight: WEIGHTS.competitorQuality,
      note: quality.note,
    },
    {
      key: "rent",
      label: "Rent sensitivity",
      score: rent?.score ?? 0,
      kind: rent?.kind ?? "unavailable",
      // A quoted rent is hard evidence and outweighs a researched benchmark.
      weight: rent?.kind === "direct" ? RENT_WEIGHT_WHEN_QUOTED : WEIGHTS.rent,
      // Benchmarks cover 22 trading areas; a pin can land anywhere in the
      // country. Inventing a national average to fill this axis would be
      // exactly the false precision the rest of this app refuses.
      note:
        rent?.note ??
        "No rent benchmark covers this spot. Enter the rent you were quoted to fill this in.",
    },
  ];

  // Renormalise over what could actually be measured, so a missing dimension
  // dilutes confidence rather than silently dragging the score down.
  const available = dimensions.filter((d) => d.kind !== "unavailable");
  const totalWeight = available.reduce((sum, d) => sum + d.weight, 0);

  const overall =
    totalWeight > 0
      ? r2(available.reduce((sum, d) => sum + d.score * (d.weight / totalWeight), 0))
      : 0;

  for (const dimension of dimensions) {
    dimension.weight = totalWeight > 0 && dimension.kind !== "unavailable"
      ? r2(dimension.weight / totalWeight)
      : 0;
  }

  return {
    overall,
    dimensions,
    completeness: r2(available.length / dimensions.length),
  };
}
