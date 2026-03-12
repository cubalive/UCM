FROM node:20-slim AS base
WORKDIR /app

# ── Install deps (prod only) ──
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Build client (Vite) + server (esbuild) ──
FROM base AS build
COPY package.json package-lock.json ./
RUN rm -rf node_modules/.vite && npm ci
COPY tsconfig.json vite.config.ts tailwind.config.ts postcss.config.js components.json ./
COPY script/ ./script/
COPY server/ ./server/
COPY client/ ./client/
COPY shared/ ./shared/
COPY lib/ ./lib/
COPY attached_assets/ ./attached_assets/
COPY migrations/ ./migrations/
RUN npx tsx script/build.ts

# ── Production runner ──
FROM base AS runner
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 ucm && \
    adduser --system --uid 1001 ucm
USER ucm

COPY --from=deps --chown=ucm:ucm /app/node_modules ./node_modules
COPY --from=build --chown=ucm:ucm /app/dist ./dist
COPY --from=build --chown=ucm:ucm /app/package.json ./

EXPOSE 5000
CMD ["node", "dist/index.cjs"]
