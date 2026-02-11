# AGENTS.md

## Purpose
This file gives lightweight guidance for working in this repository. Keep it minimal and flexible.

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
