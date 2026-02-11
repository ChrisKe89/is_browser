# Printer WebUI Mapper (Playwright)

This tool crawls a printer WebUI and builds a JSON map of pages and settings fields, then applies settings from DB-backed profiles. It also provides device discovery, a static HTML/JS profile form, remote panel coordination, and structured logging.

## Quick Start

1. Install dependencies:

```bash
make install
```

2. Create `.env`:

```bash
cp .env.example .env
```

3. Set `PRINTER_USER` and `PRINTER_PASS`.
4. Run DB migrations:

```bash
make db-migrate
```

5. Start both products:

```bash
make dev-all
```

## Installation

- Runtime: Node.js 22.x
- Package manager: npm (`package-lock.json` is committed and should remain the source of truth)
- First-time setup:

```bash
make install
cp .env.example .env
```

## Usage

- Both products (operator + form): run `make dev-all`
- Operator product only: `make apply-dev`
- Form product only: `make form-dev`
- Capture auth state (optional): `npm -w apps/is_mapper run auth:capture`
- Crawl printer UI and generate map: `make is-mapper-map`
- Apply DB-backed profile settings: `make apply-settings`
- Run tests: `make test`
- Typecheck/lint: `npm run lint`

## Architecture

- `apps/is_mapper/`: standalone UI crawler that emits versioned UI maps.
- `apps/is_form/`: standalone form + DB profile authoring product.
- `apps/is_application/`: standalone operator UX + apply runner product.
- `packages/contract/`: shared versioned schemas and validation.
- `packages/sqlite-store/`: shared SQLite services for map import, profiles, and run audit.
- `packages/env/` + `packages/browser/`: shared runtime helpers (`env`, HTTP utilities, Playwright helpers).

Detailed architecture and contract docs: `docs/Architecture.md`.

## CI/CD Workflows

- Quality gate workflow: `.github/workflows/ci.yml`

Deployment behavior:
- CI runs lint, tests, and TypeScript build on pushes and pull requests.

## Configuration

Core environment variables:

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PRINTER_USER` | Yes | n/a | Printer WebUI username for login flow |
| `PRINTER_PASS` | Yes | n/a | Printer WebUI password for login flow |
| `USE_AUTH_STATE` | No | `false` | Load `state/auth-state.json` instead of credential login |
| `PROFILE_DB_PATH` | No | `state/profile-runner.sqlite` | SQLite DB path for profiles and run state |
| `MAP_PATH` | No | `state/printer-ui-map.json` | UI map JSON path used by importer/runner |
| `MAP_FIELD_CSV_PATH` | No | auto-detected | Optional fields CSV path for option enrichment |
| `APPLY_ACCOUNT_NUMBER` | Yes (for `apply:settings`) | n/a | Account identity for DB-backed apply |
| `APPLY_VARIATION` | Yes (for `apply:settings`) | n/a | Variation identity for DB-backed apply |
| `APPLY_DEVICE_LOG_MODE` | No | `all-time` | CSV log mode (`all-time` or `daily`) |
| `SNMP_COMMUNITY` | No | `public` | SNMP community for identity reads |
| `SNMP_VERSION` | No | `2c` | SNMP protocol version |
| `SNMP_TIMEOUT_MS` | No | `2000` | SNMP timeout in milliseconds |

## Operator + Form Products

Start both products locally:

```bash
make dev-all
```

Default URLs:
- Operator UI: http://localhost:5050/
- Settings form: http://localhost:5051/
- You can also start each product independently with `make apply-dev` and `make form-dev`.
- The form is DB-backed and saves profile values under `Account` + `Variation`.
- Operator UI includes subnet-range discovery, manual IP add/remove, account/variation resolution, and run-state console.

Settings schema and remote panel profiles:
- `tools/samples/settings-schema.json`
- `apps/is_application/config/remote-panel-profiles.json`

## Capture Auth State (Cookies)

If direct navigation fails due to auth, capture a browser storage state:

```bash
npm -w apps/is_mapper run auth:capture
```

Log in manually, then press Enter in the terminal to save `state/auth-state.json`.
By default, crawler/runner uses `PRINTER_USER` + `PRINTER_PASS` login logic. Set `USE_AUTH_STATE=true` only when you want to load `state/auth-state.json`.

## Generate UI Map

```bash
make is-mapper-map
```

Outputs `state/printer-ui-map.json` and saves screenshots on errors in `tools/recordings/`.

## Persist UI Map + Profiles (SQLite)

Run schema migrations:

```bash
make db-migrate
```

Import the captured UI map into relational tables:

```bash
make db-import-map
```

Import a specific click-map + field CSV from a dated capture folder:

```bash
MAP_PATH=state/20260210/printer-ui-map.clicks.json MAP_FIELD_CSV_PATH=state/20260210/printer-ui-map.clicks.fields.csv make db-import-map
```

Defaults:
- `PROFILE_DB_PATH=state/profile-runner.sqlite`
- map input path uses `MAP_PATH` or falls back to `state/printer-ui-map.json`

Tables created by migration include:
- UI map model: `ui_page`, `ui_setting`, `ui_setting_option`, `ui_setting_selector`, `ui_page_nav_step`
- Profile/run model: `config_profile`, `config_profile_value`, `apply_run`, `apply_run_item`

CSV enrichment note:
- `db:import-map` now merges select/radio option values from `*.fields.csv` into `ui_setting_option` when available.

## Form Product APIs

The form product exposes profile APIs keyed by `AccountNumber` + `variation`:
- `GET /api/profiles/schema` returns profile-editor pages grouped by control type.
- `GET /api/profiles/list?accountNumber=...` lists profile identities.
- `POST /api/profiles/get` loads one profile.
- `POST /api/profiles/save` creates or updates one profile with validated values.
- `POST /api/profiles/delete` deletes one profile identity.

## Operator Product APIs

The operator product exposes apply and discovery APIs:
- `POST /api/start/profile` runs apply directly from stored profile values.
- `GET /api/discovery/config` returns persisted operator subnet/manual-IP/csv-mode inputs.
- `POST /api/discovery/config` saves subnet/manual-IP/csv-mode inputs (loaded on next startup).
- `POST /api/discover` scans configured subnet ranges and returns reachable devices with WebUI reachability and identity status.
- `POST /api/devices/manual` validates manual IPv4 + reachability and adds to the same unified device list.
- `POST /api/devices/resolve` assigns account/variation for intervention-required devices.
- `GET /api/accounts` searches account numbers (search-first input support).
- `GET /api/accounts/variations` lists variations filtered to one account and returns model requirements.
- Per-setting enable/disable state is stored in DB; disabled settings are skipped during apply.
- Enabled settings with missing values are skipped during apply (non-blocking).
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
Some settings only appear after clicking through the UI. Define these paths in `apps/is_mapper/config/crawler-flows.json`.

## Apply Settings

```bash
make apply-settings
```

`apply:settings` now loads settings only from DB profiles. Provide the profile identity in env vars:

```bash
APPLY_ACCOUNT_NUMBER=10001 APPLY_VARIATION=base MAP_PATH=state/printer-ui-map.json make apply-settings
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

## Examples

Start operator UI + form:

```bash
make dev-all
```

Apply one account/variation from DB:

```bash
APPLY_ACCOUNT_NUMBER=10001 APPLY_VARIATION=base make apply-settings
```

Import a dated click-map + field CSV:

```bash
MAP_PATH=state/20260210/printer-ui-map.clicks.json MAP_FIELD_CSV_PATH=state/20260210/printer-ui-map.clicks.fields.csv make db-import-map
```

## Device Discovery

Discovery uses subnet-range scanning with reachability + WebUI checks:
- Subnet ranges are configured in the operator UI and persisted in DB (`operator_config`).
- Manual IPs are validated for IPv4 format and host reachability before being accepted.
- Known model+serial combinations auto-resolve account/variation via DB lookup (`device_resolution`).
- Unmatched devices remain in `USER_INTERVENTION_REQUIRED` until resolved in UI.

SNMP identity lookup (model + serial) uses global env settings:
- `SNMP_COMMUNITY` (default `public`)
- `SNMP_VERSION` (default `2c`)
- `SNMP_TIMEOUT_MS` (default `2000`)

## Serial Parsing Note
Some devices report a combined product code + serial string. The system will split these so that:
- `serial` = last 6 characters (left-padded with `0` if needed)
- `productCode` = remaining leading characters

## Troubleshooting

- `POST /api/start` returns `410`: expected behavior; use `POST /api/start/profile` or `make apply-settings` with DB profile identity.
- `GET /api/profiles/*` returns `404` on operator product: expected behavior; profile APIs are served by the form product.
- `POST /api/discover` or `POST /api/start/profile` returns `404` on form product: expected behavior; apply/discovery APIs are served by the operator product.
- Profile schema is empty: call `GET /api/profiles/schema`; the server bootstraps map data from `MAP_PATH` or latest click-map fallback.
- Apply skipped settings unexpectedly: verify per-setting `enabled` state and confirm values exist for selected `accountNumber` + `variation`.
- Discovery finds host but not WebUI: confirm printer HTTP/HTTPS availability and credentials.
- SNMP identity missing: verify `SNMP_COMMUNITY`, `SNMP_VERSION`, and network ACL/firewall access.

## Documentation
- PRD: `tasks/PRD-Three-Product-Architecture.md`
- Architecture and data model: `docs/Architecture.md`
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


