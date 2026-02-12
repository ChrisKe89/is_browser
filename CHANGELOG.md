# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning.

## [Unreleased]
### Added
- Manual click-mapping mode for `is_mapper` with `--manual`, `--location`, and `--screenshot` flags, per-run artifacts (`printer-ui-map.clicks.json`, `click-log.json`, optional screenshots), and new mapper docs under `docs/is_mapper/`.
- Mapper field capture metadata for defaults/current values and dedupe: `selectorKey`, `groupKey`, `valueType`, `defaultValue`, `currentValue`, and normalized `options[]`.
- Mapper capture-quality improvements: robust `currentValue` extraction per control type, non-empty label derivation with `labelQuality`, modal action discovery for save/cancel/close scope, and textbox constraint/hint capture (`min`, `max`, `step`, `maxLength`, `pattern`, `inputMode`, `rangeHint`).
- UI map schema additive extensions for `page.breadcrumbs`, `field.labelQuality`, `field.hints`, `field.rangeHint`, and expanded field constraints to preserve backward compatibility while retaining richer mapper output.
- Three-product monorepo structure with explicit top-level product folders: `crawler/`, `is_form/`, and `is_application/`.
- Shared contract package (`packages/contracts`) with versioned schemas for UI Map, Profile, and Apply Run payloads.
- Shared storage/platform packages (`packages/storage`, `packages/platform`) to isolate product logic from common runtime and persistence concerns.
- Standalone smoke tests for crawler map contract output, is_form boot/save flow, and is_application dry-run plan generation.
- Architecture documentation for product boundaries, data contracts, and developer workflow (`docs/Architecture.md`).
- Tools workspace (`tools/recordings`, `tools/scripts`, `tools/samples`) with README replacing legacy artifact-path usage.
- SQLite migration flow for profile-driven apply (`npm run db:migrate`) with UI map, profile, and run-audit tables.
- UI map importer (`npm run db:import-map`) that upserts pages/settings, imports selectors/nav steps, and normalizes switch options to shared option storage.
- Database-focused tests covering migration shape, import idempotency, switch normalization, and profile identity uniqueness.
- Profile CRUD services and server APIs keyed by `AccountNumber` + `variation`.
- Profile-editor schema API grouped by page and control type for text/select/radio/switch rendering.
- Validation flow that blocks invalid profile identity and setting values before save or profile-based apply.
- Runner engine module with tested navigation, selector-priority resolution, and control-apply behavior.
- Run-audit persistence service for `apply_run` and `apply_run_item` lifecycle tracking.
- Retry-classification module for bounded retry behavior (`transient` vs `terminal`) during apply and page commits.
- Integration coverage for importer + runner core flow, including selector-priority control application and run-audit outcomes (`completed`, `partial`, `failed`).
- Operator documentation for profile lifecycle and apply flow, including `AccountNumber` + `variation` identity and run-audit interpretation.
- New DB-backed form UI (`/form.html`) that renders writeable/changeable settings by control type (`text`, `number`, `textarea`, `select`, `radio`, `switch`) and saves profile values to `config_profile`/`config_profile_value`.
- New operator landing page (`/operator.html`) so server root and operator route resolve correctly.
- CSV option enrichment importer for click-map field exports (`printer-ui-map.clicks.fields.csv`) to populate missing `select`/`radio` options in `ui_setting_option`.
- Automated test coverage for CSV option enrichment into DB option tables.
- Profile value `enabled` persistence so settings can be toggled on/off without deleting stored values.
- Form controls to enable/disable individual settings and quick `Enable All` / `Disable All` actions.
- Operator discovery config persistence (`operator_config`) for subnet ranges, manual IPs, and CSV mode across restarts.
- Device resolution table (`device_resolution`) and seed import from `devices/customer-map.csv` for DB-backed model+serial account/variation lookup.
- Discovery service coverage for subnet-range parsing (`CIDR`, shorthand subnet, explicit ranges), manual-IP validation, WebUI reachability, and intervention flagging.
- Operator console UI for unified device discovery/manual add list, account-number search, variation filtering, manual intervention resolution, and apply launch.
- New tests for discovery service, device-resolution lookup, operator-config persistence, and enabled-missing-value skip behavior.
- Independent operator and form server products with dedicated entrypoints (`npm run server:operator`, `npm run server:form`) and default ports (`5050`, `5051`).
- Server-separation regression tests that enforce product API boundary isolation.
- Split deployment workflows for operator and form products:
  - `.github/workflows/deploy-operator.yml`
  - `.github/workflows/deploy-form.yml`
- Optional independent deployment webhook integration via `OPERATOR_DEPLOY_WEBHOOK_URL` and `FORM_DEPLOY_WEBHOOK_URL`.

### Changed
- `apps/is_form` now serves a normalized settings schema at `GET /api/form/schema` and the form UI was redesigned to render section/group/subgroup layouts with validation, sticky save/discard controls, and Fujifilm-branded assets.
- Finalized workspace layout under `apps/*` and `packages/*` with npm workspaces and per-workspace `package.json` files.
- Renamed shared packages to `@is-browser/contract`, `@is-browser/env`, `@is-browser/browser`, and `@is-browser/sqlite-store`; updated imports across apps/tests.
- Moved legacy root assets/config/tests into app/package ownership and `tools/samples` (`customer-map.csv`, sample settings, schema JSON).
- Removed legacy combined server entrypoint and root single-app scripts in favor of workspace-scoped scripts.
- Renamed root TypeScript config to `tsconfig.base.json` and updated path aliases for workspace packages.
- Runtime entrypoints and npm scripts now execute from product directories instead of `src/`.
- Deploy workflow path filters now target product/package directories created by the three-product split.
- Apply runner now builds a deterministic apply plan before execution and fails fast when UI map schema versions are incompatible.
- Settings-authoring schema bootstrap now returns a clear `503` error when no UI map is available and no schema is loaded.
- Error capture outputs now write under `tools/recordings/` paths.
- Documentation refresh: `README.md` now includes explicit Quick Start, Installation, Usage, Configuration, Examples, and Troubleshooting sections.
- Contribution guide now documents CI workflow location and required local quality gates (`lint`, `test`, `build`).
- Crawler/runner auth state usage is now opt-in via `USE_AUTH_STATE` (defaults to credential-based login from env vars).
- Login flow now dismisses post-login informational `Close` dialogs to stabilize traversal.
- Default JSON/config paths now use `config/`, `state/`, and `examples/` directories.
- Apply flow now enforces actionable failures for missing nav-step click targets and unresolved selectors with page/setting context.
- Apply flow now uses page-level commit actions after page updates and records per-attempt outcomes with terminal/transient retry decisions.
- Profile schema endpoint now auto-bootstraps DB map data when empty using latest available map + adjacent fields CSV fallback.
- `db:import-map` now optionally imports field CSV options (`MAP_FIELD_CSV_PATH` or `<map>.fields.csv`) in the same run.
- `npm run apply:settings` now loads settings only from DB profiles (`APPLY_ACCOUNT_NUMBER` + `APPLY_VARIATION`) instead of JSON settings files.
- `POST /api/start` now returns `410` to enforce DB-backed profile apply through `POST /api/start/profile`.
- Apply profile build now skips enabled settings with missing values as non-blocking.
- Apply logs now use discovered device identity metadata (`serial`, `model`, `productCode`) for per-device JSON naming and CSV rows.
- Operator and form UIs now cross-link through product config endpoints (`/api/operator/config`, `/api/form/config`) instead of sharing one server surface.

## [0.2.0] - 2026-02-07
### Added
- Device discovery (ARP + ping sweep) with manual IP entry fallback.
- Static HTML/JS form and schema for generating settings JSON.
- Orchestration server with operator UI endpoints.
- Structured logging and device report CSV support.
- Remote panel coordinate profile support.
- PRD, implementation, and UAT documentation.

## [0.1.0] - 2026-02-06
### Added
- Initial Playwright crawler and settings applier.
