# is_mapper

Playwright crawler for printer WebUI capture.

## Commands

- Crawl and write `state/printer-ui-map.json`: `npm run is_mapper:map`
- Generate deterministic contract artifacts from an existing map: `npm run is_mapper:contract -- state/printer-ui-map.json dist`
- Verify dropdown capture quality: `npm run verify:dropdowns -- state/printer-ui-map.json`

## Contract Outputs

- `dist/ui_schema.json` (canonical capture contract)
- `dist/ui_form.yaml` (grouped human-readable view)
- `dist/verify_report.json` (validation summary)

### FieldRecord Schema (ui_schema.json)

Each setting record is emitted as `fieldRecords[]` (also mirrored under `settings[]` for compatibility) with:

- `field_id` deterministic ID derived from breadcrumb/path + container title + group title + canonical control identifier + frame/modal context.
- `page`, `breadcrumb`, `container`, `group`, `control`, `context`, `value`, `options`, and `constraints`.
- `value.value_quality=\"unknown\"` plus `value.value_quality_reason` when dropdown/radio options cannot be fully enumerated.

Deterministic IDs are stable across reruns for the same UI structure and are intended to be DB-safe keys for authoring and apply workflows.

## Replay + Stability Scripts

- Replay values by `settingKey`: `python scripts/apply_settings.py --schema dist/ui_schema.json --values values.json --report dist/apply_report.json`
- Determinism drift check: `python scripts/stability_check.py --run-crawl`
