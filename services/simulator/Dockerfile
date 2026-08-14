# Two stages: bundle with esbuild, then run on distroless.
#
# The engine is a workspace package consumed as TypeScript source, so esbuild
# inlines it into a single file. The runtime image therefore carries no
# node_modules, no npm and no shell — a smaller attack surface and a much
# faster cold start, which matters because this service scales to zero.

FROM node:22-slim AS build
WORKDIR /app

# Manifests first so the dependency layer caches independently of source.
COPY package.json package-lock.json ./
COPY packages/sim-engine/package.json ./packages/sim-engine/
COPY services/simulator/package.json ./services/simulator/
RUN npm ci

COPY packages/sim-engine ./packages/sim-engine
COPY services/simulator ./services/simulator

RUN npm run build --workspace @spotential/simulator-service

# Three packages are deliberately NOT bundled.
#
# @google-cloud/firestore uses gRPC, which loads .proto files from disk
# relative to __dirname — neither of which survives being flattened into a
# single ESM file. Bundling it produced a "__dirname is not defined" at
# startup, and because the store falls back to in-memory on error, the service
# kept working while silently re-billing Places on every cold start.
#
# @react-pdf/renderer resolves its own font metrics at runtime, and react must
# stay external alongside it: bundling react would give the PDF renderer a
# SECOND React instance to reconcile against the one creating the elements.
# One copy, resolved from node_modules, for both.
RUN mkdir -p /runtime \
  && cd /runtime \
  && npm init -y > /dev/null \
  && npm install --omit=dev --no-audit --no-fund \
       "@google-cloud/firestore@$(node -p "require('/app/services/simulator/package.json').dependencies['@google-cloud/firestore']")" \
       "@react-pdf/renderer@$(node -p "require('/app/services/simulator/package.json').dependencies['@react-pdf/renderer']")" \
       "react@$(node -p "require('/app/services/simulator/package.json').dependencies['react']")"

FROM gcr.io/distroless/nodejs22-debian12 AS runtime
WORKDIR /app
COPY --from=build /app/services/simulator/dist/server.js ./server.js
COPY --from=build /runtime/node_modules ./node_modules

# Demographic reference data, read from disk at startup rather than bundled.
# The boundary GeoJSON is ~1 MB and inlining it would bloat server.js for
# something parsed exactly once per instance. Regenerate with
# `npm run refresh:demographics`.
COPY --from=build /app/services/simulator/data ./data

ENV NODE_ENV=production
EXPOSE 8080
CMD ["server.js"]
