import type { BusinessCategory, DistrictId, ScenarioInputs } from "./types.js";
import { CATEGORY_PRESETS } from "./presets/categories.js";
import { DISTRICT_PRESETS } from "./presets/districts.js";

/**
 * Schema validation for untrusted scenario input.
 *
 * Three callers, one implementation: the Cloud Run endpoint (a request body
 * off the internet), the share-URL decoder (SPEC §7.7 — a link someone was
 * sent on WhatsApp is untrusted input), and AI patch application (SPEC §8.4).
 *
 * Hand-rolled rather than zod, because the engine has zero runtime
 * dependencies by design and this is the only validation it needs.
 *
 * Bounds are absolute sanity limits, NOT plausibility rules. Implausible but
 * possible values pass here and are surfaced as warnings by validate.ts —
 * warn, never block.
 */

export type ParseResult =
  | { ok: true; value: ScenarioInputs }
  | { ok: false; errors: string[] };

interface Bound {
  min: number;
  max: number;
  integer?: boolean;
}

const NUMERIC_BOUNDS: Record<string, Bound> = {
  initialInvestment: { min: 0, max: 100_000_000 },
  monthlyRent: { min: 0, max: 10_000_000 },
  securityDepositMonths: { min: 0, max: 24 },
  avgPricePerTransaction: { min: 0, max: 100_000 },
  customersPerDay: { min: 0, max: 100_000 },
  seats: { min: 0, max: 10_000 },
  openHoursPerDay: { min: 0, max: 24 },
  daysOpenPerWeek: { min: 0, max: 7 },
  cogsPct: { min: 0, max: 1 },
  staffCount: { min: 0, max: 1_000, integer: true },
  avgMonthlyWage: { min: 0, max: 1_000_000 },
  utilities: { min: 0, max: 10_000_000 },
  licensingFees: { min: 0, max: 10_000_000 },
  marketing: { min: 0, max: 10_000_000 },
  miscMonthly: { min: 0, max: 10_000_000 },
  monthsToMaturity: { min: 1, max: 36 },
  serviceChargePct: { min: 0, max: 0.5 },
  dineInSharePct: { min: 0, max: 1 },
};

const OPTIONAL_NUMERIC_BOUNDS: Record<string, Bound> = {
  tradingDaysPerMonthOverride: { min: 0, max: 31 },
  cogsPerUnitOverride: { min: 0, max: 100_000 },
};

export function parseScenarioInputs(raw: unknown): ParseResult {
  const errors: string[] = [];

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["expected an object"] };
  }
  const input = raw as Record<string, unknown>;

  const category = input["businessCategory"];
  if (typeof category !== "string" || !(category in CATEGORY_PRESETS)) {
    errors.push(`businessCategory: unknown value ${JSON.stringify(category)}`);
  }

  const district = input["district"];
  if (typeof district !== "string" || !(district in DISTRICT_PRESETS)) {
    errors.push(`district: unknown value ${JSON.stringify(district)}`);
  }

  if (typeof input["sstRegistered"] !== "boolean") {
    errors.push("sstRegistered: expected a boolean");
  }

  const numbers: Record<string, number> = {};

  for (const [field, bound] of Object.entries(NUMERIC_BOUNDS)) {
    const value = input[field];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push(`${field}: expected a finite number`);
      continue;
    }
    if (value < bound.min || value > bound.max) {
      errors.push(`${field}: ${value} is outside ${bound.min} to ${bound.max}`);
      continue;
    }
    if (bound.integer && !Number.isInteger(value)) {
      errors.push(`${field}: expected a whole number`);
      continue;
    }
    numbers[field] = value;
  }

  const optionals: Record<string, number> = {};
  for (const [field, bound] of Object.entries(OPTIONAL_NUMERIC_BOUNDS)) {
    const value = input[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push(`${field}: expected a finite number when present`);
      continue;
    }
    if (value < bound.min || value > bound.max) {
      errors.push(`${field}: ${value} is outside ${bound.min} to ${bound.max}`);
      continue;
    }
    optionals[field] = value;
  }

  // Unknown keys are rejected rather than ignored: this is the defence against
  // a crafted share URL or a jailbroken AI patch smuggling in a field the
  // engine was never meant to read.
  const known = new Set([
    "businessCategory",
    "district",
    "sstRegistered",
    ...Object.keys(NUMERIC_BOUNDS),
    ...Object.keys(OPTIONAL_NUMERIC_BOUNDS),
  ]);
  for (const key of Object.keys(input)) {
    if (!known.has(key)) errors.push(`${key}: unknown field`);
  }

  if (errors.length > 0) return { ok: false, errors };

  const value: ScenarioInputs = {
    businessCategory: category as BusinessCategory,
    district: district as DistrictId,
    sstRegistered: input["sstRegistered"] as boolean,
    initialInvestment: numbers["initialInvestment"]!,
    monthlyRent: numbers["monthlyRent"]!,
    securityDepositMonths: numbers["securityDepositMonths"]!,
    avgPricePerTransaction: numbers["avgPricePerTransaction"]!,
    customersPerDay: numbers["customersPerDay"]!,
    seats: numbers["seats"]!,
    openHoursPerDay: numbers["openHoursPerDay"]!,
    daysOpenPerWeek: numbers["daysOpenPerWeek"]!,
    cogsPct: numbers["cogsPct"]!,
    staffCount: numbers["staffCount"]!,
    avgMonthlyWage: numbers["avgMonthlyWage"]!,
    utilities: numbers["utilities"]!,
    licensingFees: numbers["licensingFees"]!,
    marketing: numbers["marketing"]!,
    miscMonthly: numbers["miscMonthly"]!,
    monthsToMaturity: numbers["monthsToMaturity"]!,
    serviceChargePct: numbers["serviceChargePct"]!,
    dineInSharePct: numbers["dineInSharePct"]!,
  };

  // exactOptionalPropertyTypes: only attach optionals that were actually sent.
  if (optionals["tradingDaysPerMonthOverride"] !== undefined) {
    value.tradingDaysPerMonthOverride = optionals["tradingDaysPerMonthOverride"];
  }
  if (optionals["cogsPerUnitOverride"] !== undefined) {
    value.cogsPerUnitOverride = optionals["cogsPerUnitOverride"];
  }

  return { ok: true, value };
}
