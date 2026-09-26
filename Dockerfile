FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:web && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4311 CHANGEWEAVE_DB=/app/data/changeweave.sqlite
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 4311
CMD ["node", "server/index.js"]
