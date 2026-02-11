# Contributing

Thanks for helping improve this project. Keep changes focused and avoid introducing new tooling unless necessary.

## Setup
1. Install dependencies: `make install`
2. Copy env file: `cp .env.example .env`

## Development Scripts
- `make is-mapper-map` - Crawl the printer WebUI and generate `state/printer-ui-map.json`.
- `make apply-settings` - Apply a DB-backed profile (`APPLY_ACCOUNT_NUMBER` + `APPLY_VARIATION`) to a device.
- `make form-dev` - Start the is_form product.
- `make apply-dev` - Start the is_application product.
- `npm run typecheck` - TypeScript typecheck (no emit).
- `make test` - Run unit tests.
- `npm run lint` - Alias to typecheck (no formatting changes).
- `make build` - Compile TypeScript output.

## Product Layout
- `apps/is_mapper/` - printer UI crawl + map generation.
- `apps/is_form/` - form + DB profile authoring.
- `apps/is_application/` - operator UX + apply execution.
- `packages/contract/` - shared schema contracts.
- `packages/sqlite-store/`, `packages/env/`, and `packages/browser/` - shared persistence/runtime helpers.

## Code Style
- Indentation is 2 spaces.
- Avoid reformatting unrelated files.
- Prefer simple, readable logic over cleverness.

## Tests & Coverage
We use Node's built-in test runner. Coverage is not enforced yet; the target is ≥90% but instrumentation is pending.
Document any changes that impact testability and add tests for new modules where practical.

## CI & Quality Gates
- CI quality workflow lives at `.github/workflows/ci.yml`.
- Required local checks before PR:
  - `npm run lint`
  - `make test`
  - `make build`
- Keep docs in sync with behavior changes:
  - Update `README.md` and `CHANGELOG.md` in the same change when user-facing behavior or workflows change.

## Pull Requests
- Branch names: `feature/<topic>`, `fix/<topic>`, or `chore/<topic>`.
- Title format: `[printer-ui-mapper] Short description`.
- Update `CHANGELOG.md` and docs with any behavioral changes.
