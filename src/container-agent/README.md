# IDP Container Manager

Secure remote container manager for `idpEditor`.  
It exposes a TLS-protected HTTP API and keeps Docker/Podman socket access isolated inside this service.

## What it manages

- `codex-gateway` containers (per-user)
- `monitoring` container (shared)

Both are built-in managed services. The manager handles create/start/stop/restart/remove directly.
With compose, workspace mount is automatic (`../` -> `/srv/idp`), so no manual workspace-path env is required.
Per-user `codex-gateway` containers are isolated by container name and dedicated named volumes.
The manager runs as non-root user (`node`).

## Security model

- TLS required by default (`CONTAINER_MANAGER_TLS_REQUIRED=true`)
- Bearer token required on all `/v1/*` endpoints (`CONTAINER_MANAGER_TOKEN`)
- Optional mTLS (`CONTAINER_MANAGER_TLS_MUTUAL=true`)
- IDP Editor talks to this service over HTTPS; it does not access container sockets directly.

## API

- `GET /health`
- `GET /api/version`
- `GET /v1/services`
- `GET /v1/services/:service/state`
- `POST /v1/services/:service/ensure`
- `POST /v1/services/:service/action`
- `GET /v1/containers/list`
- `POST /v1/containers/action`

## Run locally

```bash
cd container-agent
npm install
cp .env.example .env
npm run start
```

## Docker

Build:

```bash
docker build -t idp/container-manager:latest ./container-agent
```

## Docker Compose

```bash
cd container-agent
cp .env.compose.example .env
docker compose up -d --build
```

## Podman Compose

```bash
cd container-agent
cp .env.podman.compose.example .env
podman compose -f podman-compose.yml up -d --build
```

Podman socket settings:

```env
CONTAINER_MANAGER_SOCKET_HOST_PATH=/run/user/1000/podman/podman.sock
CONTAINER_MANAGER_SOCKET=/var/run/docker.sock
CONTAINER_MANAGER_ENGINE_LABEL=podman
```

Only a small set of env vars is required in practice:

- `CONTAINER_MANAGER_TOKEN`
- `CONTAINER_MANAGER_SOCKET` (inside container path)
- `CONTAINER_MANAGER_CODEX_IMAGE`
- `CONTAINER_MANAGER_MONITORING_IMAGE`
- `CONTAINER_MANAGER_CODEX_DATA_VOLUME_PREFIX` (optional)
- `CONTAINER_MANAGER_MONITORING_DATA_VOLUME` (optional)

Optional workspace overrides (usually not needed):

- `CONTAINER_MANAGER_WORKSPACE_HOST_PATH` host path mounted to manager (compose sets this)
- `CONTAINER_MANAGER_WORKSPACE_MOUNT_PATH` in-manager mount path (default `/srv/idp`)
- `CONTAINER_MANAGER_CODEX_GATEWAY_INDEX_HOST_PATH` host path for a custom `codex-gateway/index.js`

Run with Docker socket:

```bash
docker run -d --name idp-container-manager \
  -p 4070:4070 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /srv/idp:/srv/idp \
  -e CONTAINER_MANAGER_TOKEN=change-me \
  idp/container-manager:latest
```

Run with Podman socket:

```bash
podman run -d --name idp-container-manager \
  -p 4070:4070 \
  -v /run/user/1000/podman/podman.sock:/var/run/docker.sock:Z,U \
  -v /srv/idp:/srv/idp:Z,U \
  -e CONTAINER_MANAGER_ENGINE_LABEL=podman \
  -e CONTAINER_MANAGER_TOKEN=change-me \
  idp/container-manager:latest
```
