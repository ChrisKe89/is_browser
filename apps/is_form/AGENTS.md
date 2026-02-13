# AGENTS.md (apps/is_form)

## Purpose

Profile authoring form + DB workflows.

- Serves the profile form UI and APIs for creating/editing profiles.
- Owns DB migration + UI-map import workflows.

## Canonical Commands (Makefile-first)

- Dev server (form UI/API): `make form-dev`
- Run DB migrations: `make db-migrate`
- Import UI map into DB: `make db-import-map`
- Tests (repo-wide): `make test`
- Tests (this workspace only): `npm -w apps/is_form test`

## Entrypoints

- Form server: `apps/is_form/src/server/form.ts`
- Form server implementation: `apps/is_form/src/server/formServer.ts`

## Config & Environment

Shared defaults live in `packages/env/src/env.ts`.

Common env vars used here:

- `FORM_PORT` (default `5051`)
- `OPERATOR_PUBLIC_URL` (default `http://localhost:5050`)
- `PROFILE_DB_PATH` (default `state/profile-runner.sqlite`)
- `MAP_PATH` (optional; otherwise server searches under `state/`)
- `MAP_FIELD_CSV_PATH` (optional; otherwise inferred next to map or from `state/`)

## Notes

- The form requires UI map data to author profiles. If the schema is empty, call `GET /api/profiles/schema` (the server will import from `MAP_PATH` or the latest available `state/**` capture).
- The form UI includes a link back to the operator product; keep `OPERATOR_PUBLIC_URL` aligned with the operator server.

## Architectural Boundaries

- The form consumes UI map structure; it does not define UI structure.
- Profile values reference fieldId only; they must not embed selectors.
- The form must not introduce automation logic.
- If profile schema changes require data model updates, update TechnicalStrategy.md first.
- YAML exports are derived artifacts and must not become the source of truth.
