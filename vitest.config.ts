import { defineConfig } from "vitest/config";

export default defineConfig({
  // The PDF report templates are JSX. Stated here rather than inherited from a
  // tsconfig, because vitest resolves the ROOT tsconfig — which has no jsx
  // setting — and silently falls back to the classic React.createElement
  // transform, producing "React is not defined" at render time.
  esbuild: { jsx: "automatic" },
  test: {
    include: ["packages/**/*.test.ts", "services/**/*.test.ts", "apps/**/test/**/*.test.ts"],
    // The parity suite hits a deployed Cloud Run URL and is run explicitly
    // via `npm run test:parity`, never as part of the default unit run.
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.parity.test.ts"],
  },
});
