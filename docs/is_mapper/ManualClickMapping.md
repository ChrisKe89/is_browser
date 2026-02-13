# Manual Click Mapping

## Purpose

Use manual mapping mode when you want Playwright to record your click path and incrementally discover newly exposed settings without duplicating previously seen settings.

## Prerequisites

- `PRINTER_USER` and `PRINTER_PASS` are set in `.env`
- Dependencies installed: `make install`
- Printer URL reachable (or pass `--url`)

## Run

From repo root:

```bash
make is-mapper-manual
```

With custom location bucket and screenshots:

```bash
make is-mapper-manual LOCATION=permissions SCREENSHOT=true
```

Direct CLI (bypasses npm flag parsing):

```bash
npx tsx apps/is_mapper/src/index.ts --manual --location permissions --screenshot
```

PowerShell env-var form:

```powershell
$env:IS_MAPPER_LOCATION="permissions"
$env:IS_MAPPER_SCREENSHOT="true"
npm run -w apps/is_mapper is_mapper:manual
```

Other flags:

- `--url <http://host>`: override target URL for this run
- `--max-clicks <n>`: stop after `n` captured clicks
- `--timeout-ms <n>`: settle timeout after each click

## Behavior

- The mapper captures trusted user click events on interactive controls.
- After each click it re-scans the current visible scope and appends only new settings.
- Dedupe key uses a selector fingerprint (`selectorKey`) so equivalent controls are not duplicated.
- Settings revealed later on the same page are included when they first appear.
- Each field includes `defaultValue` (first-seen baseline) and `currentValue` (latest observed value).
- Radio controls are modeled as grouped enum fields with `groupKey` and `options[]`.

## Dropdown Option Capture

- Native `select` controls: all `option` values/text are captured.
- ARIA listbox/combobox options: visible `[role="option"]` values are captured only from associated list containers (no document-wide scraping).
- Re-discovered options merge into a stable unique enum list.
- Variant scanning restores original select/radio values after exploration so the UI is left in its baseline state.

## Output Layout

Default output root is `state/<YYYYMMDD-HHmmss>/`.

If `--location permissions` is provided, output root is `permissions/<YYYYMMDD-HHmmss>/`.

Artifacts:

- `printer-ui-map.clicks.json`: deduplicated UI map output
- `click-log.json`: click timeline with `newFieldIds` per click
- `ui-tree.navigation.yaml`: navigation-oriented YAML derived from canonical graph nodes/edges
- `ui-tree.layout.yaml`: layout-oriented YAML preserving section/group order
- `screenshots/click-0001.png` etc. when `--screenshot` is enabled

## Stopping

- Enter `q` and press Enter in the terminal
- Or use `Ctrl+C`
- Or set `--max-clicks`

## Known Limitations

- Some custom widgets expose options only after additional interaction states not represented as click events.
- Iframe content may require frame-specific interactions and might not always be attributed to the parent context.
- Highly dynamic components with unstable labels/selectors can still require manual review of output.
