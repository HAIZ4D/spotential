import { describe, expect, it } from "vitest";
import { nearestDistrict } from "@spotential/sim-engine";
import { CURATED_RENTALS, RENTALS_COMPILED } from "../src/lib/rentals.js";

/**
 * The curated KL rental shortlist.
 *
 * These came out of a PDF by machine, so the arithmetic is worth pinning: a
 * transcription slip in a rent or a size would print a plausible-looking psf
 * that nobody could spot by eye, next to a real photograph.
 */

describe("the shortlist is internally consistent", () => {
  it("has every field a card renders", () => {
    expect(CURATED_RENTALS.length).toBe(14);
    for (const r of CURATED_RENTALS) {
      expect(r.id, r.title).toBeTruthy();
      expect(r.title).toBeTruthy();
      expect(r.photo, `${r.id} has no photo`).toBeTruthy();
      expect(r.monthlyRent).toBeGreaterThan(0);
      expect(r.sizeSqft).toBeGreaterThan(0);
      expect(r.point.lat).toBeGreaterThan(2.9);
      expect(r.point.lat).toBeLessThan(3.4);
      expect(r.point.lng).toBeGreaterThan(101.4);
      expect(r.point.lng).toBeLessThan(101.9);
    }
  });

  it("states a psf that matches rent divided by size", () => {
    /**
     * The report calls psf "the single most important number", and it is the
     * one the card colours a badge by. A stated figure that disagreed with
     * its own rent and size would be a wrong verdict on a real unit.
     */
    for (const r of CURATED_RENTALS) {
      expect(r.psf, `${r.id}`).toBeCloseTo(r.monthlyRent / r.sizeSqft, 1);
    }
  });

  it("gives every listing a distinct id and photo", () => {
    expect(new Set(CURATED_RENTALS.map((r) => r.id)).size).toBe(CURATED_RENTALS.length);
    expect(new Set(CURATED_RENTALS.map((r) => r.photo)).size).toBe(CURATED_RENTALS.length);
  });

  it("carries the date it was compiled", () => {
    // A listing is gone in weeks. The reader has to be able to weigh how old
    // this is, so the date is data rather than a comment.
    expect(RENTALS_COMPILED).toMatch(/\d{4}/);
  });
});

describe("benchmarks come from where the unit is", () => {
  it("resolves each listing against its own area, not a shared one", () => {
    /**
     * The bug this guards: the benchmark was resolved from the USER'S PIN and
     * then printed beside the listing's area name, so a Kepong shop read
     * "Kepong benchmark RM 15.00" — which is KLCC's rate. It judged a
     * suburban unit against city-centre pricing and called it good value.
     */
    const seen = new Map<string, string | null>();
    for (const r of CURATED_RENTALS) {
      seen.set(r.id, nearestDistrict(r.point)?.district.label ?? null);
    }

    // Different places must not all land on one benchmark.
    const labels = [...seen.values()].filter(Boolean);
    expect(new Set(labels).size).toBeGreaterThan(1);

    // And a unit far outside every applicable radius gets NO benchmark rather
    // than the nearest one regardless of distance.
    const kepong = CURATED_RENTALS.find((r) => r.id === "desa-jaya-kepong");
    expect(kepong).toBeDefined();
    expect(seen.get("desa-jaya-kepong")).toBeNull();
  });

  it("agrees with the compiler about Setapak being expensive", () => {
    /**
     * An independent check on the whole idea. The person who compiled the
     * report wrote "EXPENSIVE FOR SETAPAK" about this unit from their own
     * judgement; the benchmark reaches the same verdict from the data.
     */
    const setapak = CURATED_RENTALS.find((r) => r.id === "taman-permata-setapak");
    expect(setapak).toBeDefined();
    const benchmark = nearestDistrict(setapak!.point)?.district.rentMedianPsf ?? null;
    expect(benchmark).not.toBeNull();
    expect(setapak!.psf).toBeGreaterThan(benchmark!);
  });
});
