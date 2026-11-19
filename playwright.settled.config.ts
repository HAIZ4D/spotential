import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/**
 * The settled-page run: see scripts/e2e-settled.mjs.
 *
 * Same servers and projects as the ordinary suite, pointed at the patched copy
 * that waits for every page to settle. No retries, so a failure is a finding
 * rather than a flake that a second attempt quietly hides.
 */
export default defineConfig({
  ...base,
  testDir: "./.e2e-settled",
  retries: 0,
});
