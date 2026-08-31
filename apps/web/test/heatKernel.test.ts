import { describe, expect, it } from "vitest";
import {
  CELL_AREA_M2,
  INFLUENCE_METRES,
  KERNEL_GAIN,
} from "../src/components/heatmap/HeatLayer.js";
import { SATURATION_POPULATION, weightFor } from "../src/components/heatmap/ramp.js";

/**
 * The smoothing kernel, and why its two constants are coupled.
 *
 * These look like independent cosmetic dials and are not. The radius has to
 * exceed the cell spacing or the surface renders as isolated dots; but once
 * kernels overlap, additive compositing means each point collects several
 * cells' worth of weight, which multiplies the whole surface and paints the
 * national median as saturated red. Widening one without dividing the other
 * back out destroys the calibration while looking purely visual in a diff.
 */

describe("the influence radius blends neighbouring cells", () => {
  /**
   * Resolution-8 centres sit about 700m apart (edge ~400m, so centre-to-centre
   * is 400 * sqrt(3)). The first attempt used 620m — under the spacing — and
   * rendered a polka-dot field of separate red cores.
   */
  const CELL_SPACING_M = 400 * Math.sqrt(3);

  it("reaches past the next cell, not just to it", () => {
    expect(INFLUENCE_METRES).toBeGreaterThan(CELL_SPACING_M * 1.5);
  });

  it("does not smear a dense core across a whole city", () => {
    // Beyond a few kilometres the surface stops describing a neighbourhood.
    expect(INFLUENCE_METRES).toBeLessThan(3_000);
  });
});

describe("the gain cancels the overlap it creates", () => {
  /**
   * A linear falloff from 1 at the centre to 0 at R integrates to pi*R^2/3.
   * Divided by the area one cell represents, that is how many cells' worth of
   * weight a point in a uniform field accumulates.
   */
  const overlap = (Math.PI * INFLUENCE_METRES * INFLUENCE_METRES) / 3 / CELL_AREA_M2;

  it("accumulates several cells per point at this radius", () => {
    // If this ever drops to ~1 the surface has stopped blending at all.
    expect(overlap).toBeGreaterThan(2);
  });

  it("scales one cell's contribution down by exactly that factor", () => {
    // The coupling itself. A hardcoded gain would fail here the moment the
    // radius moved.
    expect(KERNEL_GAIN).toBeCloseTo(1 / overlap, 10);
  });

  it("leaves a uniform field at the national ceiling saturating at 1", () => {
    /**
     * The claim the legend makes: a UNIFORM FIELD of cells at the national
     * 90th percentile is what reaches full red. Not a single cell — smoothed
     * over 1.5km an isolated one genuinely holds fewer people per km².
     */
    const accumulated = weightFor(SATURATION_POPULATION) * KERNEL_GAIN * overlap;
    expect(accumulated).toBeCloseTo(1, 10);
  });

  it("keeps a uniform field at half the ceiling well short of saturation", () => {
    const accumulated = weightFor(SATURATION_POPULATION / 2) * KERNEL_GAIN * overlap;
    expect(accumulated).toBeCloseTo(0.5, 10);
    expect(accumulated).toBeLessThan(1);
  });
});
