import { useState } from "react";
import { downloadReport, postReport, type ReportRequestBody } from "../lib/api.js";

/**
 * "Download PDF" — Feature 4.
 *
 * The report is generated server-side, so unlike everything else on these
 * pages it can fail: the service may be cold, App Check may reject, or the
 * caller may be over quota. It says so in place rather than silently doing
 * nothing, and the page around it is unaffected either way.
 *
 * Browser print stays available alongside this. It is free, works offline, and
 * produces a printout of the screen — a different thing from the report.
 */
export function ReportButton({
  body,
  disabled = false,
  label = "Download PDF",
}: {
  body: () => ReportRequestBody;
  disabled?: boolean;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");
  const [message, setMessage] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        className="tiny"
        disabled={disabled || state === "working"}
        onClick={async () => {
          setState("working");
          setMessage(null);
          try {
            downloadReport(await postReport(body()));
            setState("idle");
          } catch (error) {
            setState("failed");
            setMessage(error instanceof Error ? error.message : "Could not generate the report.");
          }
        }}
      >
        {state === "working" ? "Preparing…" : label}
      </button>

      {state === "failed" && message && (
        <span className="tiny" style={{ color: "#dc2626" }} role="status">
          {message} Print still works.
        </span>
      )}
    </>
  );
}
