import type { BusinessCategory, ScenarioInputs } from "../types.js";

/**
 * F&B category presets — SPEC §5.
 *
 * One sector only, so the cost structures are genuinely comparable and the
 * numbers are defensible. Retail and services have different economics
 * (stock turns, utilisation) and are deliberately excluded rather than
 * forced through an F&B-shaped model.
 *
 * These are researched category-typical estimates, NOT location-verified
 * figures. Every seeded field is shown with its source in the UI and stays
 * editable. Feature 1 (Location Analysis) replaces them with real Places and
 * DOSM data later.
 */

export interface CategoryPreset {
  id: BusinessCategory;
  label: string;
  cogsPct: number;
  staffCount: number;
  avgMonthlyWage: number;
  monthsToMaturity: number;
  seats: number;
  openHoursPerDay: number;
  daysOpenPerWeek: number;
  avgPricePerTransaction: number;
  customersPerDay: number;
  /** SST base — share of revenue taken dine-in. SPEC §4.5. */
  dineInSharePct: number;
  initialInvestment: number;
  utilities: number;
  licensingFees: number;
  marketing: number;
  miscMonthly: number;
  typicalUnitSqft: number;
  /** Plausible seat-turn band for the §6 capacity check. */
  seatTurnBand: readonly [number, number];
  source: string;
  reviewed: string;
}

const REVIEWED = "2026-08-12";

export const CATEGORY_PRESETS: Record<BusinessCategory, CategoryPreset> = {
  korean_restaurant: {
    id: "korean_restaurant",
    label: "Korean restaurant",
    cogsPct: 0.32,
    staffCount: 4,
    avgMonthlyWage: 2000,
    monthsToMaturity: 6,
    seats: 40,
    openHoursPerDay: 10,
    daysOpenPerWeek: 7,
    avgPricePerTransaction: 18,
    customersPerDay: 180,
    dineInSharePct: 0.8,
    initialInvestment: 150000,
    utilities: 3500,
    licensingFees: 400,
    marketing: 2000,
    miscMonthly: 1500,
    typicalUnitSqft: 1200,
    seatTurnBand: [3, 6],
    source: "Category-typical estimate; Malaysian F&B operating norms",
    reviewed: REVIEWED,
  },

  cafe_coffee_shop: {
    id: "cafe_coffee_shop",
    label: "Cafe / coffee shop",
    cogsPct: 0.28,
    staffCount: 3,
    avgMonthlyWage: 1900,
    monthsToMaturity: 5,
    seats: 30,
    openHoursPerDay: 11,
    daysOpenPerWeek: 7,
    avgPricePerTransaction: 22,
    customersPerDay: 120,
    dineInSharePct: 0.7,
    initialInvestment: 120000,
    utilities: 2800,
    licensingFees: 350,
    marketing: 1800,
    miscMonthly: 1200,
    typicalUnitSqft: 900,
    seatTurnBand: [3, 7],
    source: "Category-typical estimate; Malaysian F&B operating norms",
    reviewed: REVIEWED,
  },

  casual_dining: {
    id: "casual_dining",
    label: "Casual dining / mamak",
    cogsPct: 0.35,
    staffCount: 6,
    avgMonthlyWage: 1800,
    monthsToMaturity: 4,
    seats: 60,
    openHoursPerDay: 16,
    daysOpenPerWeek: 7,
    avgPricePerTransaction: 14,
    customersPerDay: 300,
    dineInSharePct: 0.85,
    initialInvestment: 130000,
    utilities: 4200,
    licensingFees: 450,
    marketing: 1500,
    miscMonthly: 1600,
    typicalUnitSqft: 1600,
    seatTurnBand: [4, 9],
    source: "Category-typical estimate; long trading hours, thin margin",
    reviewed: REVIEWED,
  },

  bubble_tea_dessert: {
    id: "bubble_tea_dessert",
    label: "Bubble tea / dessert",
    cogsPct: 0.3,
    staffCount: 3,
    avgMonthlyWage: 1800,
    monthsToMaturity: 5,
    seats: 16,
    openHoursPerDay: 12,
    daysOpenPerWeek: 7,
    avgPricePerTransaction: 12,
    customersPerDay: 200,
    dineInSharePct: 0.25,
    initialInvestment: 90000,
    utilities: 2200,
    licensingFees: 300,
    marketing: 1500,
    miscMonthly: 900,
    typicalUnitSqft: 600,
    seatTurnBand: [6, 20],
    source: "Category-typical estimate; high turns, low dwell time",
    reviewed: REVIEWED,
  },

  fast_casual_takeaway: {
    id: "fast_casual_takeaway",
    label: "Fast-casual takeaway",
    cogsPct: 0.33,
    staffCount: 3,
    avgMonthlyWage: 1800,
    monthsToMaturity: 4,
    seats: 8,
    openHoursPerDay: 12,
    daysOpenPerWeek: 7,
    avgPricePerTransaction: 15,
    customersPerDay: 160,
    // Nearly exempt from service tax by construction — that is the dine-in
    // rule working correctly, not a bug.
    dineInSharePct: 0.1,
    initialInvestment: 80000,
    utilities: 2000,
    licensingFees: 300,
    marketing: 1200,
    miscMonthly: 800,
    typicalUnitSqft: 500,
    seatTurnBand: [8, 40],
    source: "Category-typical estimate; seat check largely not applicable",
    reviewed: REVIEWED,
  },

  other_fnb: {
    id: "other_fnb",
    label: "Other (F&B)",
    cogsPct: 0.32,
    staffCount: 3,
    avgMonthlyWage: 1900,
    monthsToMaturity: 6,
    seats: 30,
    openHoursPerDay: 10,
    daysOpenPerWeek: 6,
    avgPricePerTransaction: 18,
    customersPerDay: 120,
    dineInSharePct: 0.6,
    initialInvestment: 110000,
    utilities: 2800,
    licensingFees: 350,
    marketing: 1500,
    miscMonthly: 1100,
    typicalUnitSqft: 900,
    seatTurnBand: [3, 8],
    source: "Generic F&B defaults — no false precision, every field editable",
    reviewed: REVIEWED,
  },
};

export function listCategories(): CategoryPreset[] {
  return Object.values(CATEGORY_PRESETS);
}

/** Everything a category contributes to a fresh scenario, before district rent. */
export function categoryDefaults(
  category: BusinessCategory,
): Omit<ScenarioInputs, "district" | "monthlyRent"> {
  const p = CATEGORY_PRESETS[category];
  return {
    businessCategory: p.id,
    initialInvestment: p.initialInvestment,
    securityDepositMonths: 6,
    avgPricePerTransaction: p.avgPricePerTransaction,
    customersPerDay: p.customersPerDay,
    seats: p.seats,
    openHoursPerDay: p.openHoursPerDay,
    daysOpenPerWeek: p.daysOpenPerWeek,
    cogsPct: p.cogsPct,
    staffCount: p.staffCount,
    avgMonthlyWage: p.avgMonthlyWage,
    utilities: p.utilities,
    licensingFees: p.licensingFees,
    marketing: p.marketing,
    miscMonthly: p.miscMonthly,
    monthsToMaturity: p.monthsToMaturity,
    serviceChargePct: 0,
    sstRegistered: false,
    dineInSharePct: p.dineInSharePct,
  };
}
