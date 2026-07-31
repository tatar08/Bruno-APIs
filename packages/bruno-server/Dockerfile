# Bruno Bridge Server (bruno-server) — production image (Improvement.md P1.3)
#
# Build context MUST be the monorepo root (not packages/bruno-server), e.g.:
#   docker build -f packages/bruno-server/Dockerfile -t bruno-bridge .
#
# This is required because bruno-server does not depend on bruno-electron as a
# normal npm package — it require()s bruno-electron's IPC handler modules
# directly via a relative path (see the Module._resolveFilename hook in
# src/index.js), so the two packages must sit side by side inside the image
# exactly as they do in the source tree. The build also needs every
# workspace's package.json to let `npm ci` resolve correctly against the
# single root package-lock.json (npm workspaces requirement).

FROM node:24-slim AS deps

WORKDIR /usebruno

# Copy only the manifests first (one per workspace) so this layer — the
# expensive one — stays cached across source-only changes.
COPY package.json package-lock.json ./
COPY packages/bruno-app/package.json packages/bruno-app/package.json
COPY packages/bruno-electron/package.json packages/bruno-electron/package.json
COPY packages/bruno-cli/package.json packages/bruno-cli/package.json
COPY packages/bruno-common/package.json packages/bruno-common/package.json
COPY packages/bruno-converters/package.json packages/bruno-converters/package.json
COPY packages/bruno-schema/package.json packages/bruno-schema/package.json
COPY packages/bruno-schema-types/package.json packages/bruno-schema-types/package.json
COPY packages/bruno-query/package.json packages/bruno-query/package.json
COPY packages/bruno-js/package.json packages/bruno-js/package.json
COPY packages/bruno-lang/package.json packages/bruno-lang/package.json
COPY packages/bruno-tests/package.json packages/bruno-tests/package.json
COPY packages/bruno-toml/package.json packages/bruno-toml/package.json
COPY packages/bruno-graphql-docs/package.json packages/bruno-graphql-docs/package.json
COPY packages/bruno-requests/package.json packages/bruno-requests/package.json
COPY packages/bruno-filestore/package.json packages/bruno-filestore/package.json
COPY packages/bruno-server/package.json packages/bruno-server/package.json
COPY packages/bruno-rpc-contract/package.json packages/bruno-rpc-contract/package.json

RUN npm ci

# --- Build stage: compile every workspace package that bruno-server,
# bruno-electron (required in-process by bruno-server — see header note) and
# bruno-app actually resolve at require()/import time, in dependency order.
# This set was derived by grepping `@usebruno/*` imports across
# bruno-server/src, bruno-electron/src and bruno-app/src (package.json
# "dependencies" alone under-declares several of these), not by copying every
# workspace wholesale — packages/bruno-cli, bruno-tests, bruno-toml and
# bruno-graphql-docs's own runtime (only its rollup build output is needed,
# to bundle into bruno-app's static JS) are outside this closure and are not
# built or copied into the runtime stage below.
FROM deps AS build

COPY packages/bruno-schema-types packages/bruno-schema-types
COPY packages/bruno-common packages/bruno-common
COPY packages/bruno-lang packages/bruno-lang
COPY packages/bruno-schema packages/bruno-schema
COPY packages/bruno-query packages/bruno-query
COPY packages/bruno-filestore packages/bruno-filestore
COPY packages/bruno-converters packages/bruno-converters
COPY packages/bruno-requests packages/bruno-requests
COPY packages/bruno-graphql-docs packages/bruno-graphql-docs
COPY packages/bruno-js packages/bruno-js
COPY packages/bruno-rpc-contract packages/bruno-rpc-contract
COPY packages/bruno-app packages/bruno-app

RUN npm run build --workspace=packages/bruno-schema-types \
    && npm run build --workspace=packages/bruno-common \
    && npm run build --workspace=packages/bruno-query \
    && npm run build --workspace=packages/bruno-filestore \
    && npm run build --workspace=packages/bruno-converters \
    && npm run build --workspace=packages/bruno-requests \
    && npm run build --workspace=packages/bruno-graphql-docs \
    && npm run build --workspace=packages/bruno-app

# --- Runtime stage: minimal image with just what bruno-server needs to run ---
FROM node:24-slim AS runtime

LABEL org.opencontainers.image.source="https://github.com/usebruno/bruno"
LABEL org.opencontainers.image.description="Bruno Bridge Server - browser-accessible API surface for Bruno collections"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.title="Bruno Bridge Server"
LABEL org.opencontainers.image.url="https://www.usebruno.com"

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usebruno

COPY --from=deps /usebruno/node_modules node_modules
COPY --from=deps /usebruno/package.json package.json

COPY packages/bruno-server packages/bruno-server
COPY packages/bruno-electron/src packages/bruno-electron/src
COPY packages/bruno-electron/package.json packages/bruno-electron/package.json
COPY --from=build /usebruno/packages/bruno-schema-types packages/bruno-schema-types
COPY --from=build /usebruno/packages/bruno-common packages/bruno-common
COPY --from=build /usebruno/packages/bruno-lang packages/bruno-lang
COPY --from=build /usebruno/packages/bruno-schema packages/bruno-schema
COPY --from=build /usebruno/packages/bruno-query packages/bruno-query
COPY --from=build /usebruno/packages/bruno-filestore packages/bruno-filestore
COPY --from=build /usebruno/packages/bruno-converters packages/bruno-converters
COPY --from=build /usebruno/packages/bruno-requests packages/bruno-requests
COPY --from=build /usebruno/packages/bruno-js packages/bruno-js
COPY --from=build /usebruno/packages/bruno-rpc-contract packages/bruno-rpc-contract
COPY --from=build /usebruno/packages/bruno-app/dist packages/bruno-app/dist

# USER_DATA_DIR (bruno-server/src/index.js) resolves to $HOME/.config/bruno —
# under the `node` user that ships with this base image, $HOME=/home/node.
# Pre-create it and hand ownership to `node` so it works as a mounted volume
# under `docker run --read-only -v <name>:/home/node/.config/bruno`.
RUN mkdir -p /home/node/.config/bruno && chown -R node:node /home/node/.config/bruno

ENV NODE_ENV=production
# Bind to all interfaces inside the container by default: the container's own
# network namespace is the isolation boundary (nothing is reachable unless the
# operator explicitly publishes/exposes the port), unlike a bare-metal install
# where BRUNO_SERVER_HOST intentionally defaults to loopback-only. See
# THREAT_MODEL.md Boundary notes and Section 6 deploy guidance.
ENV BRUNO_SERVER_HOST=0.0.0.0
ENV BRUNO_SERVER_PORT=4000

EXPOSE 4000

USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${BRUNO_SERVER_PORT}/health/live" || exit 1

ENTRYPOINT ["node", "packages/bruno-server/src/index.js"]
