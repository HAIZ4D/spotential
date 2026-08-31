export { STATUTORY, STATUTORY_REVIEWED } from "./statutory.js";
export { PRESET_VERSION, ENGINE_VERSION } from "./version.js";
export {
  CATEGORY_PRESETS,
  SECTORS,
  SECTOR_LABELS,
  listCategories,
  listCategoriesBySector,
  sectorOf,
  categoryDefaults,
  type CategoryPreset,
} from "./categories.js";
export {
  DISTRICT_PRESETS,
  listDistricts,
  nearestDistrict,
  seedMonthlyRent,
  type DistrictPreset,
  type NearestDistrict,
} from "./districts.js";

import type { BusinessCategory, DistrictId, ScenarioInputs } from "../types.js";
import { categoryDefaults } from "./categories.js";
import { seedMonthlyRent } from "./districts.js";

/**
 * A complete, editable starting scenario. This is the preset-seeded entry
 * point from SPEC §5 — the user picks a category and a district and every
 * field arrives filled in with something defensible rather than blank.
 */
export function seedScenario(
  category: BusinessCategory,
  district: DistrictId,
): ScenarioInputs {
  return {
    ...categoryDefaults(category),
    district,
    monthlyRent: seedMonthlyRent(district),
  };
}
