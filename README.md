# Internet Services Utility – Deterministic Printer Configuration Platform

is_browser is a model-aware platform that maps printer WebUIs into a canonical knowledge graph, generates structured configuration profiles, and deterministically applies those profiles back to devices.

It replaces manual click-driven configuration with:

- Stable UI mapping
- Versioned configuration storage
- Deterministic Playwright replay
- SNMP-based device detection
- Human-readable YAML documentation
- Structured run auditing

---

## System Overview

The platform consists of three products:

### is_mapper

Maps printer WebUIs into a canonical, versioned knowledge graph.

### is_form

Authoring interface for model- and customer-specific configuration profiles.

### is_application

Operator UX and deterministic apply engine.

Shared packages provide:

- Data contracts (`packages/contract`)
- SQLite persistence (`packages/sqlite-store`)
- Browser and environment helpers

---

## Authoritative Documentation

- [Product Requirements Document](docs/PRD.md)
- [Technical Strategy Document](`docs/TechnicalStrategyDocument.md)
- [Architecture](docs/Architecture.md)
- [Documentation Governance](docs/Governance.md)

Feature work is defined in `prd-feature-*.md`.

---

## Monorepo Layout

```
apps/
  is_mapper/
  is_form/
  is_application/
packages/
  contract/
  sqlite-store/
  browser/
  env/
docs/
```

---

## Quick Start (Development)

```bash
make install
cp .env.example .env
make db-migrate
make dev-all
```

Default URLs:

- Operator UI: [http://localhost:5050](http://localhost:5050)
- Form UI: [http://localhost:5051](http://localhost:5051)

For detailed product usage, see each app’s README.

---

## Mapper Contract Artifacts

Run a crawl and generate the deterministic contract outputs:

```bash
make is-mapper-map
make is-mapper-contract MAP_PATH=state/printer-ui-map.json DIST_DIR=dist
```

Key outputs:

- `dist/ui_schema.json`
- `dist/ui_form.yaml`
- `dist/verify_report.json`

Validation and replay scripts:

```bash
python scripts/stability_check.py --run-crawl
python scripts/apply_settings.py --schema dist/ui_schema.json --values values.json --report dist/apply_report.json
```

---
