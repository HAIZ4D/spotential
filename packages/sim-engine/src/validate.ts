import type { ScenarioInputs, Warning } from "./types.js";
import type { Core } from "./basis.js";
import { r2, r4 } from "./basis.js";
import { CATEGORY_PRESETS } from "./presets/categories.js";
import { DISTRICT_PRESETS } from "./presets/districts.js";
import { STATUTORY } from "./presets/statutory.js";
import { en } from "./i18n/en.js";

/**
 * Plausibility rules — SPEC §6.
 *
 * Warn, never block. Nothing stops a user entering 500 transactions/day into a
 * 20-seat shop, and the tool would otherwise cheerfully report a two-month
 * payback. But hard caps would break the legitimate cases — takeaway counters
 * and ghost kitchens genuinely have few or no seats — so every rule here is
 * advisory, specific, and carries a one-click correction where there is a
 * sensible one.
 */

const RENT_BURDEN_WARN = 0.2;
const RENT_ABOVE_MARKET_MULTIPLE = 2;
const COGS_BAND: readonly [number, number] = [0.15, 0.55];

export function validate(inputs: ScenarioInputs, c: Core): Warning[] {
  const warnings: Warning[] = [];
  const category = CATEGORY_PRESETS[inputs.businessCategory];
  const district = DISTRICT_PRESETS[inputs.district];

  // Nothing else is meaningful without revenue, so lead with it and move on.
  if (inputs.customersPerDay <= 0 || inputs.avgPricePerTransaction <= 0) {
    warnings.push({
      code: "zero_revenue",
      field: inputs.customersPerDay <= 0 ? "customersPerDay" : "avgPricePerTransaction",
      severity: "danger",
      message: en.warnings.zeroRevenue,
      suggestedValue: null,
    });
  }

  // Capacity. Skipped when there are no seats — that is a takeaway counter,
  // not a mistake.
  if (inputs.seats > 0 && inputs.customersPerDay > 0) {
    const turns = inputs.customersPerDay / inputs.seats;
    const [bandLow, bandHigh] = category.seatTurnBand;

    if (turns > bandHigh) {
      warnings.push({
        code: "seat_turns_implausible",
        field: "customersPerDay",
        severity: "warn",
        message: en.warnings.seatTurnsImplausible(
          inputs.customersPerDay,
          inputs.seats,
          inputs.openHoursPerDay,
          r2(turns),
          bandHigh,
          Math.floor(inputs.seats * bandHigh),
        ),
        suggestedValue: Math.floor(inputs.seats * bandHigh),
      });
    } else if (turns < bandLow) {
      warnings.push({
        code: "seat_turns_very_low",
        field: "seats",
        severity: "info",
        message: en.warnings.seatTurnsVeryLow(r2(turns), bandLow),
        suggestedValue: Math.max(1, Math.ceil(inputs.customersPerDay / bandLow)),
      });
    }
  }

  if (inputs.staffCount > 0 && inputs.avgMonthlyWage < STATUTORY.minimumWage.monthly) {
    warnings.push({
      code: "wage_below_minimum",
      field: "avgMonthlyWage",
      severity: "danger",
      message: en.warnings.wageBelowMinimum(inputs.avgMonthlyWage, STATUTORY.minimumWage.monthly),
      suggestedValue: STATUTORY.minimumWage.monthly,
    });
  }

  const medianRentForSize = district.rentMedianPsf * district.typicalUnitSqft;
  if (inputs.monthlyRent > medianRentForSize * RENT_ABOVE_MARKET_MULTIPLE) {
    warnings.push({
      code: "rent_above_market",
      field: "monthlyRent",
      severity: "warn",
      message: en.warnings.rentAboveMarket(
        inputs.monthlyRent,
        medianRentForSize,
        r2(inputs.monthlyRent / medianRentForSize),
      ),
      suggestedValue: Math.round(medianRentForSize),
    });
  }

  if (c.revenue > 0) {
    const burden = inputs.monthlyRent / c.revenue;
    if (burden > RENT_BURDEN_WARN) {
      warnings.push({
        code: "rent_burden_high",
        field: "monthlyRent",
        severity: "danger",
        message: en.warnings.rentBurdenHigh(r4(burden)),
        suggestedValue: Math.round(c.revenue * 0.12),
      });
    }
  }

  if (inputs.cogsPct < COGS_BAND[0] || inputs.cogsPct > COGS_BAND[1]) {
    warnings.push({
      code: "cogs_out_of_band",
      field: "cogsPct",
      severity: "warn",
      message: en.warnings.cogsOutOfBand(r4(inputs.cogsPct)),
      suggestedValue: category.cogsPct,
    });
  }

  // Advice, not a cost line: surfaced so the toggle is a decision rather than
  // something that silently starts taxing a business that just grew.
  const threshold = STATUTORY.serviceTax.registrationThresholdAnnual;
  if (!inputs.sstRegistered && c.annualRevenue >= threshold) {
    warnings.push({
      code: "sst_threshold_crossed",
      field: "sstRegistered",
      severity: "info",
      message: en.warnings.sstThresholdCrossed(r2(c.annualRevenue), threshold),
      suggestedValue: null,
    });
  }

  return warnings;
}
