import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";
import { ReportDocument } from "./template.js";
import type { ReportModel } from "./model.js";

export { buildComparisonReport, buildLocationReport, buildScenarioReport } from "./model.js";
export type { LocationReportInput, ReportModel } from "./model.js";

/** Render a model to PDF bytes. The only place react-pdf is actually invoked. */
export async function renderReport(model: ReportModel): Promise<Buffer> {
  // renderToBuffer wants ReactElement<DocumentProps>, but a wrapper component
  // is typed by its OWN props, so the two never line up. The wrapper does
  // return a <Document>; the cast just tells TypeScript what react-pdf already
  // asserts at runtime.
  const element = createElement(ReportDocument, { model }) as unknown as ReactElement<DocumentProps>;
  return renderToBuffer(element);
}
