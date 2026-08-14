/**
 * The data contract for the What-if Simulator.
 *
 * This file is imported by the browser AND by the Cloud Run service. There is
 * exactly one definition of every shape, which is what makes the client/server
 * parity test (SPEC §12) a tautology rather than a hope.
 */

export type BusinessCategory =
  | "korean_restaurant"
  | "cafe_coffee_shop"
  | "casual_dining"
  | "bubble_tea_dessert"
  | "fast_casual_takeaway"
  | "other_fnb";

/**
 * Curated commercial rent benchmarks — NOT DOSM administrative districts.
 *
 * These are F&B trading areas, which is the granularity rent actually varies
 * at: Bangsar and Cheras sit in the same federal territory and differ by more
 * than 2x. A pin resolves to the nearest of these within a stated radius, or
 * to nothing at all. See presets/districts.ts.
 */
export type DistrictId =
  // Kuala Lumpur
  | "klcc"
  | "bukit_bintang"
  | "mont_kiara"
  | "bangsar"
  | "ttdi"
  | "sri_hartamas"
  | "kl_sentral"
  | "jalan_tar_dang_wangi"
  | "setapak"
  | "cheras"
  | "wangsa_maju"
  | "sri_petaling"
  // Selangor
  | "damansara_uptown"
  | "ss15_subang"
  | "ss2_pj"
  | "pj_section_14"
  | "kota_damansara"
  | "puchong_bandar_puteri"
  | "shah_alam_seksyen_13"
  | "cyberjaya"
  // Penang
  | "georgetown"
  | "bayan_lepas"
  // Johor
  | "jb_city_centre";

/** Fields a sensitivity sweep or an AI patch is allowed to move. */
export type LeverField =
  | "avgPricePerTransaction"
  | "customersPerDay"
  | "cogsPct"
  | "monthlyRent";

export interface ScenarioInputs {
  businessCategory: BusinessCategory;
  district: DistrictId;

  /** Fit-out, equipment, licensing, opening stock. EXCLUDES the rent deposit. */
  initialInvestment: number;
  monthlyRent: number;
  /** Malaysian norm quoted as 3 months deposit + 3 months advance. Refundable, so cash-only. */
  securityDepositMonths: number;

  /** Per paying TRANSACTION, net of tax. A table of three paying RM54 is one transaction at RM54. */
  avgPricePerTransaction: number;
  /** Transactions per trading day. */
  customersPerDay: number;

  seats: number;
  openHoursPerDay: number;
  daysOpenPerWeek: number;
  /** Escape hatch for golden vectors and for users who know their own calendar. */
  tradingDaysPerMonthOverride?: number;

  /** Entered as a percentage; held per-unit by the engine. See SPEC §4.3. */
  cogsPct: number;
  /**
   * The per-unit cost, pinned. SPEC §4.3: cost per unit is derived from
   * cogsPct x price at the moment of entry and then HELD while price varies —
   * charging RM20 for the same bowl of jjigae does not make the ingredients
   * more expensive. Set by the price slider and by the sensitivity sweep;
   * left undefined, the engine derives it from cogsPct x price.
   */
  cogsPerUnitOverride?: number;

  staffCount: number;
  /** Per FTE, BEFORE employer statutory contributions. */
  avgMonthlyWage: number;

  utilities: number;
  licensingFees: number;
  marketing: number;
  miscMonthly: number;

  /** The single ramp control. */
  monthsToMaturity: number;

  /** 0 = off. When on, it is collected and paid straight out to staff. */
  serviceChargePct: number;

  sstRegistered: boolean;
  /** Share of revenue that is dine-in — the service tax base. SPEC §4.5. */
  dineInSharePct: number;
}

export interface DerivedValues {
  tradingDaysPerMonth: number;
  monthlyTransactions: number;
  cogsPerUnit: number;
  contributionPerTransaction: number;
}

export interface StaffBreakdown {
  baseWages: number;
  epf: number;
  socso: number;
  eis: number;
  total: number;
  /** 0.13 or 0.12 — surfaced so the UI can explain the tier cliff. */
  epfRateApplied: number;
}

export interface SteadyState {
  /** Net of service charge — the figure every margin calculation uses. */
  revenue: number;
  /** Revenue plus service charge. Shown to the user, never used for profit. */
  grossRevenue: number;
  serviceChargeCollected: number;
  serviceChargePayout: number;

  annualRevenue: number;
  sstApplies: boolean;
  serviceTax: number;

  cogs: number;
  staffCost: number;
  staffBreakdown: StaffBreakdown;
  fixedMonthlyCosts: number;
  totalExpenses: number;
  profit: number;
}

export interface CostLine {
  key: string;
  amount: number;
  pctOfRevenue: number;
}

export interface ProjectionMonth {
  month: number;
  ramp: number;
  transactionsPerDay: number;
  revenue: number;
  grossRevenue: number;
  cogs: number;
  contribution: number;
  serviceTax: number;
  profit: number;
  cumulativeProfit: number;
  cash: number;
}

export interface BreakEven {
  /** null when contribution per transaction is <= 0 — unreachable at any volume. */
  operatingTransactionsPerDay: number | null;
  /** null when the scenario never recovers the investment within the horizon. */
  paybackMonth: number | null;
  paybackBandLow: number | null;
  paybackBandHigh: number | null;
  cashBreakEvenMonth: number | null;
  neverBreaksEven: boolean;
}

export interface CashPosition {
  outlayAtMonth0: number;
  troughMonth: number;
  troughAmount: number;
  /** Absolute runway the owner must actually have. Usually well above initialInvestment. */
  peakCashRequirement: number;
}

export interface SensitivityEntry {
  field: LeverField;
  paybackAtMinus20: number | null;
  paybackAtPlus20: number | null;
  /** Months between the two. null paybacks are treated as the horizon for ranking. */
  spread: number;
}

/**
 * Only present when the scenario never breaks even. Each lever holds the value
 * that would reach break-even, or null when that lever cannot get there at all
 * (e.g. rent would have to go negative). SPEC §4.11.
 */
export interface Recovery {
  customersPerDay: number | null;
  avgPricePerTransaction: number | null;
  monthlyRent: number | null;
  cogsPct: number | null;
  closestLever: LeverField | null;
}

export type WarningSeverity = "info" | "warn" | "danger";

export interface Warning {
  code: string;
  field: keyof ScenarioInputs | null;
  severity: WarningSeverity;
  message: string;
  /** Value the one-click correction would apply, when there is a sensible one. */
  suggestedValue: number | null;
}

export interface SimulationResult {
  engineVersion: string;
  presetVersion: string;
  derived: DerivedValues;
  steady: SteadyState;
  costBreakdown: CostLine[];
  /** Months 0..24 inclusive — 25 entries. Month 0 carries the opening cash position only. */
  projection: ProjectionMonth[];
  breakEven: BreakEven;
  cash: CashPosition;
  sensitivity: SensitivityEntry[];
  recovery: Recovery | null;
  warnings: Warning[];
}

/** AI patch and share-URL grammar. SPEC §8.2. */
export type PatchOp = "set" | "mul" | "add" | "pct_delta";

export interface Operation {
  field: LeverField | keyof ScenarioInputs;
  op: PatchOp;
  value: number;
}

export interface ScenarioPatch {
  label: string;
  operations: Operation[];
  rationale?: string;
}
