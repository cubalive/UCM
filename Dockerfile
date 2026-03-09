FROM node:20-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

FROM base AS runner
ENV NODE_ENV=production

# Security: run as non-root user
RUN addgroup --system --gid 1001 ucm && \
    adduser --system --uid 1001 ucm
USER ucm

COPY --from=deps --chown=ucm:ucm /app/node_modules ./node_modules
COPY --from=build --chown=ucm:ucm /app/dist ./dist
COPY --from=build --chown=ucm:ucm /app/package.json ./

EXPOSE 3000
CMD ["node", "dist/index.js"]
