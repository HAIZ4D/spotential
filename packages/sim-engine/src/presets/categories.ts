import type { BusinessCategory, BusinessSector, ScenarioInputs } from "../types.js";

/**
 * Category presets — SPEC §5, extended beyond F&B.
 *
 * This started F&B-only, on the grounds that one sector keeps cost structures
 * comparable and the numbers defensible. Retail and services are now included,
 * and that original reasoning is SATISFIED rather than discarded: each sector
 * carries its own norms, its own Places types, and its own tax treatment,
 * instead of being forced through an F&B-shaped model.
 *
 * Two things genuinely differ by sector and are handled explicitly:
 *
 *   `dineInSharePct` drives service tax, and STATUTORY.serviceTax is declared
 *   `dineInOnly`. Retail and services are therefore ZERO — for retail that is
 *   simply correct, because Malaysian sales tax on goods is levied at
 *   manufacture or import and not at the till. For services the honest answer
 *   is that scope changed in 2025 and this codebase does not carry statutory
 *   values without a source and a review date, so the tax stays off and the
 *   UI tells the owner to confirm their own position.
 *
 *   `seats` is 0 wherever seating is not the constraint. The capacity check
 *   already skips that case — it calls it "a takeaway counter, not a mistake",
 *   which is equally true of a clothing rail.
 *
 * These are researched category-typical estimates, NOT location-verified
 * figures. Every seeded field is shown with its source in the UI and stays
 * editable. Feature 1 (Location Analysis) replaces them with real Places and
 * DOSM data later.
 */

export interface CategoryPreset {
  id: BusinessCategory;
  label: string;
  sector: BusinessSector;
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
    sector: "fnb",
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
    sector: "fnb",
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
    sector: "fnb",
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
    sector: "fnb",
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
    sector: "fnb",
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
    sector: "fnb",
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

  clothing_fashion: {
    id: "clothing_fashion",
    label: "Clothing & fashion",
    sector: "retail",
    // Fewer, larger transactions than F&B; stock is the dominant cost.
    cogsPct: 0.55,
    staffCount: 2,
    avgMonthlyWage: 1900,
    monthsToMaturity: 9,
    seats: 0,
    openHoursPerDay: 10,
    daysOpenPerWeek: 7,
    avgPricePerTransaction: 85,
    customersPerDay: 28,
    // Zero: no service tax at the point of sale for this sector. See the
    // file header — this is a deliberate value, not an unset one.
    dineInSharePct: 0,
    initialInvestment: 120000,
    utilities: 2200,
    licensingFees: 300,
    marketing: 2500,
    miscMonthly: 1200,
    typicalUnitSqft: 900,
    seatTurnBand: [0, 0],
    source: "Category-typical estimate; Malaysian small-format retail norms",
    reviewed: REVIEWED,
  },
  convenience_store: {
    id: "convenience_store",
    label: "Convenience store",
    sector: "retail",
    // Very thin margin, very high volume, long hours. The opposite shape to a restaurant.
    cogsPct: 0.78,
    staffCount: 3,
    avgMonthlyWage: 1800,
    monthsToMaturity: 4,
    seats: 0,
    openHoursPerDay: 16,
    daysOpenPerWeek: 7,
    avgPricePerTransaction: 14,
    customersPerDay: 320,
    // Zero: no service tax at the point of sale for this sector. See the
    // file header — this is a deliberate value, not an unset one.
    dineInSharePct: 0,
    initialInvestment: 180000,
    utilities: 4200,
    licensingFees: 600,
    marketing: 600,
    miscMonthly: 1500,
    typicalUnitSqft: 1100,
    seatTurnBand: [0, 0],
    source: "Category-typical estimate; Malaysian small-format retail norms",
    reviewed: REVIEWED,
  },
  pharmacy_health: {
    id: "pharmacy_health",
    label: "Pharmacy & health",
    sector: "retail",
    // Licensed staff lift the wage line; regulated fees lift licensing.
    cogsPct: 0.7,
    staffCount: 3,
    avgMonthlyWage: 2400,
    monthsToMaturity: 8,
    seats: 0,
    openHoursPerDay: 12,
    daysOpenPerWeek: 7,
    avgPricePerTransaction: 45,
    customersPerDay: 90,
    // Zero: no service tax at the point of sale for this sector. See the
    // file header — this is a deliberate value, not an unset one.
    dineInSharePct: 0,
    initialInvestment: 220000,
    utilities: 2600,
    licensingFees: 900,
    marketing: 1200,
    miscMonthly: 1600,
    typicalUnitSqft: 1200,
    seatTurnBand: [0, 0],
    source: "Category-typical estimate; Malaysian small-format retail norms",
    reviewed: REVIEWED,
  },
  phone_electronics: {
    id: "phone_electronics",
    label: "Phone & electronics",
    sector: "retail",
    // High ticket, low count, and the thinnest margin here - accessories carry it.
    cogsPct: 0.82,
    staffCount: 2,
    avgMonthlyWage: 2000,
    monthsToMaturity: 6,
    seats: 0,
    openHoursPerDay: 11,
    daysOpenPerWeek: 7,
    avgPricePerTransaction: 220,
    customersPerDay: 18,
    // Zero: no service tax at the point of sale for this sector. See the
    // file header — this is a deliberate value, not an unset one.
    dineInSharePct: 0,
    initialInvestment: 150000,
    utilities: 2000,
    licensingFees: 350,
    marketing: 1800,
    miscMonthly: 1300,
    typicalUnitSqft: 700,
    seatTurnBand: [0, 0],
    source: "Category-typical estimate; Malaysian small-format retail norms",
    reviewed: REVIEWED,
  },
  other_retail: {
    id: "other_retail",
    label: "Other (retail)",
    sector: "retail",
    // Generic retail defaults - no false precision, every field editable.
    cogsPct: 0.62,
    staffCount: 2,
    avgMonthlyWage: 1800,
    monthsToMaturity: 6,
    seats: 0,
    openHoursPerDay: 10,
    daysOpenPerWeek: 6,
    avgPricePerTransaction: 60,
    customersPerDay: 45,
    // Zero: no service tax at the point of sale for this sector. See the
    // file header — this is a deliberate value, not an unset one.
    dineInSharePct: 0,
    initialInvestment: 100000,
    utilities: 2000,
    licensingFees: 300,
    marketing: 1200,
    miscMonthly: 1000,
    typicalUnitSqft: 800,
    seatTurnBand: [0, 0],
    source: "Category-typical estimate; Malaysian small-format retail norms",
    reviewed: REVIEWED,
  },
  salon_barber: {
    id: "salon_barber",
    label: "Salon & barber",
    sector: "services",
    // Labour, not stock, is the cost. Chairs behave like seats, so the capacity check applies.
    cogsPct: 0.18,
    staffCount: 4,
    avgMonthlyWage: 2200,
    monthsToMaturity: 6,
    seats: 6,
    openHoursPerDay: 11,
    daysOpenPerWeek: 6,
    avgPricePerTransaction: 55,
    customersPerDay: 32,
    // Zero: no service tax at the point of sale for this sector. See the
    // file header — this is a deliberate value, not an unset one.
    dineInSharePct: 0,
    initialInvestment: 90000,
    utilities: 1800,
    licensingFees: 300,
    marketing: 1500,
    miscMonthly: 900,
    typicalUnitSqft: 800,
    seatTurnBand: [3, 8],
    source: "Category-typical estimate; Malaysian small-format services norms",
    reviewed: REVIEWED,
  },
  laundry: {
    id: "laundry",
    label: "Laundry",
    sector: "services",
    // Machines, not seats, are the constraint; utilities are unusually high.
    cogsPct: 0.22,
    staffCount: 2,
    avgMonthlyWage: 1700,
    monthsToMaturity: 5,
    seats: 0,
    openHoursPerDay: 14,
    daysOpenPerWeek: 7,
    avgPricePerTransaction: 18,
    customersPerDay: 70,
    // Zero: no service tax at the point of sale for this sector. See the
    // file header — this is a deliberate value, not an unset one.
    dineInSharePct: 0,
    initialInvestment: 150000,
    utilities: 5500,
    licensingFees: 300,
    marketing: 800,
    miscMonthly: 900,
    typicalUnitSqft: 700,
    seatTurnBand: [0, 0],
    source: "Category-typical estimate; Malaysian small-format services norms",
    reviewed: REVIEWED,
  },
  fitness_studio: {
    id: "fitness_studio",
    label: "Fitness studio",
    sector: "services",
    // Mostly memberships, so the per-transaction figure is a monthly fee, not a walk-in sale.
    cogsPct: 0.12,
    staffCount: 3,
    avgMonthlyWage: 2300,
    monthsToMaturity: 10,
    seats: 20,
    openHoursPerDay: 14,
    daysOpenPerWeek: 7,
    avgPricePerTransaction: 120,
    customersPerDay: 25,
    // Zero: no service tax at the point of sale for this sector. See the
    // file header — this is a deliberate value, not an unset one.
    dineInSharePct: 0,
    initialInvestment: 250000,
    utilities: 4500,
    licensingFees: 500,
    marketing: 3000,
    miscMonthly: 1800,
    typicalUnitSqft: 2000,
    seatTurnBand: [1, 4],
    source: "Category-typical estimate; Malaysian small-format services norms",
    reviewed: REVIEWED,
  },
  other_services: {
    id: "other_services",
    label: "Other (services)",
    sector: "services",
    // Generic services defaults - no false precision, every field editable.
    cogsPct: 0.2,
    staffCount: 2,
    avgMonthlyWage: 2000,
    monthsToMaturity: 6,
    seats: 4,
    openHoursPerDay: 10,
    daysOpenPerWeek: 6,
    avgPricePerTransaction: 60,
    customersPerDay: 30,
    // Zero: no service tax at the point of sale for this sector. See the
    // file header — this is a deliberate value, not an unset one.
    dineInSharePct: 0,
    initialInvestment: 90000,
    utilities: 2000,
    licensingFees: 300,
    marketing: 1200,
    miscMonthly: 900,
    typicalUnitSqft: 700,
    seatTurnBand: [2, 6],
    source: "Category-typical estimate; Malaysian small-format services norms",
    reviewed: REVIEWED,
  },
};

export function listCategories(): CategoryPreset[] {
  return Object.values(CATEGORY_PRESETS);
}

export const SECTOR_LABELS: Record<BusinessSector, string> = {
  fnb: "Food & beverage",
  retail: "Retail",
  services: "Services",
};

/** Declaration order, so the selector groups without sorting anything. */
export const SECTORS: BusinessSector[] = ["fnb", "retail", "services"];

/**
 * Categories in one sector.
 *
 * Used by the grouped selector and — the reason it matters — by Opportunity
 * Gap Detection, which spends one Places call per category it searches.
 * Scoping to a sector is what keeps that bill flat as categories are added,
 * and it also stops the ranking comparing outlets that never competed for the
 * same customer.
 */
export function listCategoriesBySector(sector: BusinessSector): CategoryPreset[] {
  return Object.values(CATEGORY_PRESETS).filter((p) => p.sector === sector);
}

export function sectorOf(category: BusinessCategory): BusinessSector {
  return CATEGORY_PRESETS[category].sector;
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
