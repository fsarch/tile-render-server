# Base
FROM node:24.20.0-trixie-slim AS base

ENV PORT 8080

RUN corepack enable

WORKDIR /usr/src/app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./


# Production Deps
FROM base AS deps

ENV NODE_ENV production

RUN apt-get update && \
    apt-get install -y node-gyp && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
RUN pnpm install --frozen-lockfile --prod


# Build Dockerfile
FROM base AS builder

RUN apt-get update && \
    apt-get install -y node-gyp && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
RUN pnpm install --frozen-lockfile

COPY . ./
RUN pnpm run build


# Main Dockerfile
FROM base

ENV NODE_ENV production
ENV NODE_OPTIONS="--import @fsarch/server/register"

EXPOSE 8080

COPY --from=builder --chown=node:node /usr/src/app/dist ./dist
COPY --from=deps --chown=node:node /usr/src/app/node_modules ./node_modules

USER node

CMD ["node", "./dist/main.js"]
