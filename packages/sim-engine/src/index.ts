/**
 * @spotential/sim-engine
 *
 * The single implementation of the What-if Simulator maths. Imported as
 * TypeScript source by both apps/web and services/simulator, so the browser
 * and Cloud Run run byte-identical arithmetic and cannot drift.
 */

export * from "./types.js";

export { simulate } from "./simulate.js";
export {
  HORIZON_MONTHS,
  core,
  cogsPerUnitOf,
  paybackMonthOf,
  r2,
  r4,
  staffCostOf,
  tradingDaysPerMonth,
  type Core,
} from "./basis.js";
export { RAMP_START, ramp, rampCurve } from "./ramp.js";
export { flex, paybackBand, sensitivity } from "./sensitivity.js";
export { solveRecovery } from "./recovery.js";
export { validate } from "./validate.js";
export { parseScenarioInputs, type ParseResult } from "./schema.js";
export { encodeScenario, decodeScenario, type DecodeResult } from "./share.js";
export {
  PATCHABLE_FIELDS,
  MAX_OPERATIONS,
  applyFieldValue,
  applyPatch,
  changedFields,
  validateOperations,
  type OperationsResult,
  type PatchableField,
} from "./patch.js";
export { projectionToCsv, csvFilename } from "./csv.js";

export {
  CACHE_COORD_DECIMALS,
  MALAYSIA_BOUNDS,
  RADIUS_BUCKETS,
  bucketRadius,
  distanceMetres,
  formatLatLng,
  isInMalaysia,
  isValidLatLng,
  roundForCache,
  boundingBoxOf,
  inBoundingBox,
  pointInPolygon,
  pointInRing,
  type BoundingBox,
  type LatLng,
  type Ring,
} from "./geo.js";

export {
  CATEGORY_PLACE_TYPES,
  DENSITY_BANDS,
  PLACES_MAX_RESULTS,
  densityByBand,
  isTruncated,
  summarise,
  withDistance,
  withinRadius,
  type Competitor,
  type CompetitorSummary,
  type CompetitorWithDistance,
  type DensityBand,
} from "./competitors.js";

export {
  formatCurrency,
  formatCurrencyDelta,
  formatCurrencyPrecise,
  formatMonthBand,
  formatNumber,
  formatPercent,
} from "./format.js";

export { en, type Strings } from "./i18n/en.js";

export * from "./presets/index.js";

export {
  analyseOpportunity,
  type CategoryGap,
  type CategorySupply,
  type GapVerdict,
  type OpportunityAnalysis,
} from './opportunity.js';

export {
  catchmentPercentile,
  scoreLocation,
  type LocationScore,
  type ScoreDimension,
  type ScoreInputs,
  type ScoreKind,
} from './score.js';

export {
  compareLocations,
  TOO_CLOSE_POINTS,
  type ComparedLocation,
  type Comparison,
  type DimensionComparison,
  type DimensionOutcome,
} from './compare.js';

export {
  resolveRent,
  rentSensitivity,
  type RentLight,
  type RentOverride,
  type RentSensitivity,
  type ResolvedRent,
} from './rent.js';

export {
  EVENT_TYPES,
  EVENT_TYPE_LABELS,
  MALAYSIAN_STATES,
  type BoothPackage,
  type EventListing,
  type EventSource,
  type EventType,
  type MalaysianState,
  type VendorProfile,
} from './events/types.js';

export {
  EVENT_SCORE_WEIGHTS,
  entryPrice,
  eventDays,
  rankEvents,
  scoreEvent,
  type EventScore,
  type EventScoreInputs,
} from './events/score.js';

export {
  CAPTURE_RATE_SWEEP,
  eventRoi,
  roiDefaults,
  roiSweep,
  type EventRoi,
  type EventRoiAtCapture,
  type EventRoiInputs,
  type RoiVerdict,
} from './events/roi.js';

export {
  byStartDate,
  filterEvents,
  hasAvailability,
  isPast,
  matchesFilters,
  type EventFilters,
} from './events/filter.js';

export { matchInsight, type MatchInsight } from './events/insight.js';
