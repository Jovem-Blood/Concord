FROM node:24.7.0-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY apps/token-server/package.json apps/token-server/package.json
RUN pnpm install --frozen-lockfile --filter @concord/token-server...
COPY apps/token-server apps/token-server
RUN node node_modules/typescript/bin/tsc -p apps/token-server/tsconfig.json

FROM node:24.7.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/apps/token-server/package.json apps/token-server/package.json
COPY --from=build /app/apps/token-server/dist apps/token-server/dist
COPY --from=build /app/node_modules node_modules
USER node
EXPOSE 3001
CMD ["node", "apps/token-server/dist/index.js"]
