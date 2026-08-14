import { describe, expect, it } from "vitest";
import {
  boundingBoxOf,
  inBoundingBox,
  pointInPolygon,
  pointInRing,
  type Ring,
} from "../src/geo.js";

/**
 * Point-in-polygon is what resolves a pin to a district, and a wrong district
 * means demographics for the wrong two million people. Worth testing properly.
 *
 * Rings are GeoJSON order: [lng, lat].
 */

/** A 10×10 square from (0,0) to (10,10). */
const SQUARE: Ring = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
  [0, 0],
];

/** A 4×4 hole from (3,3) to (7,7). */
const HOLE: Ring = [
  [3, 3],
  [7, 3],
  [7, 7],
  [3, 7],
  [3, 3],
];

describe("pointInRing", () => {
  it("finds points inside", () => {
    expect(pointInRing({ lat: 5, lng: 5 }, SQUARE)).toBe(true);
    expect(pointInRing({ lat: 0.1, lng: 0.1 }, SQUARE)).toBe(true);
  });

  it("rejects points outside", () => {
    expect(pointInRing({ lat: 15, lng: 5 }, SQUARE)).toBe(false);
    expect(pointInRing({ lat: 5, lng: -1 }, SQUARE)).toBe(false);
    expect(pointInRing({ lat: -5, lng: -5 }, SQUARE)).toBe(false);
  });

  it("handles a point level with a vertex without double counting", () => {
    // The classic ray-casting failure: a ray passing exactly through a vertex
    // can count two crossings and report "outside" for an interior point.
    expect(pointInRing({ lat: 10, lng: 5 }, SQUARE)).toBe(false);
    expect(pointInRing({ lat: 0, lng: 5 }, SQUARE)).toBe(true);
  });

  it("handles a concave shape", () => {
    // An L: the notch must read as outside.
    const L: Ring = [
      [0, 0],
      [10, 0],
      [10, 4],
      [4, 4],
      [4, 10],
      [0, 10],
      [0, 0],
    ];
    expect(pointInRing({ lat: 2, lng: 2 }, L)).toBe(true);
    expect(pointInRing({ lat: 8, lng: 8 }, L)).toBe(false);
    expect(pointInRing({ lat: 2, lng: 8 }, L)).toBe(true);
  });
});

describe("pointInPolygon", () => {
  it("treats a hole as outside", () => {
    expect(pointInPolygon({ lat: 5, lng: 5 }, [SQUARE])).toBe(true);
    expect(pointInPolygon({ lat: 5, lng: 5 }, [SQUARE, HOLE])).toBe(false);
    // Still inside the outer ring, outside the hole.
    expect(pointInPolygon({ lat: 1, lng: 1 }, [SQUARE, HOLE])).toBe(true);
  });

  it("is false for an empty polygon", () => {
    expect(pointInPolygon({ lat: 1, lng: 1 }, [])).toBe(false);
  });
});

describe("bounding boxes", () => {
  it("computes the extent", () => {
    expect(boundingBoxOf([SQUARE])).toEqual([0, 0, 10, 10]);
  });

  it("spans every ring given", () => {
    const far: Ring = [
      [20, 20],
      [21, 20],
      [21, 21],
      [20, 20],
    ];
    expect(boundingBoxOf([SQUARE, far])).toEqual([0, 0, 21, 21]);
  });

  it("accepts points on the edge, so the pre-filter never hides a match", () => {
    const box = boundingBoxOf([SQUARE]);
    expect(inBoundingBox({ lat: 0, lng: 0 }, box)).toBe(true);
    expect(inBoundingBox({ lat: 10, lng: 10 }, box)).toBe(true);
    expect(inBoundingBox({ lat: 5, lng: 5 }, box)).toBe(true);
    expect(inBoundingBox({ lat: 11, lng: 5 }, box)).toBe(false);
  });

  it("agrees with the polygon test — anything inside is inside the box", () => {
    const box = boundingBoxOf([SQUARE]);
    for (const point of [
      { lat: 5, lng: 5 },
      { lat: 0.5, lng: 9.5 },
      { lat: 9.9, lng: 0.1 },
    ]) {
      if (pointInPolygon(point, [SQUARE])) {
        expect(inBoundingBox(point, box)).toBe(true);
      }
    }
  });
});
