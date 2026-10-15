FROM node:26-slim AS build
WORKDIR /app
# The manifests first, so a change to the sources alone reuses the installed
# dependencies.
COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/
COPY apps/server/package.json apps/server/
COPY prexy/package.json prexy/
RUN npm ci
COPY . .
RUN npm run build:prexy
# esbuild and the type checker built and checked; the server runs without them.
RUN npm prune --omit=dev

FROM node:26-slim
WORKDIR /app

# rlwrap, for `docker compose exec -it prex rlwrap node scripts/cli.ts <token> --repl`.
#
# terminal (REPL works without this)
RUN apt-get update \
    && apt-get install -y --no-install-recommends rlwrap \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app .
ENV PORT=8000
EXPOSE 8000
USER node
# Node 26 runs the TypeScript sources directly (type stripping); there is no
# compile step. Node 26 rather than 24: the WebSocket adapter reports socket
# errors as an ErrorEvent, a global Node 24 does not have.
CMD ["node", "apps/server/src/main.ts"]
