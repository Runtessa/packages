---
title: Infrastructure Services
---

Supporting services:

- **Container Agent** (`src/container-agent`): container lifecycle and service runtime control.
- **Monitoring** (`src/monitoring`): ingestion, rule engine, snapshots, alert events.
- **Codex Gateway** (`src/codex-gateway`): codex execution bridge and session handling.

These services are consumed by core and/or IDE via HTTP.
