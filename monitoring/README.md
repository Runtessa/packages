# IDP Monitoring Service

Standalone ingest service for monitoring snapshots and alerts.

## Endpoints

- `GET /health`
- `POST /ingest`
- `POST /api/admin/monitoring/ingest` (compatibility path)

## Run

```bash
cd monitoring
npm install
npm run start
```

## TLS

TLS is required by default. Set:

- `MONITORING_TLS_KEY_PATH`
- `MONITORING_TLS_CERT_PATH`
- `MONITORING_INGEST_TOKEN`

If cert files are missing, service can auto-generate self-signed certs:

- `MONITORING_TLS_AUTO_SELF_SIGNED=true`
- `MONITORING_TLS_CN=localhost`
- `MONITORING_TLS_SELF_SIGNED_DAYS=825`

For local testing only, you can disable TLS:

```env
MONITORING_TLS_REQUIRED=false
MONITORING_TLS_ENABLED=false
```

## Environment

See `.env.example`.

Core instances should point to this service:

```env
MONITORING_SERVER_URL=https://localhost:3011
MONITORING_SERVER_TOKEN=change-me
MONITORING_ENFORCE_TLS=true
```

Or set the full endpoint directly:

```env
MONITORING_SERVER_INGEST_URL=https://localhost:3011/ingest
```

## Docker

Build:

```bash
docker build -t idp-monitoring:latest ./monitoring
```

Run:

```bash
docker run -d --name idp-monitoring \
  -p 3011:3011 \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  -e MONITORING_INGEST_TOKEN=change-me \
  idp-monitoring:latest
```

The container auto-generates a self-signed cert at `/app/certs/server.crt`.
