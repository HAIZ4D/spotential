import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where the versioned reference data actually is, in BOTH run modes.
 *
 * esbuild bundles the service into a single `dist/server.js` and the build
 * copies `data/` next to it, so at runtime the data always sits beside the
 * entrypoint no matter which source file asked for it. That is why these
 * modules must not walk `".."` — a path correct for the source tree resolves
 * wrongly in the bundle, which once let the amenities snapshot fail silently
 * in production while every unit test passed.
 *
 * The cost of that rule was `tsx watch`, where `import.meta.url` really is the
 * source file: `src/events/catalogue.ts` asked for `src/events/data` and got
 * ENOENT, so `npm run dev:service` came up with events, population,
 * demographics and amenities ALL unresolved — a dev server that answers
 * `/health` 200 and cannot serve a single page that needs data.
 *
 * So: prefer the bundled location, and fall back to a bounded walk up toward
 * the service root only when it is absent. In a built image the first check
 * always hits, so the fallback cannot change production behaviour.
 */
export function resolveDataDir(metaUrl: string): string {
  const here = dirname(fileURLToPath(metaUrl));

  const bundled = join(here, "data");
  if (existsSync(bundled)) return bundled;

  let dir = here;
  for (let depth = 0; depth < 4; depth += 1) {
    dir = dirname(dir);
    const candidate = join(dir, "data");
    if (existsSync(candidate)) return candidate;
  }

  // Nothing found: hand back the bundled path so the loader fails against the
  // location that is correct in production, not against a guess.
  return bundled;
}
