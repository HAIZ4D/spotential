/**
 * Malaysian statutory rates.
 *
 * Every value carries a source and a review date, and they live here rather
 * than scattered through the code so that a policy change is a one-line edit
 * plus a golden-vector update — not a hunt through the codebase.
 *
 * Reviewed 2026-08-12.
 */

export const STATUTORY_REVIEWED = "2026-08-12" as const;

export const STATUTORY = {
  reviewed: STATUTORY_REVIEWED,

  epf: {
    /** Employer rate for wages at or below the tier wage. */
    employerRateAtOrBelowTier: 0.13,
    /** Employer rate above it. Crossing the tier makes an employee CHEAPER — see golden vectors. */
    employerRateAboveTier: 0.12,
    tierWage: 5000,
    /** Deducted from the employee's own wage. NOT an employer cost — never add to staffCost. */
    employeeRate: 0.11,
    /** No wage ceiling: the rate applies to the full wage. */
    wageCeiling: null,
    source: "KWSP contribution schedule",
  },

  socso: {
    employerRate: 0.0175,
    /** Employee-side. Recorded for completeness; not an employer cost. */
    employeeRate: 0.005,
    wageCeiling: 6000,
    source: "PERKESO",
    // ⚠️ OPEN VERIFICATION (SPEC §4.4)
    // One source indicates a 2026 change taking the employer injury-scheme
    // portion to 1.35%. Confirm directly against perkeso.gov.my before the
    // first real user sees a number.
    //
    // Impact at the worked example's payroll (4 FTE x RM2,000): the employer
    // SOCSO line moves RM140 -> RM108. About 0.1% of fixed costs — immaterial
    // to the headline, but wrong is wrong on a figure an SME may hand to an
    // accountant. Change this constant and re-verify the golden vectors.
    openVerification: {
      claimedRate: 0.0135,
      claimedEffective: "2026",
      checkAgainst: "https://www.perkeso.gov.my",
    },
  },

  eis: {
    employerRate: 0.002,
    /** Employee-side. Not an employer cost. */
    employeeRate: 0.002,
    wageCeiling: 6000,
    source: "PERKESO",
  },

  minimumWage: {
    monthly: 1700,
    source: "Minimum Wages Order",
  },

  serviceTax: {
    rate: 0.06,
    /** Applies to the dine-in portion of revenue only. Drives `dineInSharePct`. */
    dineInOnly: true,
    registrationThresholdAnnual: 1_500_000,
    source: "RMCD",
  },
} as const;
