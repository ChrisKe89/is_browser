# Operator Profile-Driven Apply Workflow

This guide explains the profile-driven data model and the end-to-end workflow from UI-map import to apply execution.

## Data Model (Table Purposes)

### UI Map Tables
- `ui_page`: One row per mapped page (URL/title/source metadata).
- `ui_setting`: One row per setting field on a page (control type and constraints).
- `ui_setting_option`: Allowed options for `select`, `radio`, and normalized `switch` settings.
- `ui_setting_selector`: Selector candidates per setting with priority ordering.
- `ui_page_nav_step`: Ordered `goto`/`click` steps required to reach a page.

### Profile Tables
- `config_profile`: Profile identity keyed by `account_number` + `variation`.
- `config_profile_value`: Value rows per profile/setting pair, including `enabled` state.

### Run-Audit Tables
- `apply_run`: One row per apply attempt lifecycle (`started`, `completed`, `partial`, `failed`).
- `apply_run_item`: Per-attempt outcome rows per setting (or commit-level item), including status/message/attempt number.

## Profile Lifecycle (`AccountNumber` + `variation`)

1. Import UI map into DB (`ui_*` tables).
2. Create profile identity (`account_number`, `variation`).
3. Save validated profile values to `config_profile_value`.
4. Start apply by profile (`POST /api/start/profile`).
5. Runner loads values, applies settings, commits page-level changes when defined, and writes run audit rows.

A single account can keep multiple profile variations (for example: `base`, `night`, `warehouse`) without collisions.

## End-to-End Operator Workflow

1. Run migrations:
   - `npm run db:migrate`
2. Import latest map:
   - `npm run db:import-map`
3. Start operator server:
   - `npm run server`
4. Build/update profile values through APIs:
   - `GET /api/profiles/schema`
   - `POST /api/profiles/save`
   - Enabled flags are persisted per setting and can be toggled on demand in the profile form.
5. Start profile apply:
   - `POST /api/start/profile`
6. Monitor status:
   - `GET /api/status`
7. Review output logs:
   - JSON log under `devices/logs/customers/...`
   - CSV report under `devices/reports/...`
   - Audit records in `apply_run` and `apply_run_item`

## How to Read Run Outcomes

- `apply_run.status = completed`
  - All attempted settings/commits succeeded.
- `apply_run.status = partial`
  - At least one item succeeded and at least one failed.
- `apply_run.status = failed`
  - Run ended without any successful apply/commit items.

For troubleshooting:
- Check `apply_run.message` for the run-level summary.
- Check `apply_run_item` rows ordered by `id` for per-attempt details:
  - `status`: `ok`, `error`, or `skipped`
  - `attempt`: retry number
  - `message`: classification/reason context for failures

## Failure Classification and Retries

- Transient failures retry up to bounded limits.
- Terminal failures fail fast with explicit reason context.
- Classification is recorded in apply log messages and reflected in run-item messages.
