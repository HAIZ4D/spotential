import { describe, expect, it } from "vitest";
import {
  LEGEND,
  SATURATION_POPULATION,
  colourAt,
  colourAtMono,
  percentileFor,
  weightFor,
} from "../src/components/heatmap/ramp.js";

/**
 * The heat surface's colour scale.
 *
 * Two things here can go wrong silently and would change what the whole map
 * claims without breaking anything: the ramp reversing, and the calibration
 * drifting to whatever is on screen. Both are pinned.
 */

const rgb = (css: string) => (css.match(/\d+/g) ?? []).map(Number);

describe("the ramp runs green to red, in that order", () => {
  it("is green at the cold end and red at the hot end", () => {
    const cold = rgb(colourAt(0));
    const hot = rgb(colourAt(1));

    // Green: more green than red. Red: the reverse.
    expect(cold[1]).toBeGreaterThan(cold[0]!);
    expect(hot[0]).toBeGreaterThan(hot[1]!);
  });

  it("passes through yellow in the middle", () => {
    // Yellow is high red AND high green together — the thing that makes the
    // gradient read as a heat scale rather than a two-colour blend.
    const mid = rgb(colourAt(0.72));
    expect(mid[0]).toBeGreaterThan(180);
    expect(mid[1]).toBeGreaterThan(150);
    expect(mid[2]).toBeLessThan(120);
  });

  it("gets monotonically hotter as density rises", () => {
    /**
     * Measured as red MINUS green, not red alone.
     *
     * Red alone is not monotonic on a real heat ramp and should not be: the
     * orange midpoint carries more red channel (244) than the final red does
     * (214), because orange is red plus green. What must never reverse is how
     * red the colour reads against its green, which is what carries the
     * meaning.
     */
    let previous = -Infinity;
    for (const p of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const [r, g] = rgb(colourAt(p));
      const redness = r! - g!;
      expect(redness).toBeGreaterThan(previous);
      previous = redness;
    }
  });

  it("clamps rather than extrapolating outside 0..1", () => {
    expect(colourAt(-5)).toBe(colourAt(0));
    expect(colourAt(99)).toBe(colourAt(1));
  });
});

/**
 * The calibration, and the reason this file matters most.
 *
 * A heat surface normalises to the busiest thing in view unless something
 * stops it, which would paint suburban Petaling Jaya exactly as red as central
 * Kuala Lumpur and make the cities incomparable — the relative-normalisation
 * trap that has already inverted this project's scoring twice.
 */
describe("weight is fixed to a national scale", () => {
  it("saturates at the national 90th percentile, not at the local maximum", () => {
    // 7,213 residents in a 500m catchment is the engine's measured p90.
    expect(SATURATION_POPULATION).toBe(7_213);
    expect(weightFor(SATURATION_POPULATION)).toBe(1);
  });

  it("gives the same weight to the same density, wherever it is", () => {
    // The whole point: a cell of 3,000 people weighs the same in KL as in
    // Johor Bahru. Nothing about the surrounding cells enters the function.
    expect(weightFor(3_000)).toBe(weightFor(3_000));
    expect(weightFor(3_000)).toBeCloseTo(3_000 / 7_213, 10);
  });

  it("is monotonic and bounded", () => {
    expect(weightFor(0)).toBe(0);
    expect(weightFor(-100)).toBe(0);
    expect(weightFor(500_000)).toBe(1);
    expect(weightFor(1_000)).toBeLessThan(weightFor(5_000));
  });

  it("does not saturate a typical suburb", () => {
    // Suburban PJ measures about 3,356 residents in 500m. It should read as
    // warm, not maxed out, or the scale tells you nothing.
    expect(weightFor(3_356)).toBeLessThan(0.6);
    expect(weightFor(3_356)).toBeGreaterThan(0.3);
  });

  it("saturates central KL", () => {
    // 6,457 residents within 500m — the figure quoted throughout the docs.
    expect(weightFor(6_457)).toBeGreaterThan(0.85);
  });
});

describe("the legend explains the ramp in words", () => {
  it("runs hottest first", () => {
    const percentiles = LEGEND.map((row) => row.percentile);
    expect(percentiles).toEqual([...percentiles].sort((a, b) => b - a));
  });

  it("says what each end MEANS, not just how dense it is", () => {
    expect(LEGEND[0]!.label).toBe("Most people");

    const coldest = LEGEND[LEGEND.length - 1]!;
    expect(coldest.label).toBe("Few people");
    // The specific misreading the green ramp invites.
    expect(coldest.note).toMatch(/almost nobody lives here/);
  });

  it("keeps the checkable percentile alongside the plain words", () => {
    for (const row of LEGEND) {
      expect(row.note.length).toBeGreaterThan(3);
      expect(row.colour).toMatch(/^rgb\(/);
    }
  });
});

describe("percentileFor still backs the inspector", () => {
  it("puts central KL where the published figure says", () => {
    expect(Math.round(percentileFor(6_457) * 100)).toBe(87);
  });
});

/**
 * The single-hue ramp, for drawing this surface on the Location page.
 *
 * `/analysis` paints green for a dimension that scores well, inches from the
 * map, while the traffic ramp above means the opposite by green — the heatmap
 * page says so outright. On one screen the same colour would say "good" and
 * "almost nobody lives here" at once, so that page gets a ramp that carries no
 * verdict at all. These tests are what stop it quietly acquiring one.
 */
describe("the mono ramp carries no verdict", () => {
  const SAMPLES = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1];

  it("is never green-dominant or red-dominant at any point", () => {
    for (const p of SAMPLES) {
      const [r, g, b] = rgb(colourAtMono(p));
      // Blue leads everywhere: that is what makes it one hue rather than a
      // scale someone could read as good-to-bad.
      expect(b, `blue should lead at ${p}`).toBeGreaterThan(r!);
      expect(b, `blue should lead at ${p}`).toBeGreaterThanOrEqual(g!);
    }
  });

  it("gets darker as density rises, monotonically", () => {
    const lum = (p: number) => {
      const [r, g, b] = rgb(colourAtMono(p));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    for (let i = 1; i < SAMPLES.length; i += 1) {
      expect(lum(SAMPLES[i]!), `at ${SAMPLES[i]}`).toBeLessThan(lum(SAMPLES[i - 1]!));
    }
  });

  it("reads the SAME calibration as the traffic ramp", () => {
    // Both are painted from percentileFor, so a location's position on the
    // scale is identical and only the colour differs. If these ever diverge,
    // the two pages would be making different claims about the same cell.
    for (const people of [500, 3_000, SATURATION_POPULATION, 20_000]) {
      const p = percentileFor(people);
      expect(colourAtMono(p)).toBe(colourAtMono(percentileFor(people)));
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it("leaves the traffic ramp alone", () => {
    // The heatmap page must be untouched by this addition.
    const [r, g] = rgb(colourAt(0));
    expect(g).toBeGreaterThan(r!);
    const [hr, hg] = rgb(colourAt(1));
    expect(hr).toBeGreaterThan(hg!);
  });
});
