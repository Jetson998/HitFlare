# 构建 Vite 前端产物。
FROM oven/bun:1.3.13 AS web-build

WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --cache-dir=/root/.bun/install/cache
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY web ./
COPY shared /app/shared
RUN bun run build

# 运行镜像：Node 同时提供登录 API、模板 API 和静态前端。
FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    HITFLARE_DATA_DIR=/app/data

COPY --from=web-build --chown=node:node /app/web/dist /app/web/dist
COPY server/package.json server/package-lock.json /app/server/
RUN cd /app/server && npm ci --omit=dev --ignore-scripts
COPY --chown=node:node server /app/server
COPY --chown=node:node shared /app/shared
RUN mkdir -p /app/data && chown node:node /app/data

USER node

EXPOSE 3000

CMD ["node", "server/index.mjs"]
