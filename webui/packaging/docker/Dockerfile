# Slim Node-based image for the CB8 web server.
#
# No Electron, no GPU stack, no display server: the standalone entrypoint
# (src/main/standalone.ts -> dist/standalone.mjs) connects to Postgres
# ($CB8_DATABASE_URL) and starts a Fastify server listening on $CB8_PORT
# (default 8008).
#
# Layout in the runtime image:
#   /app/dist/standalone.mjs   esbuild bundle of all first-party code
#   /app/node_modules/         runtime dependencies
#   /app/web/                  static SPA assets (served by @fastify/static)
# The catalog lives in Postgres; only the image cache + uploads live at
# $CB8_DATA_DIR (default /var/lib/cb8), which the k8s manifest mounts from a PVC.

# --- builder ----------------------------------------------------------------
FROM node:22-bookworm AS builder

WORKDIR /src

# Pin pnpm to the version the project builds with. pnpm 11 ignores the repo's
# pnpm.onlyBuiltDependencies field and changes node_modules layout, which breaks
# `import 'esbuild'` in scripts/build-standalone.mjs (it relies on node-linker=
# hoisted from .npmrc). Match local (pnpm 10.x) for a reproducible build.
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Native build deps for sharp + @napi-rs/canvas.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 build-essential pkg-config \
    && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
RUN pnpm install --frozen-lockfile --prod=false

COPY . .

# Bundle the standalone entrypoint. Native modules stay external and are
# resolved at runtime against /app/node_modules.
RUN pnpm build:standalone \
    && pnpm prune --prod

# --- runtime ----------------------------------------------------------------
FROM node:22-bookworm-slim

# sharp + @napi-rs/canvas native deps. Most are bundled into their .node files
# already; libstdc++/glibc come from the slim base. tini handles signals.
# node-7z shells out to 7z for CBZ/CBR handling. Debian keeps the RAR
# extraction codec in non-free, so enable that component before installing.
RUN sed -i 's/Components: main/Components: main contrib non-free non-free-firmware/g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates tini p7zip-full p7zip-rar unrar \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --system --create-home --home-dir /var/lib/cb8 --uid 10001 cb8

WORKDIR /app

COPY --from=builder /src/dist/             /app/dist/
COPY --from=builder /src/node_modules/     /app/node_modules/
COPY --from=builder /src/dist/web/         /app/web/
COPY --from=builder /src/package.json      /app/package.json

# Drop the built React renderer into a sibling that resolveStaticRoot() will
# find. /app/dist/standalone.mjs -> ../web hits /app/web.

# CB8_MDNS=0: LAN discovery is OFF in the image, unlike a bare-node run where it
# defaults on. A container on the default bridge network cannot multicast to the
# LAN, and the address it would advertise is a bridge IP no client can reach —
# an unreachable service record is worse than no record at all. Re-enable it by
# running the container with host networking AND setting CB8_MDNS=1 (see the
# commented variant in docker-compose.yaml). Otherwise clients pair by QR or by
# typing the host's address.
ENV NODE_ENV=production \
    CB8_DATA_DIR=/var/lib/cb8 \
    CB8_PORT=8008 \
    CB8_HOST=0.0.0.0 \
    CB8_MDNS=0 \
    CB8_SEVENZIP_PATH=/usr/bin/7z \
    UV_THREADPOOL_SIZE=64

USER cb8
EXPOSE 8008

ENTRYPOINT ["/usr/bin/tini", "--", "node", "/app/dist/standalone.mjs"]
