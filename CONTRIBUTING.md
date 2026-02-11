# Contributing

Thanks for helping improve this project. Keep changes focused and avoid introducing new tooling unless necessary.

## Setup
1. Install dependencies: `npm install`
2. Copy env file: `cp .env.example .env`

## Development Scripts
- `npm run map:ui` - Crawl the printer WebUI and generate `state/printer-ui-map.json`.
- `npm run apply:settings` - Apply a DB-backed profile (`APPLY_ACCOUNT_NUMBER` + `APPLY_VARIATION`) to a device.
- `npm run server` - Start both local products (operator + form).
- `npm run server:operator` - Start the operator product only.
- `npm run server:form` - Start the form product only.
- `npm run typecheck` - TypeScript typecheck (no emit).
- `npm test` - Run unit tests.
- `npm run lint` - Alias to typecheck (no formatting changes).
- `npm run build` - Compile TypeScript output.

## Code Style
- Indentation is 2 spaces.
- Avoid reformatting unrelated files.
- Prefer simple, readable logic over cleverness.

## Tests & Coverage
We use Node's built-in test runner. Coverage is not enforced yet; the target is ≥90% but instrumentation is pending.
Document any changes that impact testability and add tests for new modules where practical.

## CI & Quality Gates
- CI quality workflow lives at `.github/workflows/ci.yml`.
- Product deployment workflows live at:
  - `.github/workflows/deploy-operator.yml`
  - `.github/workflows/deploy-form.yml`
- Optional deployment webhooks:
  - `OPERATOR_DEPLOY_WEBHOOK_URL`
  - `FORM_DEPLOY_WEBHOOK_URL`
- Required local checks before PR:
  - `npm run lint`
  - `npm test`
  - `npm run build`
- Keep docs in sync with behavior changes:
  - Update `README.md` and `CHANGELOG.md` in the same change when user-facing behavior or workflows change.

## Pull Requests
- Branch names: `feature/<topic>`, `fix/<topic>`, or `chore/<topic>`.
- Title format: `[printer-ui-mapper] Short description`.
- Update `CHANGELOG.md` and docs with any behavioral changes.
