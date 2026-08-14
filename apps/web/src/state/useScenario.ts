import { useCallback, useMemo, useState } from "react";
import {
  applyFieldValue,
  seedScenario,
  simulate,
  type BusinessCategory,
  type DistrictId,
  type PatchableField,
  type ScenarioInputs,
  type SimulationResult,
} from "@spotential/sim-engine";
import { CATEGORY_PRESETS, seedMonthlyRent } from "@spotential/sim-engine";

/**
 * Scenario state.
 *
 * Recalculation is SYNCHRONOUS and unthrottled — the engine is arithmetic on a
 * few dozen values, so there is nothing to debounce and no spinner ever
 * appears on this path. useMemo is enough.
 */

/**
 * The numeric fields a user may edit.
 *
 * Listed explicitly rather than derived from ScenarioInputs, so the internal
 * pins — cogsPerUnitOverride, tradingDaysPerMonthOverride — cannot be set from
 * the UI by accident. Those are maintained by the engine and by
 * applyFieldChange below, never typed in.
 */
export type NumericField =
  | "initialInvestment"
  | "monthlyRent"
  | "securityDepositMonths"
  | "avgPricePerTransaction"
  | "customersPerDay"
  | "seats"
  | "openHoursPerDay"
  | "daysOpenPerWeek"
  | "cogsPct"
  | "staffCount"
  | "avgMonthlyWage"
  | "utilities"
  | "licensingFees"
  | "marketing"
  | "miscMonthly"
  | "monthsToMaturity"
  | "serviceChargePct"
  | "dineInSharePct";

/**
 * A slider edit and an AI patch go through the SAME engine function, so the
 * SPEC §4.3 price/cost invariant has exactly one implementation and the two
 * paths cannot drift apart.
 */
export function applyFieldChange(
  inputs: ScenarioInputs,
  field: NumericField | "sstRegistered",
  value: number | boolean,
): ScenarioInputs {
  if (field === "sstRegistered") {
    return { ...inputs, sstRegistered: Boolean(value) };
  }
  return applyFieldValue(inputs, field as PatchableField, Number(value));
}

export interface ScenarioState {
  inputs: ScenarioInputs;
  result: SimulationResult;
  baseline: ScenarioInputs;
  baselineResult: SimulationResult;
  isDirty: boolean;
  aiTouched: ReadonlySet<string>;
  setField: (field: NumericField | "sstRegistered", value: number | boolean) => void;
  setCategory: (category: BusinessCategory) => void;
  setDistrict: (district: DistrictId) => void;
  markAiTouched: (fields: string[]) => void;
  /** Apply a server-computed AI scenario to a branch, leaving the baseline pinned. */
  applyAiScenario: (inputs: ScenarioInputs, changed: string[]) => void;
  pinBaseline: () => void;
  revertToBaseline: () => void;
}

export function useScenario(initial?: ScenarioInputs): ScenarioState {
  const seed = useMemo(() => initial ?? seedScenario("korean_restaurant", "mont_kiara"), [initial]);

  const [inputs, setInputs] = useState<ScenarioInputs>(seed);
  const [baseline, setBaseline] = useState<ScenarioInputs>(seed);
  const [aiTouched, setAiTouched] = useState<ReadonlySet<string>>(new Set());

  const result = useMemo(() => simulate(inputs), [inputs]);
  const baselineResult = useMemo(() => simulate(baseline), [baseline]);

  const setField = useCallback<ScenarioState["setField"]>((field, value) => {
    setInputs((prev) => applyFieldChange(prev, field, value));
    setAiTouched((prev) => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  }, []);

  // Switching category reseeds the cost shape but keeps the district's rent.
  const setCategory = useCallback<ScenarioState["setCategory"]>((category) => {
    setInputs((prev) => {
      const preset = CATEGORY_PRESETS[category];
      const next = seedScenario(category, prev.district);
      next.monthlyRent = prev.monthlyRent;
      next.initialInvestment = preset.initialInvestment;
      return next;
    });
  }, []);

  const setDistrict = useCallback<ScenarioState["setDistrict"]>((district) => {
    setInputs((prev) => ({ ...prev, district, monthlyRent: seedMonthlyRent(district) }));
  }, []);

  const markAiTouched = useCallback((fields: string[]) => {
    setAiTouched(new Set(fields));
  }, []);

  /**
   * SPEC §7.3 — the patch lands on a BRANCH, not the baseline.
   *
   * The inputs the server returns are used verbatim rather than reapplied
   * locally, so what the narration describes and what the panel shows are
   * guaranteed to be the same scenario.
   */
  const applyAiScenario = useCallback<ScenarioState["applyAiScenario"]>((next, changed) => {
    setInputs(next);
    setAiTouched(new Set(changed));
  }, []);

  const pinBaseline = useCallback(() => {
    setInputs((current) => {
      setBaseline(current);
      return current;
    });
    setAiTouched(new Set());
  }, []);

  const revertToBaseline = useCallback(() => {
    setInputs(baseline);
    setAiTouched(new Set());
  }, [baseline]);

  const isDirty = useMemo(
    () => JSON.stringify(inputs) !== JSON.stringify(baseline),
    [inputs, baseline],
  );

  return {
    inputs,
    result,
    baseline,
    baselineResult,
    isDirty,
    aiTouched,
    setField,
    setCategory,
    setDistrict,
    markAiTouched,
    applyAiScenario,
    pinBaseline,
    revertToBaseline,
  };
}
