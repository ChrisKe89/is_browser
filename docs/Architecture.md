# Three-Product Architecture

## Product Boundaries

- `is_mapper/`: maps printer UI pages/settings/selectors into a versioned `ui-map.json`.
- `is_form/`: form + DB product for authoring profiles from a UI map.
- `is_application/`: operator UX and runner that applies profile values using UI map selectors.
- `packages/contract/`: shared data contracts and validation for UI Map, Profile, and Apply Run.
- `packages/sqlite-store/`: shared SQLite persistence services used by authoring and runner products.
- `packages/env/` and `packages/browser/`: shared runtime helpers (env loading, HTTP utils, Playwright browser helpers).

## Data Contracts

- UI Map (`packages/contract/src/uiMap.ts`)
  - Canonical schema for pages, nav steps, fields, selectors, constraints.
  - Versioned with `UI_MAP_SCHEMA_VERSION` (`1.1`) and compatibility checks.
- Profile (`packages/contract/src/profile.ts`)
  - Identity (`accountNumber` + `variation`), value entries, value-map projection.
  - Validation used by profile save/read/build flows.
- Apply Run (`packages/contract/src/applyRun.ts`)
  - Run start/finish/item schemas and status enums.
  - Validation used by run-audit persistence.

## Runtime Independence

- Crawler runs with printer + browser only.
- Settings authoring runs with UI map + DB only.
- Apply runner runs with UI map + profile DB values only.
- Apply from inline JSON settings is disabled (`POST /api/start` returns `410`).

## Developer Workflow

1. Capture auth state if needed: `npm run auth:capture`.
2. Crawl and generate map: `make is-mapper-map`.
3. Import map to DB: `make db-import-map`.
4. Start authoring + operator products: `make dev-all`.
5. Author profiles in form UI and apply from operator UI or `make apply-settings`.

## Tooling Layout

- `tools/recordings`: interaction recordings and error captures.
- `tools/scripts`: manual capture/map utility scripts.
- `tools/samples`: sample/manual support files.
