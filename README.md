# Printer WebUI Mapper (Playwright)

This tool crawls a printer WebUI and builds a JSON map of pages and settings fields, then applies settings from DB-backed profiles. It also provides device discovery, a static HTML/JS profile form, remote panel coordination, and structured logging.

## Setup

1. Install deps:

```bash
npm install
```

2. Create `.env`:

```bash
cp .env.example .env
```

Set `PRINTER_USER` and `PRINTER_PASS`.

## Operator Server + Form

Start the local server (operator UI + settings form):

```bash
npm run server
```

Default URLs:
- Operator UI: http://localhost:5050/operator.html
- Settings form: http://localhost:5050/form.html
- The form is DB-backed and saves profile values under `Account` + `Variation`.

Settings schema and remote panel profiles:
- `config/settings-schema.json`
- `config/remote-panel-profiles.json`

## Capture Auth State (Cookies)

If direct navigation fails due to auth, capture a browser storage state:

```bash
npm run auth:capture
```

Log in manually, then press Enter in the terminal to save `state/auth-state.json`.
By default, crawler/runner uses `PRINTER_USER` + `PRINTER_PASS` login logic. Set `USE_AUTH_STATE=true` only when you want to load `state/auth-state.json`.

## Generate UI Map

```bash
npm run map:ui
```

Outputs `state/printer-ui-map.json` and saves screenshots on errors in `artifacts/`.

## Persist UI Map + Profiles (SQLite)

Run schema migrations:

```bash
npm run db:migrate
```

Import the captured UI map into relational tables:

```bash
npm run db:import-map
```

Import a specific click-map + field CSV from a dated capture folder:

```bash
MAP_PATH=state/20260210/printer-ui-map.clicks.json MAP_FIELD_CSV_PATH=state/20260210/printer-ui-map.clicks.fields.csv npm run db:import-map
```

Defaults:
- `PROFILE_DB_PATH=state/profile-runner.sqlite`
- map input path uses `MAP_PATH` or falls back to `state/printer-ui-map.json`

Tables created by migration include:
- UI map model: `ui_page`, `ui_setting`, `ui_setting_option`, `ui_setting_selector`, `ui_page_nav_step`
- Profile/run model: `config_profile`, `config_profile_value`, `apply_run`, `apply_run_item`

CSV enrichment note:
- `db:import-map` now merges select/radio option values from `*.fields.csv` into `ui_setting_option` when available.

## Profile Workflow APIs

The operator server now exposes profile APIs keyed by `AccountNumber` + `variation`:
- `GET /api/profiles/schema` returns profile-editor pages grouped by control type.
- `GET /api/profiles/list?accountNumber=...` lists profile identities.
- `POST /api/profiles/get` loads one profile.
- `POST /api/profiles/save` creates or updates one profile with validated values.
- `POST /api/profiles/delete` deletes one profile identity.
- `POST /api/start/profile` runs apply directly from stored profile values.
- Per-setting enable/disable state is stored in DB; disabled settings are skipped during apply.
- Legacy file-based `POST /api/start` is disabled.

Validation rules enforced before profile save/apply:
- `accountNumber` and `variation` are required.
- `select`, `radio`, and `switch` values must match allowed options.
- `text`/`textarea` values must be strings.
- `number` values must be numeric and respect configured min/max when present.

Schema bootstrap behavior:
- If profile schema tables are empty, `GET /api/profiles/schema` auto-imports from the latest available map (`MAP_PATH` when valid, otherwise latest `state/**/printer-ui-map.clicks.json` fallback).
- If a matching fields CSV is found, select/radio options are merged from that CSV.

## Crawler Flows (Deep Settings)
Some settings only appear after clicking through the UI. Define these paths in `config/crawler-flows.json`.

## Apply Settings

```bash
npm run apply:settings
```

`apply:settings` now loads settings only from DB profiles. Provide the profile identity in env vars:

```bash
APPLY_ACCOUNT_NUMBER=10001 APPLY_VARIATION=base MAP_PATH=state/printer-ui-map.json npm run apply:settings
```

Optional apply env vars:
- `APPLY_CUSTOMER_NAME`
- `APPLY_SCRIPT_VARIANT`
- `APPLY_HEADLESS` (`true`/`false`)
- `APPLY_CONSOLE_VISIBLE` (`true`/`false`)
- `APPLY_DEVICE_LOG_MODE` (`all-time`/`daily`)

Runner behavior highlights:
- Page navigation executes stored `navPath` steps in order (`goto`/`click`) and fails with contextual errors when a click target is missing.
- Selector resolution uses priority order (`selector.priority` when present, otherwise selector list order).
- Control apply supports deterministic fallbacks for `text`, `select`, `radio`, and `switch` (`checkbox`) controls.
- Page-level commit uses a consistent apply/save model and commits changed pages when commit actions are defined in the UI map.
- Run lifecycle is persisted to `apply_run` and per-attempt setting outcomes are persisted to `apply_run_item`.
- Retry logic is bounded and classification-aware: transient failures retry up to a fixed limit, terminal failures fail fast with explicit reasons.

## Device Discovery

Discovery uses ARP + ping sweep. Configure via `.env`:
- `DISCOVERY_SUBNET` (e.g., `192.168.0`)
- `DISCOVERY_RANGE_START` / `DISCOVERY_RANGE_END` (e.g., `1` / `254`)

## Serial Parsing Note
Some devices report a combined product code + serial string. The system will split these so that:
- `serial` = last 6 characters (left-padded with `0` if needed)
- `productCode` = remaining leading characters

## Documentation
- PRD: `tasks/prd-printer-webui-automation.md`
- Implementation plan: `docs/ImplementationPlan.md`
- Operator profile workflow: `docs/OperatorProfileApplyWorkflow.md`
- UAT scenarios: `docs/UAT.md`
- Repo guidance: `AGENTS.md`

## Notes

- Selector strategy prefers `getByRole` + labels when possible, with CSS fallback.
- If the UI uses nonstandard elements or dynamic menus, you may need to adjust selectors in `state/printer-ui-map.json`.
- MCP integration is optional. This repo runs Playwright directly, but you can run a Playwright MCP server and call these scripts from an MCP client workflow.

## Coverage Note
Coverage is not enforced yet (target ≥90%). This is documented in `CONTRIBUTING.md`.

## Playwright MCP Server (Optional)

```bash
npm run mcp:server
```
