# syntax=docker/dockerfile:1
# Build context is the repository root — the SPA imports workspace packages.
FROM node:22-alpine AS build

RUN corepack enable
WORKDIR /src

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/runtime-python/package.json packages/runtime-python/
COPY packages/runtime-conformance/package.json packages/runtime-conformance/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @copperkeep/web build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
