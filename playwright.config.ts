import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests — SPEC §12.
 *
 * Runs against a real production build served over HTTP, with the real Fastify
 * service alongside it. Not the dev server: the print stylesheet, the bundled
 * engine and the baked-in API URL are all things only the built artefact
 * exercises.
 *
 * The Gemini call itself is intercepted at the browser (see ai.spec.ts). The
 * live model loop is verified separately against production; paying for a
 * model call on every CI run would buy flakiness, not confidence.
 */
const WEB_PORT = 4173;
const API_PORT = 8080;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  workers: 1,
  reporter: process.env["CI"] ? [["github"], ["list"]] : [["list"]],

  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],

  webServer: [
    {
      command: "npm run build:service && node services/simulator/dist/server.js",
      port: API_PORT,
      reuseExistingServer: !process.env["CI"],
      timeout: 120_000,
      env: { PORT: String(API_PORT), ALLOWED_ORIGINS: `http://localhost:${WEB_PORT}` },
    },
    {
      // Built with the LOCAL api url, so these tests never touch production.
      // Run from apps/web: `vite preview` has no --root flag.
      command: `npm run build && npx vite preview --port ${WEB_PORT}`,
      cwd: "apps/web",
      port: WEB_PORT,
      reuseExistingServer: !process.env["CI"],
      timeout: 180_000,
      env: { VITE_SIMULATOR_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
