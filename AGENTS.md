# AGENTS.md (optional)
- Prefer small, single-responsibility modules.
- When splitting files, keep public APIs stable (use re-export shims if needed).
- Extract duplicate logic into shared modules with clear names and tests.
- Avoid circular dependencies; keep dependency direction: shared/core -> domain -> adapters.
- Always run lint/tests/build after refactors and fix regressions.
