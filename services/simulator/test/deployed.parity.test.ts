import { describe, expect, it } from "vitest";
import goldenFile from "../../../packages/sim-engine/test/golden.json";
import { simulate } from "@spotential/sim-engine";
import type { ScenarioInputs } from "@spotential/sim-engine";

/**
 * ACCEPTANCE CRITERION #3 — client and server provably agree.
 *
 * Runs against the DEPLOYED Cloud Run URL, not a local stub. This is the one
 * failure mode that would silently corrupt every downstream report: the
 * browser showing one payback month and a saved scenario showing another.
 *
 * Excluded from the default `npm test` (see vitest.config.ts) because it needs
 * a live URL. In CI it runs against the freshly deployed --no-traffic
 * candidate revision, BEFORE traffic is promoted, so a mismatch never reaches
 * a real user.
 *
 *   SIMULATOR_URL=https://... npm run test:parity
 */

const baseUrl = process.env["SIMULATOR_URL"];

interface Vector {
  name: string;
  inputs: ScenarioInputs;
}
const vectors = (goldenFile as unknown as { vectors: Vector[] }).vectors;

describe.skipIf(!baseUrl)("deployed service parity", () => {
  it("is reachable and reports its versions", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  for (const vector of vectors) {
    it(`agrees with the local engine on "${vector.name}"`, async () => {
      const res = await fetch(`${baseUrl}/v1/simulate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inputs: vector.inputs }),
      });
      expect(res.status).toBe(200);

      const { result } = (await res.json()) as { result: unknown };
      // JSON round-trip on both sides so the comparison is like-for-like.
      expect(result).toEqual(JSON.parse(JSON.stringify(simulate(vector.inputs))));
    });
  }
});

describe.skipIf(baseUrl)("deployed service parity", () => {
  it("is skipped without SIMULATOR_URL", () => {
    expect(baseUrl).toBeUndefined();
  });
});
