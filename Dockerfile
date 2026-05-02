# syntax=docker/dockerfile:1

# Stage 1: 依赖安装 + 构建
FROM node:20-alpine AS builder

WORKDIR /app
RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN mkdir -p public && pnpm exec prisma generate && pnpm run build
RUN prisma_modules="$(dirname "$(readlink node_modules/prisma)")" && \
    mkdir -p /standalone-prisma && \
    cp -R -L "node_modules/${prisma_modules}" /standalone-prisma/node_modules

# Stage 2: 生产运行时
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8001
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/.next/standalone/server.js ./server.js
COPY --from=builder /app/.next/standalone/package.json ./package.json
COPY --from=builder /app/.next/standalone/.next ./.next
COPY --from=builder /app/.next/standalone/node_modules ./node_modules
COPY --from=builder /app/.next/standalone/src ./src
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=builder /app/prisma/migrations ./prisma/migrations
COPY --from=builder /app/src/generated ./src/generated
RUN --mount=type=bind,from=builder,source=/standalone-prisma/node_modules,target=/standalone-prisma-node_modules,ro \
    cp -R /standalone-prisma-node_modules/prisma node_modules/prisma && \
    mkdir -p node_modules/@prisma && \
    cp -R /standalone-prisma-node_modules/@prisma/. node_modules/@prisma/

COPY scripts/docker-entrypoint.sh ./scripts/
RUN chmod +x scripts/docker-entrypoint.sh

EXPOSE 8001

ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
