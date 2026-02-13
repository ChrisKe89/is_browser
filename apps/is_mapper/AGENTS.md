# AGENTS.md (apps/is_mapper)

## Purpose

Playwright crawler that generates a versioned UI map for a printer WebUI.

- Crawls pages, discovers fields, and writes a JSON UI map used by the form and operator products.
- Includes an auth-state capture helper for workflows that need saved cookies/storage.

## Canonical Commands (Makefile-first)

- Crawl + generate UI map: `make is-mapper-map`
- Manual click mapping: `make is-mapper-manual`
- Dev-mode run (same entrypoint): `make is-mapper-dev`
- Capture auth state (manual login): `npm -w apps/is_mapper run auth:capture`
- Tests (repo-wide): `make test`
- Tests (this workspace only): `npm -w apps/is_mapper test`

## Entrypoints

- Crawler: `apps/is_mapper/src/index.ts`
- Login flow helpers: `apps/is_mapper/src/login.ts`
- Auth capture: `apps/is_mapper/src/auth/capture.ts`
- Crawler flows config: `apps/is_mapper/config/crawler-flows.json`

## Config & Environment

Shared defaults live in `packages/env/src/env.ts`.

Common env vars:

- Required for crawler login:
  - `PRINTER_USER`, `PRINTER_PASS`
- Target + navigation:
  - `PRINTER_URL` (default `http://192.168.0.107`)
  - `NAV_TIMEOUT_MS`
  - `HEADLESS`
- Output:
  - `MAP_PATH` (default `state/printer-ui-map.json`)
- Crawl controls:
  - `CRAWL_MAX_PAGES`
  - `CRAWL_INCLUDE_HASH`
  - `CRAWL_EXPAND_CHOICES`
  - `CRAWL_MENU_TRAVERSE`
  - `CRAWL_SEED_PATHS` (comma-separated)
  - `CRAWL_FLOWS_PATH` (default `config/crawler-flows.json`)
- Auth capture output:
  - `AUTH_STATE_PATH` (default `state/auth-state.json`)

## Notes

- On crawl failures, screenshots are saved under `tools/recordings/`.
- Be cautious changing skip/avoid patterns in the crawler; they exist to avoid destructive UI actions.

## Deterministic Mapping Requirements

- Repeated mapping runs on identical firmware must produce stable node and field IDs.
- Field fingerprints must be stable across DOM order shifts when possible.
- Variant exploration must restore original state after scanning.
- Mapping must distinguish page-level and modal-level save scopes.
- Do not introduce brittle CSS-only selectors as primary identity.
- Mapping output (JSON) is canonical; YAML is derived.
- Any change to fingerprint strategy or node identity requires updating TechnicalStrategy.md.
