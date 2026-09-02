FROM node:24.7.0-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY apps/server/package.json apps/server/package.json
RUN pnpm install --frozen-lockfile --filter @concord/server...
COPY apps/server apps/server
RUN node node_modules/typescript/bin/tsc -p apps/server/tsconfig.json

FROM node:24.7.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/apps/server/package.json apps/server/package.json
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/node_modules node_modules
USER node
EXPOSE 3001
CMD ["node", "apps/server/dist/index.js"]
