# IDP Ecosystem Docker Stack

This folder contains a full image-based runtime stack for:

- nginx (edge reverse proxy)
- core
- auth
- ide
- kernel
- monitoring
- container-agent
- codex-gateway
- postgres (latest)
- redis (latest)

## Run everything

```bash
docker compose -f docker/docker-compose.yml --env-file docker/.env up -d
```

This starts nginx with these host routes:

- `auth.adadrass.ir` -> `auth:3015`
- `ide.adadrass.ir` -> `ide:3000`
- `*.adadrass.ir` -> `core:3005` (tenant hosts)

## Stop everything

```bash
docker compose -f docker/docker-compose.yml --env-file docker/.env down
```

## Logs

```bash
docker compose -f docker/docker-compose.yml --env-file docker/.env logs -f
```

## Important notes

- Point DNS A/AAAA records to this server:
  - `auth.adadrass.ir`
  - `ide.adadrass.ir`
  - wildcard `*.adadrass.ir`
- For local browser access use:
  - Nginx: `http://localhost`
  - IDE (direct): `http://localhost:3002`
  - Core (direct): `http://localhost:3005`
  - Auth (direct): `http://localhost:3015`
  - Monitoring: `http://localhost:3011`
- Change all placeholder secrets in `docker/env/*.env` before production use.
