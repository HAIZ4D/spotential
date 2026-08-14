import { useState } from "react";
import {
  csvFilename,
  projectionToCsv,
  type ScenarioInputs,
  type SimulationResult,
} from "@spotential/sim-engine";
import { scenarioHref } from "../lib/shareUrl.js";

/**
 * Share and export — SPEC §7.8.
 *
 * A link and a spreadsheet, which between them cover how an SME actually
 * passes this on: WhatsApp to a business partner, Excel to an accountant.
 */
export function ShareBar({
  inputs,
  result,
}: {
  inputs: ScenarioInputs;
  result: SimulationResult;
}) {
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    const href = scenarioHref(inputs);
    try {
      await navigator.clipboard.writeText(href);
    } catch {
      // Clipboard is blocked without a user gesture in some browsers, and over
      // plain http. Falling back to a prompt beats silently doing nothing.
      window.prompt("Copy this link", href);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadCsv = () => {
    const blob = new Blob([projectionToCsv(inputs, result)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = csvFilename(inputs);
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <button type="button" className="tiny" onClick={copyLink}>
        {copied ? "Link copied" : "Copy link"}
      </button>
      <button type="button" className="tiny" onClick={downloadCsv}>
        Download CSV
      </button>
    </>
  );
}
