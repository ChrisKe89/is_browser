# is_form

Profile authoring UI and API for deterministic printer configuration values.

See root guidance in `../../AGENTS.md` and product overview in `../../README.md`.

## Schema Extractor

Generate normalized extracted schema artifacts from deterministic settings capture, manual capture fallback, and UI tree YAML hints.

```bash
make schema
```

Outputs:

- `apps/is_form/schema/extracted-schema.json`
- `apps/is_form/schema/extracted-schema.yaml`

CLI override examples:

```bash
npm -w apps/is_form run schema:extract -- --deterministic permissions/20260214-011630/settings-deterministic-manual-live.json --capture permissions/20260214-011630/settings-capture-manual-live.json --navigation permissions/20260214-011630/ui-tree.navigation.yaml --layout permissions/20260214-011630/ui-tree.layout.yaml
```

Behavior:

- deterministic input is preferred for role/name selectors and normalized values
- capture input is used as fallback for IDs/raw values/options
- radio controls are grouped into `radio_group`
- buttons are emitted as container `actions`
- outputs are stable ordered for deterministic byte-identical JSON on same inputs
