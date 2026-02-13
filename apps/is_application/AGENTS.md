# AGENTS.md (apps/is_application)

## Purpose

Operator product + apply runner.

- Serves the operator UI and API for discovery + running DB-backed profile applies.
- Includes CLIs for applying settings and printing discovery results.

## Canonical Commands (Makefile-first)

- Dev server (operator UI/API): `make apply-dev`
- Apply settings (DB-backed profile): `make apply-settings`
- Discovery scan CLI (prints JSON): `make discovery-scan`
- Tests (repo-wide): `make test`
- Tests (this workspace only): `npm -w apps/is_application test`

## Entrypoints

- Operator server: `apps/is_application/src/server/operator.ts`
- Operator server implementation: `apps/is_application/src/server/operatorServer.ts`
- Apply CLI: `apps/is_application/src/runner/apply.ts`
- Discovery CLI: `apps/is_application/src/discovery/cli.ts`

## Config & Environment

Shared defaults live in `packages/env/src/env.ts` (ports, DB path, discovery ranges, etc).

Common env vars used here:

- Operator server:
  - `OPERATOR_PORT` (default `5050`)
  - `FORM_PUBLIC_URL` (default `http://localhost:5051`)
  - `PROFILE_DB_PATH` (default `state/profile-runner.sqlite`)
  - `CUSTOMER_MAP_CSV` (CSV seed for device resolution)
- Apply CLI / runner:
  - `APPLY_ACCOUNT_NUMBER` (required)
  - `APPLY_VARIATION` (default `default`)
  - `MAP_PATH` (default `state/printer-ui-map.json`; server may auto-resolve under `state/`)
  - `MAP_FIELD_CSV_PATH` (optional; for option enrichment)
  - `PRINTER_URL` or `PRINTER_IP` (device target)
  - `APPLY_HEADLESS`, `APPLY_CONSOLE_VISIBLE`, `APPLY_DEVICE_LOG_MODE`

## Notes

- File-based apply via `/api/start` is intentionally disabled (returns `410`); use DB-backed profile apply (`/api/start/profile`) or `make apply-settings`.
- Operator UI links to the form product; keep `FORM_PUBLIC_URL` aligned with the form server.

## Architectural Boundaries

- This product must not define UI structure; it consumes the canonical UI map.
- Navigation must use stored navPath steps from the map.
- Profiles must not contain Playwright selectors or navigation logic.
- Any change that alters data contracts must update TechnicalStrategy.md first.
- Do not bypass the knowledge graph abstraction when applying settings.
