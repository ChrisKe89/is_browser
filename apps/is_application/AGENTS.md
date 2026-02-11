# AGENTS.md

## Makefile-first workflow
- Prefer `make apply-dev` over direct npm commands.
- Use `make apply-settings` for apply CLI runs.
- Use `make discovery-scan` for discovery scans.
- Use `npm -w apps/is_application run <script>` only when no Make target exists.
