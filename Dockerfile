# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
# Native SQLite modules can fall back to compilation when a prebuilt binary is unavailable.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@12.15.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY server ./server
COPY shared ./shared
COPY scripts ./scripts
COPY tests ./tests
RUN pnpm build
# Keep tsx in production: the API runs TypeScript directly.
RUN pnpm prune --prod

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data
WORKDIR /app
RUN mkdir -p /data
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY prompts ./prompts
COPY --from=build /app/dist ./dist
# Match TV Dinner: Dokploy-created volumes can be owned by root.
USER root
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"
CMD ["node", "--import", "tsx", "server/index.ts"]
