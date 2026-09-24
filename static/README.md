# static/

Bind-mounted into the `prex` container at `/static` (see `compose.yaml`) and
served unauthenticated at `/static/*`.

Drop a loadable module's files here (optionally in its own subfolder, e.g.
`static/prexycp/`) to make them fetchable by `load_module`/`loadModule(url)`

A useful way is to serve builds of "prexy modules" just with the same local static
with a `compose.override.yaml` bind:
```
services:
  prex:
    volumes:
      - ../some/prex_modules/example/dist:/static/example:ro
```
