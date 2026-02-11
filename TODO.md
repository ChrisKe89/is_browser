# TODO
## Project: is_browser
## Branch: feature/makefile-and-rename-apps
## Updated: 2026-02-11

# RULES FOR CODEX (DO NOT SKIP)
- Use `git mv` for renames/moves (preserve history).
- After renames: update imports, package names, workspace paths, Makefile targets, docs, READMEs, and any hard-coded paths.
- Do repo-wide search/replace carefully and verify builds/tests at the end.

---

## [~] TSK-001 — Rename app folders (git mv) (in progress, 2026-02-11)
Rename these workspace folders:

- `apps/crawler` → `apps/is_mapper`
- `apps/settings-authoring` → `apps/is_form`
- `apps/apply-runner` → `apps/is_application`

done-when:
- `apps/` contains only `is_mapper`, `is_form`, `is_application` (plus any other intentional apps)
- Blocker (2026-02-11): `apps/settings-authoring/` is empty but cannot be removed yet because the directory handle is locked by another local process.

---

## [x] TSK-002 — Update npm workspace config + scripts (root) (completed 2026-02-11)
Update root `package.json`:
- ensure `"private": true`
- ensure `"workspaces": ["apps/*", "packages/*"]` exists

Update any root scripts referencing old workspace names:
- `apps/crawler` → `apps/is_mapper`
- `apps/settings-authoring` → `apps/is_form`
- `apps/apply-runner` → `apps/is_application`

done-when:
- `npm -w apps/is_mapper run <script>` works
- `npm -w apps/is_form run <script>` works
- `npm -w apps/is_application run <script>` works

---

## [x] TSK-003 — Rename workspace script names to match new app names (completed 2026-02-11)
### is_mapper workspace scripts
In `apps/is_mapper/package.json`, ensure scripts exist:
- `"is_mapper:map": "<existing map command>"`
- `"dev": "<existing dev command or alias>"`

If you previously had `crawler:map`, rename it to `is_mapper:map`.

### is_form workspace scripts
In `apps/is_form/package.json`, ensure scripts exist:
- `"form:dev": "<existing form server start>"`
- `"db:migrate": "<existing migrate command>"`
- `"db:import-map": "<existing import ui map command>"`

If you previously had `form:dev` already, keep it.

### is_application workspace scripts
In `apps/is_application/package.json`, ensure scripts exist:
- `"apply:dev": "<existing operator/apply server start>"`
- `"apply:settings": "<existing apply CLI start>"`
- `"discovery:scan": "<existing discovery scan cli>"`

done-when:
- script names exist and run without referencing old app names

---

## [x] TSK-004 — Add Makefile-first workflow (root) (completed 2026-02-11)
Create a root `Makefile` with these targets (adjust commands ONLY if scripts differ):

```make
# Makefile
# Canonical commands for humans + agents.
# Assumes npm workspaces and package-lock.json.

SHELL := /bin/bash

.PHONY: help
help:
	@echo ""
	@echo "Targets:"
	@echo "  make install            Install all workspace deps"
	@echo "  make clean              Remove build artifacts"
	@echo "  make test               Run all tests"
	@echo "  make build              Build all workspaces"
	@echo "  make dev-all            Run is_form + is_application together"
	@echo "  make is-mapper-map      Run is_mapper UI map"
	@echo "  make is-mapper-dev      Run is_mapper dev mode (if exists)"
	@echo "  make form-dev           Start is_form server"
	@echo "  make apply-dev          Start is_application server"
	@echo "  make db-migrate         Run DB migrations (is_form)"
	@echo "  make db-import-map      Import UI map into DB (is_form)"
	@echo ""

.PHONY: install
install:
	npm install

.PHONY: clean
clean:
	@rm -rf dist state
	@rm -rf **/dist
	@rm -rf **/.cache
	@rm -rf **/.turbo
	@rm -rf **/playwright-report
	@rm -rf **/test-results
	@echo "Cleaned."

.PHONY: test
test:
	npm test

.PHONY: build
build:
	npm -w packages/contract run build
	npm -w packages/sqlite-store run build
	npm -w apps/is_mapper run build
	npm -w apps/is_form run build
	npm -w apps/is_application run build

# ---- is_mapper ----
.PHONY: is-mapper-map
is-mapper-map:
	npm -w apps/is_mapper run is_mapper:map

.PHONY: is-mapper-dev
is-mapper-dev:
	npm -w apps/is_mapper run dev

# ---- is_form (Settings Authoring) ----
.PHONY: form-dev
form-dev:
	npm -w apps/is_form run form:dev

.PHONY: db-migrate
db-migrate:
	npm -w apps/is_form run db:migrate

.PHONY: db-import-map
db-import-map:
	npm -w apps/is_form run db:import-map

# ---- is_application (Apply Runner / Operator) ----
.PHONY: apply-dev
apply-dev:
	npm -w apps/is_application run apply:dev

.PHONY: apply-settings
apply-settings:
	npm -w apps/is_application run apply:settings

.PHONY: discovery-scan
discovery-scan:
	npm -w apps/is_application run discovery:scan

# ---- Combined dev (is_form + is_application) ----
.PHONY: dev-all
dev-all:
	npm run dev:all
````

done-when:

* `make help` prints all targets

---

## [x] TSK-005 — Root `dev:all` orchestration (no app-to-app imports) (completed 2026-02-11)

In root `package.json`, add/update:

* `dev:all` to start is_form + is_application concurrently

Example:

* `"dev:all": "concurrently \"npm -w apps/is_form run form:dev\" \"npm -w apps/is_application run apply:dev\""`

Also ensure `concurrently` exists in root devDependencies.

done-when:

* `make dev-all` starts both servers
* no server file imports another app to boot it

---

## [x] TSK-006 — Update root + app AGENTS.md to enforce Makefile-first commands (completed 2026-02-11)

### Root `AGENTS.md`

Append this section:

```md
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
```

### App AGENTS.md

Update these files to prefer Make targets (create them if missing):

* `apps/is_mapper/AGENTS.md` → mention `make is-mapper-map`, `make is-mapper-dev`
* `apps/is_form/AGENTS.md` → mention `make form-dev`, `make db-migrate`, `make db-import-map`
* `apps/is_application/AGENTS.md` → mention `make apply-dev`, `make apply-settings`, `make discovery-scan`

done-when:

* all AGENTS.md files reference Make targets, not raw npm commands

---

## [x] TSK-007 — Repo-wide rename in docs/UI/log text (product names) (completed 2026-02-11)

Perform careful search/replace across `.md`, `.ts`, `.js`, `.json`, `.html`, configs:

Replace old app names → new:

* `apps/crawler` → `apps/is_mapper`
* `apps/settings-authoring` → `apps/is_form`
* `apps/apply-runner` → `apps/is_application`

Replace product wording (only where referring to the product name):

* `crawler` → `is_mapper`
* `settings-authoring` → `is_form`
* `apply-runner` / `apply` product name → `is_application`

Update any command examples:

* `npm -w apps/crawler ...` → `npm -w apps/is_mapper ...`
* `npm -w apps/settings-authoring ...` → `npm -w apps/is_form ...`
* `npm -w apps/apply-runner ...` → `npm -w apps/is_application ...`
* `make crawler-map` → `make is-mapper-map`

done-when:

* `rg "apps/crawler|apps/settings-authoring|apps/apply-runner"` returns 0 matches
* README examples use Make targets

---

## [~] TSK-008 — Verify end-to-end sanity after rename + Makefile (partially verified, 2026-02-11)

Run and fix until green:

* `make install`
* `make build`
* `make test`
* `make is-mapper-map`
* `make db-migrate`
* `make form-dev` (manual stop after boot)
* `make apply-dev` (manual stop after boot)
* `make dev-all` (manual stop after boot)

done-when:

* All commands run without referencing old app names
* No runtime errors from missing scripts/paths
* Verification notes (2026-02-11):
* `make install`, `make build`, `make test`, and `make db-migrate` pass.
* `make is-mapper-map` fails only on missing required env vars (`PRINTER_USER`, `PRINTER_PASS`).
* `make form-dev`, `make apply-dev`, and `make dev-all` fail with `EADDRINUSE` because local ports are already occupied by existing `node` listeners in this environment.

```
