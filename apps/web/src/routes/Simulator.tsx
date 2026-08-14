import { useMemo } from "react";
import { en } from "@spotential/sim-engine";
import { useScenario, type NumericField } from "../state/useScenario.js";
import { readScenarioFromUrl, useUrlSync } from "../lib/shareUrl.js";
import { Masthead } from "../components/Masthead.js";
import { ShareBar } from "../components/ShareBar.js";
import { AskPanel } from "../components/AskPanel.js";
import { KpiStrip } from "../components/sim/KpiStrip.js";
import { InputPanel } from "../components/InputPanel.js";
import { ProjectionChart } from "../components/ProjectionChart.js";
import { CostBreakdown } from "../components/CostBreakdown.js";
import { BreakEvenPanel } from "../components/BreakEvenPanel.js";
import { SensitivityPanel } from "../components/SensitivityPanel.js";
import { RecoveryPanel } from "../components/RecoveryPanel.js";
import { WarningsPanel } from "../components/WarningsPanel.js";
import { ParityBadge } from "../components/ParityBadge.js";
import { ReportButton } from "../components/ReportButton.js";

export default function Simulator() {
  // A shared link seeds initial state. Read once, before first render — it is
  // the whole persistence layer in v1, not an afterthought applied in an effect.
  const fromLink = useMemo(() => readScenarioFromUrl(), []);

  const scenario = useScenario(fromLink.ok ? fromLink.inputs : undefined);
  const { inputs, result, baselineResult, isDirty, setField, pinBaseline, revertToBaseline } =
    scenario;

  useUrlSync(inputs);

  const apply = (field: NumericField, value: number) => setField(field, value);

  return (
    <>
      <Masthead subtitle="What-if Simulator">
        <ParityBadge inputs={inputs} localResult={result} />
        <ShareBar inputs={inputs} result={result} />
        {/* A typeset report, distinct from Print, which produces a printout of
            this screen. Both are kept: print is free and works offline. */}
        <ReportButton body={() => ({ kind: "scenario", inputs })} />
        <button type="button" className="tiny" onClick={() => window.print()}>
          Print
        </button>
      </Masthead>

      {fromLink.ok && fromLink.stale && (
        <div className="notice info no-print" style={{ margin: 0, borderRadius: 0 }}>
          This link was created with preset data from {fromLink.presetVersion} (engine{" "}
          {fromLink.engineVersion}). Current figures may differ from what the sender saw.
        </div>
      )}

      {!fromLink.ok && window.location.search.includes("s=") && (
        <div className="notice danger no-print" style={{ margin: 0, borderRadius: 0 }}>
          That shared link could not be read ({fromLink.reason}). Starting from defaults instead.
        </div>
      )}

      <KpiStrip result={result} baseline={baselineResult} showDeltas={isDirty} />

      {isDirty && (
        <div
          className="no-print"
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            padding: "8px 16px",
            borderBottom: "1px solid var(--line)",
            background: "var(--surface)",
            fontSize: 13,
          }}
        >
          <span className="muted">Comparing against your pinned baseline.</span>
          <button type="button" className="tiny" onClick={revertToBaseline}>
            {en.ai.revert}
          </button>
          <button type="button" className="tiny cta" onClick={pinBaseline}>
            Pin this as the new baseline
          </button>
        </div>
      )}

      <div className="layout">
        <aside className="col-inputs no-print">
          <AskPanel scenario={scenario} />
          <InputPanel scenario={scenario} />
        </aside>

        <main className="col-detail">
          <WarningsPanel result={result} onApply={apply} />
          {result.recovery && <RecoveryPanel result={result} onApply={apply} />}
          <ProjectionChart result={result} />
          <BreakEvenPanel result={result} />
          <CostBreakdown result={result} />
          <SensitivityPanel result={result} />

          <section className="card">
            <header>
              <h2>Assumptions</h2>
            </header>
            <div className="body stack small muted">
              <span>{en.assumptions.noElasticity}</span>
              <span>{en.assumptions.flatDemand}</span>
              <span>{en.assumptions.presetsEstimated}</span>
              <span>{en.assumptions.cashSimplified}</span>
              <span>{en.assumptions.noOwnerDrawings}</span>
              <span className="tiny">
                Engine {result.engineVersion} · presets {result.presetVersion} · statutory rates
                reviewed 2026-08-12.
              </span>
            </div>
          </section>
        </main>
      </div>
    </>
  );
}
