# AGENTS.md

## Purpose

Lightweight guidance for working in this repository. Keep it minimal and flexible. Prefer linking to `README.md`/`docs/` over duplicating long runbooks here.

## Repo Basics

- Runtime: Node.js (see `README.md`; CI uses Node 22).
- Package manager: `npm` (keep `package-lock.json` as source of truth).
- Workspace layout:
  - `apps/is_mapper/` — Playwright crawler that generates UI maps.
  - `apps/is_form/` — profile authoring form + DB workflows.
  - `apps/is_application/` — operator UX + apply runner + discovery scan.
  - `packages/*` — shared libraries (`contract`, `sqlite-store`, `env`, `browser`).
- Build artifacts:
  - `dist/` and `state/` are generated outputs; don’t edit them directly.

## General Guidelines

- Do not introduce heavy process or ceremony.
- Do not block progress with unnecessary approvals or gates.
- Do not add new tooling unless it is clearly required for the task.
- Do not reformat files or change styles unless a change is needed for the task.
- Do not remove or overwrite user content without an explicit request.
- Do not change public behavior or interfaces without calling it out in your response.
- Do not run destructive commands like `git reset --hard` or `git checkout --`.
- Do not assume network access to the printer UI unless confirmed.
- Do not store credentials in the repo.
- Do not add secrets to logs or output.

## Workflow Expectations

- Do not skip understanding existing code before editing it.
- Do not ignore errors; surface them with a concise explanation.
- Do not leave temporary files or debug artifacts in the repo.
- Do not leave failing tests unmentioned.

## Documentation Expectations (lightweight)

- If you change user-facing commands, env vars, ports, or workflows, update `README.md` in the same change.
- Prefer documenting “how to run it” via Make targets.

## Architectural Governance (Required)

This repository follows a strict documentation hierarchy:

PRD.md  
→ TechnicalStrategy.md  
→ Architecture.md  
→ prd-feature-\*.md  
→ App READMEs  
→ Root README.md

Rules:

- PRD and TechnicalStrategy documents are architectural sources of truth.
- Feature work must not redefine system architecture.
- Data model or contract changes require updating TechnicalStrategy.md first.
- Root README must remain high-level and must not accumulate operational detail.
- Profiles must not embed Playwright selectors or automation logic.
- UI mapping output (JSON/YAML) is derived and must not be manually edited.

If uncertain whether a change affects architecture, assume it does and surface it explicitly.

## Communication

- Do not be vague about changes; list key files modified.
- Do not omit limitations or assumptions.

## Makefile-first workflow (required)

- Prefer `make <target>` over direct `npm` commands when a Make target exists.
- Only use `npm -w <workspace> run <script>` if there is no Make target for the action.
- Keep Make targets as the canonical developer interface for:
  - install/bootstrap
  - build
  - test
  - dev/start for each app
  - clean/reset
- When adding a new script, add a Make target for it (or update an existing one).
