# AGENTS.md

## Makefile-first workflow
- Prefer `make form-dev` over direct npm commands.
- Use `make db-migrate` and `make db-import-map` for DB/map workflows.
- Use `npm -w apps/is_form run <script>` only when no Make target exists.
