import {
  CATEGORY_PRESETS,
  DISTRICT_PRESETS,
  STATUTORY,
  formatCurrency,
  formatPercent,
  listCategories,
  listDistricts,
  type BusinessCategory,
  type DistrictId,
} from "@spotential/sim-engine";
import { NumberField } from "./NumberField.js";
import { CollapsibleGroup } from "./sim/CollapsibleGroup.js";
import { LeverRank } from "./sim/LeverRank.js";
import { RampSparkline } from "./RampSparkline.js";
import type { ScenarioState } from "../state/useScenario.js";

/**
 * The input column — SPEC §7.1.
 *
 * Every seeded field shows where its starting value came from. No number
 * appears without a provenance the user can inspect, because the whole
 * premise of preset-seeding is that the defaults are defensible.
 */
export function InputPanel({ scenario }: { scenario: ScenarioState }) {
  const { inputs, result, aiTouched, setField, setCategory, setDistrict } = scenario;
  const category = CATEGORY_PRESETS[inputs.businessCategory];
  const district = DISTRICT_PRESETS[inputs.district];

  const touched = (f: string) => aiTouched.has(f);

  return (
    <>
      {/* THE FOUR LEVERS.
          Not a design hunch: `LeverField` in the engine names exactly these
          four, and the sensitivity sweep moves exactly these four. The old
          form spread them across two cards among thirteen others, so "Misc &
          maintenance" looked as consequential as the price — while the panel
          at the bottom of the same page said the price was the strongest
          lever on screen. This is the form agreeing with the analysis. */}
      <section className="card sim-levers">
        <header>
          <h2>Key levers</h2>
          <span className="pill navy">move the answer most</span>
        </header>
        <div className="body">
          <div className="lever">
            <NumberField
                        label="Average price per transaction"
                        value={inputs.avgPricePerTransaction}
                        onChange={(v) => setField("avgPricePerTransaction", v)}
                        sliderMax={80}
                        step={0.5}
                        prefix="RM"
                        aiTouched={touched("avgPricePerTransaction")}
                        source="Per paying bill, not per head, and net of tax."
                      />
            <LeverRank field="avgPricePerTransaction" sensitivity={result.sensitivity} />
          </div>
          <div className="lever">
            <NumberField
                        label="Transactions per day"
                        value={inputs.customersPerDay}
                        onChange={(v) => setField("customersPerDay", v)}
                        sliderMax={500}
                        aiTouched={touched("customersPerDay")}
                        source={`${category.label} typical: ${category.customersPerDay}/day`}
                      />
            <LeverRank field="customersPerDay" sensitivity={result.sensitivity} />
          </div>
          <div className="lever">
            <NumberField
                        label="Monthly rent"
                        value={inputs.monthlyRent}
                        onChange={(v) => setField("monthlyRent", v)}
                        sliderMax={40000}
                        step={100}
                        prefix="RM"
                        aiTouched={touched("monthlyRent")}
                        source={`District median for this size: ${formatCurrency(
                          district.rentMedianPsf * district.typicalUnitSqft,
                        )}`}
                      />
            <LeverRank field="monthlyRent" sensitivity={result.sensitivity} />
          </div>
          <div className="lever">
            <NumberField
                        label="Cost of goods"
                        value={Number((inputs.cogsPct * 100).toFixed(2))}
                        onChange={(v) => setField("cogsPct", v / 100)}
                        sliderMax={70}
                        step={0.5}
                        suffix={<span className="source">%</span>}
                        aiTouched={touched("cogsPct")}
                        source={`RM${result.derived.cogsPerUnit.toFixed(2)} per transaction — held constant when you change price`}
                      />
            <LeverRank field="cogsPct" sensitivity={result.sensitivity} />
          </div>
        </div>
      </section>

      <CollapsibleGroup title="Your business" count={2} defaultOpen>
        <div>
          <div className="field">
            <label htmlFor="category">Business type</label>
            <select
              id="category"
              value={inputs.businessCategory}
              onChange={(e) => setCategory(e.target.value as BusinessCategory)}
            >
              {listCategories().map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <span className="source">{category.source}</span>
          </div>

          <div className="field">
            <label htmlFor="district">District</label>
            <select
              id="district"
              value={inputs.district}
              onChange={(e) => setDistrict(e.target.value as DistrictId)}
            >
              {listDistricts().map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
            <span className="source">
              median RM{district.rentMedianPsf}/sqft · typical unit {district.typicalUnitSqft} sqft
            </span>
          </div>
        </div>
      </CollapsibleGroup>

      <CollapsibleGroup title="Trading pattern" count={3}>
          <NumberField
            label="Days open per week"
            value={inputs.daysOpenPerWeek}
            onChange={(v) => setField("daysOpenPerWeek", v)}
            min={1}
            sliderMax={7}
            source={`= ${result.derived.tradingDaysPerMonth.toFixed(2)} trading days/month`}
          />
          <NumberField
            label="Seats"
            value={inputs.seats}
            onChange={(v) => setField("seats", v)}
            sliderMax={150}
            source="Used only for the capacity plausibility check."
          />
          <NumberField
            label="Open hours per day"
            value={inputs.openHoursPerDay}
            onChange={(v) => setField("openHoursPerDay", v)}
            min={1}
            sliderMax={24}
          />
      </CollapsibleGroup>

      <CollapsibleGroup title="Running costs" count={6}>
          <NumberField
            label="Staff (full-time equivalent)"
            value={inputs.staffCount}
            onChange={(v) => setField("staffCount", Math.round(v))}
            sliderMax={20}
          />
          <NumberField
            label="Average monthly wage"
            value={inputs.avgMonthlyWage}
            onChange={(v) => setField("avgMonthlyWage", v)}
            sliderMax={8000}
            step={50}
            prefix="RM"
            source={`Statutory minimum ${formatCurrency(
              STATUTORY.minimumWage.monthly,
            )}. EPF ${formatPercent(result.steady.staffBreakdown.epfRateApplied, 0)} + SOCSO + EIS added automatically.`}
          />
          <NumberField
            label="Utilities"
            value={inputs.utilities}
            onChange={(v) => setField("utilities", v)}
            sliderMax={15000}
            step={50}
            prefix="RM"
          />
          <NumberField
            label="Marketing"
            value={inputs.marketing}
            onChange={(v) => setField("marketing", v)}
            sliderMax={10000}
            step={50}
            prefix="RM"
          />
          <NumberField
            label="Licensing & permits"
            value={inputs.licensingFees}
            onChange={(v) => setField("licensingFees", v)}
            sliderMax={3000}
            step={25}
            prefix="RM"
          />
          <NumberField
            label="Misc & maintenance"
            value={inputs.miscMonthly}
            onChange={(v) => setField("miscMonthly", v)}
            sliderMax={10000}
            step={50}
            prefix="RM"
          />
      </CollapsibleGroup>

      <CollapsibleGroup title="Getting started" count={3}>
          <NumberField
            label="Initial investment"
            value={inputs.initialInvestment}
            onChange={(v) => setField("initialInvestment", v)}
            sliderMax={500000}
            step={1000}
            prefix="RM"
            source="Fit-out, equipment, opening stock. Excludes the rent deposit."
          />
          <NumberField
            label="Rent deposit"
            value={inputs.securityDepositMonths}
            onChange={(v) => setField("securityDepositMonths", v)}
            sliderMax={12}
            suffix={<span className="source">months</span>}
            source={`= ${formatCurrency(
              inputs.securityDepositMonths * inputs.monthlyRent,
            )} refundable, but out of your pocket now`}
          />
          <NumberField
            label="Months to full capacity"
            value={inputs.monthsToMaturity}
            onChange={(v) => setField("monthsToMaturity", Math.max(1, Math.round(v)))}
            min={1}
            sliderMax={18}
            source="New outlets do not hit full covers in month one."
          >
            <RampSparkline monthsToMaturity={inputs.monthsToMaturity} />
          </NumberField>
      </CollapsibleGroup>

      <CollapsibleGroup title="Tax & service charge" count={2}>
        <div className="stack">
          <label className="spread" style={{ fontSize: 13, cursor: "pointer" }}>
            <span>
              Registered for service tax
              <div className="tiny muted">
                {formatPercent(STATUTORY.serviceTax.rate, 0)} on dine-in revenue only. Threshold{" "}
                {formatCurrency(STATUTORY.serviceTax.registrationThresholdAnnual)}/year.
              </div>
            </span>
            <input
              type="checkbox"
              checked={inputs.sstRegistered}
              onChange={(e) => setField("sstRegistered", e.target.checked)}
            />
          </label>

          {inputs.sstRegistered && (
            <NumberField
              label="Dine-in share of revenue"
              value={Number((inputs.dineInSharePct * 100).toFixed(0))}
              onChange={(v) => setField("dineInSharePct", v / 100)}
              sliderMax={100}
              suffix={<span className="source">%</span>}
              source={
                result.steady.sstApplies
                  ? `Service tax ${formatCurrency(result.steady.serviceTax)}/month`
                  : "Below the threshold — no service tax applies yet."
              }
            />
          )}

          <label className="spread" style={{ fontSize: 13, cursor: "pointer" }}>
            <span>
              Charge 10% service charge
              <div className="tiny muted">
                Collected from customers and passed to staff — it never reaches profit.
              </div>
            </span>
            <input
              type="checkbox"
              checked={inputs.serviceChargePct > 0}
              onChange={(e) => setField("serviceChargePct", e.target.checked ? 0.1 : 0)}
            />
          </label>
        </div>
      </CollapsibleGroup>
    </>
  );
}
