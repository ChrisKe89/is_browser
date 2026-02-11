# Three-Product Architecture

## Product Boundaries

- `crawler/`: maps printer UI pages/settings/selectors into a versioned `ui-map.json`.
- `settings-authoring/`: form + DB product for authoring profiles from a UI map.
- `apply-runner/`: operator UX and runner that applies profile values using UI map selectors.
- `packages/contracts/`: shared data contracts and validation for UI Map, Profile, and Apply Run.
- `packages/storage/`: shared SQLite persistence services used by authoring and runner products.
- `packages/platform/`: shared runtime helpers (env loading, HTTP utils, Playwright browser helpers).

## Data Contracts

- UI Map (`packages/contracts/src/uiMap.ts`)
  - Canonical schema for pages, nav steps, fields, selectors, constraints.
  - Versioned with `UI_MAP_SCHEMA_VERSION` (`1.1`) and compatibility checks.
- Profile (`packages/contracts/src/profile.ts`)
  - Identity (`accountNumber` + `variation`), value entries, value-map projection.
  - Validation used by profile save/read/build flows.
- Apply Run (`packages/contracts/src/applyRun.ts`)
  - Run start/finish/item schemas and status enums.
  - Validation used by run-audit persistence.

## Runtime Independence

- Crawler runs with printer + browser only.
- Settings authoring runs with UI map + DB only.
- Apply runner runs with UI map + profile DB values only.
- Apply from inline JSON settings is disabled (`POST /api/start` returns `410`).

## Developer Workflow

1. Capture auth state if needed: `npm run auth:capture`.
2. Crawl and generate map: `npm run map:ui`.
3. Import map to DB: `npm run db:import-map`.
4. Start authoring + operator products: `npm run server`.
5. Author profiles in form UI and apply from operator UI or `npm run apply:settings`.

## Tooling Layout

- `tools/recordings`: interaction recordings and error captures.
- `tools/scripts`: manual capture/map utility scripts.
- `tools/samples`: sample/manual support files.
