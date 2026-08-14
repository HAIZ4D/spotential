import { defineConfig } from "vitest/config";

/**
 * Parity suite only — acceptance criterion #3.
 *
 * Separate from the default config because these tests need a live
 * SIMULATOR_URL and make real network calls. In CI they run against the
 * freshly deployed --no-traffic candidate revision, before promotion.
 */
export default defineConfig({
  test: {
    include: ["**/*.parity.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 30_000,
    // Cold-starting a scale-to-zero service under parallel load is pointless
    // churn; the first request pays the start-up cost for all of them.
    fileParallelism: false,
  },
});
