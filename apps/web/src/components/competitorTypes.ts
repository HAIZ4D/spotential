import { formatNumber } from "@spotential/sim-engine";
import type { CompetitorsResponse } from "../lib/api.js";

/** Re-exported so the panel components import one thing, not five. */
export type CompetitorsResponseShape = CompetitorsResponse;
export { formatNumber };
