# Stage 1: 依赖安装 + 构建
FROM node:20-alpine AS builder

WORKDIR /app
RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN mkdir -p public && pnpm exec prisma generate && pnpm run build
RUN prisma_version="$(node -p "require('./node_modules/prisma/package.json').version")" && \
    mkdir -p /prisma-cli && \
    cd /prisma-cli && \
    pnpm add "prisma@${prisma_version}" --ignore-scripts

# Stage 2: 生产运行时
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8001
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=builder /app/prisma/migrations ./prisma/migrations
COPY --from=builder /app/src/generated ./src/generated
COPY --from=builder /prisma-cli/node_modules ./prisma-cli/node_modules

COPY scripts/docker-entrypoint.sh ./scripts/
RUN chmod +x scripts/docker-entrypoint.sh

EXPOSE 8001

ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
