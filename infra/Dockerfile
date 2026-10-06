# Single image for api and engine (the command decides). Node 22 + pnpm; runs TypeScript via tsx.
FROM node:22-alpine AS base
# System Chromium for `render` plans (Tier B sources); playwright-core connects to it via ENGINE_BROWSER_EXECUTABLE.
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont \
  && corepack enable && corepack prepare pnpm@10.33.0 --activate
ENV ENGINE_BROWSER_EXECUTABLE=/usr/bin/chromium-browser
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/engine/package.json apps/engine/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/adapters/package.json packages/adapters/
RUN pnpm install --frozen-lockfile --prod=false
COPY tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY docs/sources/registry.yaml ./docs/sources/registry.yaml
ENV NODE_ENV=production
USER node
CMD ["pnpm", "--filter", "@papa/engine", "start"]
