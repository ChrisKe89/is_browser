# Task Aggregation (2026-02-11)

This file merges repository AGENTS directives and current TODO items into one deduplicated execution list.

## Discovery Results

- Located AGENTS files:
  - `AGENTS.md` (repo root)
- No additional `AGENTS.md` files were found under `projects/`, `apps/`, or `packages/`.

## Aggregated Queue

### Priority 1 - Architecture Separation (Completed 2026-02-11)

- [x] `TSK-001` Create explicit three-product folder structure.
- [x] `TSK-002` Extract crawler into standalone `crawler/` product.
- [x] `TSK-003` Define shared contract package for UI Map, Profile, and Apply Run.
- [x] `TSK-004` Refactor settings form + DB into standalone `settings-authoring/` product.
- [x] `TSK-005` Refactor apply UX into standalone `apply-runner/` product with schema compatibility checks.
- [x] `TSK-006` Enforce DB-only profile values at apply time.
- [x] `TSK-007` Replace ambiguous artifact paths with `tools/recordings`, `tools/scripts`, and `tools/samples`.
- [x] `TSK-008` Add standalone smoke tests for crawler, settings-authoring, and apply-runner.
- [x] `TSK-009` Publish architecture + data model docs for new contributors.

### Priority 2 - Quality Gates (Completed 2026-02-11)

- [x] Typecheck/lint passes locally (`npm run lint`).
- [x] Full test suite passes locally (`npm test`).
- [x] Build passes locally (`npm run build`).
- [x] CI workflow and deploy workflow path filters aligned to new folder structure.

### Priority 3 - Ongoing Maintenance

- [ ] Quarterly dependency/security audit (`npm outdated`, `npm audit`) and stale-link documentation sweep.

## Notes

- Baseline repository requirements remain present: `.editorconfig`, `.gitignore`, `LICENSE`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`.
- Coverage instrumentation is still not enforced in tooling; target remains documented as >=90%.
