FROM denoland/deno:2.9.5 AS build
ENV DENO_DIR=/deno-dir
WORKDIR /app
COPY . .
RUN cd prexy && deno task build
RUN deno cache apps/server/src/main.ts

FROM denoland/deno:2.9.5
ENV DENO_DIR=/deno-dir
WORKDIR /app

# rlwrap, for `docker compose exec -it prex rlwrap deno run --allow-net \
# --allow-env scripts/cli.ts <token> --repl`.
#
# terminal (REPL works without this)
RUN apt-get update \
    && apt-get install -y --no-install-recommends rlwrap \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /deno-dir /deno-dir
COPY --from=build /app .
ENV PORT=8000
EXPOSE 8000
USER deno
CMD ["run", "--cached-only", "--allow-net", "--allow-env", "--allow-read", "apps/server/src/main.ts"]
