import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { AgeChart, BarChart, DimensionBars } from "../src/report/charts.js";

/**
 * Report chart geometry.
 *
 * These exist because of a defect that shipped: the value label on the tallest
 * bar was positioned at `6 + plotH - h - 3`, which is 3 when the bar is at
 * full height — above the top edge of the SVG. The biggest number on the
 * chart, the one a reader looks at first, was always clipped.
 *
 * That was an arithmetic bug, so these are arithmetic tests. Rendering a PDF
 * and looking at it would not have caught it, and did not.
 */

interface Node {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
}

/** Every node in a react-pdf element tree, flattened. */
function walk(node: unknown, out: Node[] = []): Node[] {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out);
    return out;
  }
  if (!node || typeof node !== "object") return out;

  const element = node as Node;
  if (!("props" in element)) return out;

  out.push(element);
  walk(element.props?.children, out);
  return out;
}

/** react-pdf components are plain functions, so the tree needs no renderer. */
const treeOf = (element: ReactElement | null): Node[] => (element ? walk(element) : []);

/** react-pdf tags elements with plain uppercase strings: SVG, G, RECT, TEXT. */
const nameOf = (node: Node) => String(node.type).toUpperCase();

const textNodes = (tree: Node[]) => tree.filter((n) => nameOf(n) === "TEXT");
const rectNodes = (tree: Node[]) => tree.filter((n) => nameOf(n) === "RECT");

const textOf = (node: Node): string => {
  const child = node.props.children;
  return Array.isArray(child) ? child.join("") : String(child ?? "");
};

describe("BarChart", () => {
  const HEIGHT = 150;

  /** The exact shape from the screenshot: everything in the first ring. */
  const KLCC = [
    { label: "0-250m", value: 20 },
    { label: "250-500m", value: 0, unsearched: true },
    { label: "500-1,000m", value: 0, unsearched: true },
  ];

  it("keeps every label inside the viewport, including the tallest bar's", () => {
    const tree = treeOf(BarChart({ bars: KLCC, height: HEIGHT }));

    for (const node of textNodes(tree)) {
      const y = Number(node.props["y"]);
      expect(Number.isFinite(y)).toBe(true);
      // The bug: the tallest bar's label rendered at y=3 with a 7pt font, so
      // its ascender sat outside the SVG and the number was cut in half.
      expect(y).toBeGreaterThanOrEqual(10);
      expect(y).toBeLessThanOrEqual(HEIGHT);
    }
  });

  it("keeps the tallest bar clear of the label band", () => {
    const tree = treeOf(BarChart({ bars: KLCC, height: HEIGHT }));
    const bars = rectNodes(tree).filter((n) => n.props["fill"] === "#003087");

    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) {
      // Headroom is reserved, so no bar may start at the very top.
      expect(Number(bar.props["y"])).toBeGreaterThanOrEqual(14);
    }
  });

  /**
   * The defect that mattered most. Places returns the nearest 20 and stops, so
   * a ring beyond that point was never looked at. Printing "0" there states a
   * measurement the report does not have.
   */
  it("never prints a zero for a ring that was not searched", () => {
    const tree = treeOf(BarChart({ bars: KLCC, height: HEIGHT }));

    // Centred text is a bar's own label; the value axis is right-aligned, and
    // a "0" gridline tick there is correct.
    const barLabels = textNodes(tree)
      .filter((n) => n.props["textAnchor"] === "middle")
      .map(textOf);

    expect(barLabels).toContain("not searched");
    // Two unsearched rings, and neither may contribute a "0".
    expect(barLabels.filter((l) => l === "0")).toHaveLength(0);
  });

  it("still shows a measured zero, because that is a real finding", () => {
    const bars = [
      { label: "0-250m", value: 5 },
      { label: "250-500m", value: 0 },
    ];
    const labels = textNodes(treeOf(BarChart({ bars, height: HEIGHT }))).map(textOf);

    expect(labels).toContain("0");
    expect(labels).not.toContain("not searched");
  });

  it("draws a visible stub for a measured zero so the ring is not missing", () => {
    const tree = treeOf(
      BarChart({ bars: [{ label: "0-250m", value: 5 }, { label: "250-500m", value: 0 }] }),
    );
    // Grey stub rather than navy: present, but plainly not a count.
    const stubs = rectNodes(tree).filter((n) => n.props["fill"] === "#98a2b3");
    expect(stubs).toHaveLength(1);
    expect(Number(stubs[0]!.props["height"])).toBeGreaterThan(0);
  });

  it("scales against measured rings only, so an unsearched one cannot flatten it", () => {
    const tree = treeOf(BarChart({ bars: KLCC, height: HEIGHT }));
    const navy = rectNodes(tree).filter((n) => n.props["fill"] === "#003087");
    // The single measured bar should use the full plot height, not a third of
    // it because two unknown rings were counted into the scale.
    expect(Number(navy[0]!.props["height"])).toBeGreaterThan(90);
  });

  it("renders nothing rather than an empty frame when there are no rings", () => {
    expect(BarChart({ bars: [] })).toBeNull();
  });
});

describe("DimensionBars", () => {
  const DIMENSIONS = [
    { label: "Competition", score: 0, basis: "measured" },
    { label: "Rent", score: 81, basis: "inferred" },
    { label: "Demand", score: null, basis: "no data" },
  ];

  it("distinguishes a zero score from a missing one", () => {
    const tree = treeOf(DimensionBars({ dimensions: DIMENSIONS }));
    const labels = textNodes(tree).map(textOf);

    // A zero-length bar and a no-data bar look identical, and mean opposite
    // things — so the missing one says so in words.
    expect(labels.join(" ")).toMatch(/no data/);
    expect(labels).toContain("0");
    expect(labels).toContain("81");
  });

  it("bands the colours the way the on-screen ring does", () => {
    const tree = treeOf(DimensionBars({ dimensions: DIMENSIONS }));
    const fills = rectNodes(tree).map((n) => String(n.props["fill"]));

    expect(fills).toContain("#dc2626"); // 0 - weak
    expect(fills).toContain("#16a34a"); // 81 - strong
  });

  it("renders nothing when there is nothing to rank", () => {
    expect(DimensionBars({ dimensions: [] })).toBeNull();
  });
});

describe("AgeChart", () => {
  it("keeps every bar inside the frame", () => {
    const bands = [
      { label: "0-4", value: 120 },
      { label: "25-29", value: 900 },
      { label: "80+", value: 4 },
    ];
    const height = 96;
    const tree = treeOf(AgeChart({ bands, height }));

    for (const rect of rectNodes(tree)) {
      const y = Number(rect.props["y"]);
      const h = Number(rect.props["height"]);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y + h).toBeLessThanOrEqual(height);
      // Even the smallest band stays visible rather than collapsing to nothing.
      expect(h).toBeGreaterThan(0);
    }
  });

  it("renders nothing without bands", () => {
    expect(AgeChart({ bands: [] })).toBeNull();
  });
});
