# Task Aggregation (2026-02-10)

This file merges global AGENTS directives with repository TODO items, deduplicated and prioritized for execution.

## Discovery Results
- Located AGENTS files:
  - `AGENTS.md` (repo root)
- No additional `AGENTS.md` files found under `./projects`, `./apps`, or `./packages` (directories not present in this repository).

## Aggregated Task Queue

### Priority 1 - Required foundation and quality gates
- [x] Add CI workflow running install, lint, test, and build.
  - Completed: 2026-02-09
  - File: `.github/workflows/ci.yml`
- [x] Implement TODO `TSK-001` through `TSK-004` (schema + importer foundations).
  - Completed: 2026-02-10
  - Files: `src/db/migrations.ts`, `src/db/importer.ts`, `src/db/migrate.ts`, `src/db/importMap.ts`, `test/db.test.js`
- [x] Implement TODO `TSK-005` through `TSK-007` (profile CRUD + validation).
  - Completed: 2026-02-10
  - Files: `src/db/profiles.ts`, `src/server/index.ts`, `test/profiles.test.js`
- [x] Implement TODO `TSK-008` through `TSK-013` (navigation, locator fallback, apply behavior, retries, run auditing).
  - Completed: 2026-02-10
  - Files: `src/runner/engine.ts`, `src/runner/applySettings.ts`, `src/schema/types.ts`, `src/runner/retry.ts`, `src/db/runAudit.ts`, `test/runner-engine.test.js`, `test/retry.test.js`, `test/run-audit.test.js`
- [x] Implement TODO `TSK-014` integration tests for importer and runner core flow.
  - Completed: 2026-02-10
  - Files: `test/apply.integration.test.js`

### Priority 2 - Documentation and release hygiene
- [x] Update operator docs for profile-driven workflow (`TSK-015`).
  - Completed: 2026-02-10
  - Files: `docs/OperatorProfileApplyWorkflow.md`, `README.md`
- [x] Add release notes for profile-driven apply functionality (`TSK-016`).
  - Completed: 2026-02-10
  - File: `CHANGELOG.md`
- [x] Keep `README.md` and `CHANGELOG.md` synchronized with behavior changes in each PR.
  - Completed for this implementation cycle: 2026-02-10
  - Ongoing policy: continue enforcing on every PR.

### Priority 3 - Ongoing maintenance
- [ ] Quarterly dependency/security review (`npm outdated`, `npm audit`) and stale-link/docs audit.

## Notes
- The repository already satisfies required baseline files: `.editorconfig`, `.gitignore`, `LICENSE`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, and `SECURITY.md`.
- Coverage target (>=90%) is currently documented as a pending exemption in `README.md` and `CONTRIBUTING.md`.
