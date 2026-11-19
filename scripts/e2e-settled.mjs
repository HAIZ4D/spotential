/**
 * Run the E2E suite against SETTLED pages: CI's ordering, reproduced locally.
 *
 * On a fast machine a test's assertions run before the page's API data lands.
 * On GitHub's slower runner the data lands first. So a test that is only true
 * while a page is still loading passes here and fails there, which is exactly
 * how CI went red on every run from #3 to #13 over a test that passed on every
 * local run: it matched the footer before the analysis had rendered, and both
 * once it had.
 *
 * This copies e2e/ into .e2e-settled/, makes every `page.goto(...)` wait for
 * network idle plus a second before the test continues, and runs the copy with
 * no retries. Anything that fails here but passes in `npm run test:e2e` is an
 * assertion about the loading page rather than the settled one.
 *
 * Slow (about 30 minutes for both projects), so it is a local check, not a CI
 * step. Run it before trusting a new test that reads anything an API fills in.
 *
 * Usage: npm run test:e2e:settled [-- any playwright arguments]
 */
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const SOURCE = "e2e";
const TARGET = ".e2e-settled";
const SETTLE =
  ' await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});' +
  " await page.waitForTimeout(1000);";
// Lazy up to the first `);`, across lines, so a multi-line goto is caught too.
const GOTO = /(await page\.goto\((?:[^;]|\n)*?\);)/g;

rmSync(TARGET, { recursive: true, force: true });
cpSync(SOURCE, TARGET, { recursive: true });

let settled = 0;
for (const file of readdirSync(TARGET)) {
  if (!file.endsWith(".ts")) continue;
  const path = join(TARGET, file);
  const text = readFileSync(path, "utf8");
  writeFileSync(
    path,
    text.replace(GOTO, (call) => {
      settled += 1;
      return call + SETTLE;
    }),
  );
}

// A pattern that silently stopped matching would run the ordinary suite and
// report it as settled, which is worse than not running at all.
if (settled === 0) {
  console.error(`No page.goto calls found in ${SOURCE}/; the pattern no longer matches the specs.`);
  process.exit(1);
}
console.log(`Settled ${settled} navigations in ${TARGET}/.`);

// Playwright's CLI through Node itself, with NO shell. Going through `npx` on
// Windows needs `shell: true`, which joins the arguments unquoted, so a
// `--grep "a|b"` became a cmd.exe pipe and the run died with exit 255.
const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
const result = spawnSync(
  process.execPath,
  [cli, "test", "--config", "playwright.settled.config.ts", ...process.argv.slice(2)],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
