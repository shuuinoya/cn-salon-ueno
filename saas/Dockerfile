# package-release.cjs で作成した一式の中で使用する。本番用フォルダを送らない。
FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --chown=node:node server.cjs worker.cjs ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node public ./public
COPY --chown=node:node runtime ./runtime
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV NODE_ENV=production SERVICE_BIND=0.0.0.0 SERVICE_PORT=5610 SERVICE_DATA=/app/data
EXPOSE 5610
VOLUME ["/app/data"]
CMD ["node", "server.cjs"]
