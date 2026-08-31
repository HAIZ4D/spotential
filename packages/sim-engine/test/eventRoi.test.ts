import { describe, expect, it } from "vitest";
import {
  CAPTURE_RATE_SWEEP,
  eventRoi,
  roiDefaults,
  roiSweep,
  type EventRoiInputs,
} from "../src/events/roi.js";

/**
 * Event ROI, against a HAND-COMPUTED golden vector.
 *
 * Worked on paper before the code was run, per the house rule for financial
 * logic: a formula regression has to fail loudly here rather than get quietly
 * "fixed" by pasting in whatever the implementation currently returns.
 *
 *   Korean restaurant, 3-day bazaar. Preset price RM18, COGS 32%.
 *
 *   fixedCost        = 1800 booth + (2 staff x RM120 x 3 days) + 400 transport
 *                    = 1800 + 720 + 400                         = RM2,920
 *   contribution/txn = 18 x (1 - 0.32)                           = RM12.24
 *   break-even txns  = ceil(2920 / 12.24) = ceil(238.56)         = 239
 *                      check: 238 x 12.24 = 2,913.12  (short)
 *                             239 x 12.24 = 2,925.36  (clears)
 *   per day          = ceil(239 / 3)                             = 80
 *   capture rate     = 239 / 20,000                              = 1.195% -> 1.2%
 */
const GOLDEN: EventRoiInputs = {
  boothCostRm: 1_800,
  days: 3,
  expectedVisitors: 20_000,
  avgPricePerTransaction: 18,
  cogsPct: 0.32,
  staffCount: 2,
  dailyWagePerStaff: 120,
  otherFixedRm: 400,
};

describe("the golden vector", () => {
  const roi = eventRoi(GOLDEN);

  it("totals every cost owed whether or not anyone buys", () => {
    expect(roi.fixedCost).toBe(2_920);
  });

  it("keeps contribution per transaction at the category's margin", () => {
    expect(roi.contributionPerTransaction).toBe(12.24);
  });

  it("needs 239 sales, which is 80 a day", () => {
    expect(roi.breakEvenTransactions).toBe(239);
    expect(roi.breakEvenPerDay).toBe(80);
  });

  it("expresses that as 1.2% of the claimed turnout", () => {
    expect(roi.breakEvenCaptureRatePct).toBe(1.2);
  });

  it("reads the result as workable rather than promising", () => {
    expect(roi.verdict).toBe("workable");
  });

  it("rounds the break-even UP, never down", () => {
    // 238 sales genuinely does not cover the booth. Rounding to nearest would
    // print a break-even the vendor cannot actually hit.
    const covered = 239 * roi.contributionPerTransaction;
    const short = 238 * roi.contributionPerTransaction;
    expect(short).toBeLessThan(roi.fixedCost);
    expect(covered).toBeGreaterThanOrEqual(roi.fixedCost);
  });
});

describe("the sweep, rather than one projection", () => {
  const sweep = roiSweep(GOLDEN);

  it("offers a row per capture rate", () => {
    expect(sweep.map((r) => r.captureRatePct)).toEqual([...CAPTURE_RATE_SWEEP]);
  });

  it("computes 2% by hand: 400 sales, RM7,200, RM1,976 profit", () => {
    const twoPct = sweep.find((r) => r.captureRatePct === 2);
    expect(twoPct).toEqual({
      captureRatePct: 2,
      transactions: 400,
      revenue: 7_200,
      profit: 1_976,
    });
  });

  it("loses money below the break-even capture rate", () => {
    // Break-even is 1.195%, so the 0.5% row must be a loss and the 2% a profit.
    const half = sweep.find((r) => r.captureRatePct === 0.5);
    const two = sweep.find((r) => r.captureRatePct === 2);
    expect(half?.profit).toBeLessThan(0);
    expect(two?.profit).toBeGreaterThan(0);
  });

  it("is empty when the organizer stated no turnout", () => {
    // Nothing to take a percentage OF. An empty sweep is the honest output;
    // inventing a visitor count to fill the table is not.
    expect(roiSweep({ ...GOLDEN, expectedVisitors: null })).toEqual([]);
  });
});

/**
 * The distinction the whole feature turns on: a claim that was never made and
 * a claim of zero are different, and must never render alike.
 */
describe("an unstated turnout", () => {
  const roi = eventRoi({ ...GOLDEN, expectedVisitors: null });

  it("still reports the break-even in sales, which needs no claim at all", () => {
    expect(roi.breakEvenTransactions).toBe(239);
    expect(roi.breakEvenPerDay).toBe(80);
  });

  it("refuses to express a capture rate", () => {
    expect(roi.breakEvenCaptureRatePct).toBeNull();
    expect(roi.verdict).toBe("unknown");
  });

  it("says WHY the percentage is missing instead of printing a figure", () => {
    expect(roi.note).toMatch(/has not stated an expected turnout/);
    expect(roi.note).not.toMatch(/0%/);
  });

  it("is not treated as a turnout of zero", () => {
    const claimedZero = eventRoi({ ...GOLDEN, expectedVisitors: 0 });
    // Zero visitors also yields no capture rate — but the two must not be
    // confused into scoring an event as though nobody is coming.
    expect(claimedZero.breakEvenTransactions).toBe(239);
  });
});

describe("a booth that cannot pay for itself", () => {
  it("says so rather than reporting an enormous break-even", () => {
    // COGS above 100%: every sale loses money before the booth is counted.
    const roi = eventRoi({ ...GOLDEN, cogsPct: 1.1 });

    expect(roi.contributionPerTransaction).toBeLessThan(0);
    expect(roi.breakEvenTransactions).toBeNull();
    expect(roi.verdict).toBe("impossible");
    expect(roi.note).toMatch(/No amount of footfall fixes this/);
  });
});

describe("verdict bands", () => {
  const at = (capturePct: number) => {
    // Work backwards from a target capture rate to a booth cost that produces it.
    const visitors = 10_000;
    const txns = Math.round((visitors * capturePct) / 100);
    const contribution = 12.24;
    return eventRoi({
      ...GOLDEN,
      expectedVisitors: visitors,
      boothCostRm: txns * contribution,
      staffCount: 0,
      otherFixedRm: 0,
    });
  };

  it("calls one in two hundred comfortable", () => {
    expect(at(0.5).verdict).toBe("comfortable");
  });

  it("calls one in fifty workable", () => {
    expect(at(2).verdict).toBe("workable");
  });

  it("calls one in twenty demanding", () => {
    // 5% conversion merely to break even is a lot to ask of a bazaar stall.
    expect(at(5).verdict).toBe("demanding");
  });

  it("calls one in six unlikely to pay for itself", () => {
    expect(at(16).verdict).toBe("impossible");
  });
});

describe("roiDefaults", () => {
  it("takes price and margin from the shared category presets", () => {
    // One set of cost ratios across the whole app: if these drifted, the event
    // ROI and the simulator would disagree about the same business.
    expect(roiDefaults("korean_restaurant")).toEqual({
      avgPricePerTransaction: 18,
      cogsPct: 0.32,
    });
  });
});
