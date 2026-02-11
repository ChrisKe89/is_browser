# TODO
## Project: is_browser
## Branch: feature/mapper-ui-graph-yaml-export
## Updated: 2026-02-11

### [x] TSK-001 — Establish canonical UI graph map output
- scope:
  - Define and emit a single canonical map format with node, edge, group, field, action, and run metadata records that can be reused by all downstream views.
- accepts:
  - Captured output includes graph-level metadata and explicit node/edge collections.
  - Node records include identity, container kind, title/context, and grouped content sections.
- notes:
  - Done 2026-02-12: canonical `nodes[]`/`edges[]` emission added and preserved alongside legacy `pages[]`/`fields[]`.

### [x] TSK-002 — Capture node-level context for visible container only
- scope:
  - Capture page/modal/drawer/iframe context using the active visible container, including title, breadcrumb context, URL/frame context, nav path, and node actions.
- accepts:
  - When a modal is visible, fields behind it are not included in that node capture.
  - Breadcrumb and action metadata are present on nodes when discoverable.
- notes:
  - Done 2026-02-12: modal-scope capture preserved; node context includes url/title/navPath, inferred breadcrumbs, and actions.

### [x] TSK-003 — Preserve ordered layout groups on each node
- scope:
  - Discover and persist section/group structure in display order and assign each discovered field to the correct group.
- accepts:
  - Grouped output retains section titles and stable ordering for each node.
  - Fields in generated layout view appear under their intended section/group.
- notes:
  - Done 2026-02-12: group discovery emits `groupKey/groupTitle/groupOrder`; node groups preserve deterministic order.

### [x] TSK-004 — Capture field values, types, and option sets
- scope:
  - Capture current value, value type, options, constraints, and visibility/readability metadata for each field where discoverable.
- accepts:
  - Field entries include value metadata and option metadata for enum-like controls.
  - Number/text/boolean/enum controls are represented with consistent value typing.
- notes:
  - Done 2026-02-12: field metadata includes `valueType`, `defaultValue`, `currentValue`, visibility/read-only metadata, constraints, and normalized options.

### [x] TSK-005 — Model radio controls as grouped enum fields
- scope:
  - Represent radio controls as a single grouped field with options and selected value instead of per-radio field duplication.
- accepts:
  - One logical field is emitted per radio group.
  - Each radio group includes group identity, option list, and selected current value.
- notes:
  - Done 2026-02-12: radio controls emitted as grouped enum-like entries with `groupKey` and options.

### [x] TSK-006 — Preserve baseline defaults separately from current state
- scope:
  - Maintain first-seen field value as baseline default and preserve it across subsequent scans/variant exploration while still updating current values.
- accepts:
  - Default value remains unchanged after later interactions in the same capture run.
  - Current value reflects latest observed state independently of baseline.
- notes:
  - Done 2026-02-12: first-seen defaults are retained; current values are refreshed on re-discovery.

### [x] TSK-007 — Build navigation graph edges from interaction outcomes
- scope:
  - Record graph edges linking nodes for navigation, modal open/close, and tab switches, including trigger context and human-readable nav steps.
- accepts:
  - Captured nodes are connected by edge records with trigger details.
  - Edge typing distinguishes navigation from modal and tab transitions.
- notes:
  - Done 2026-02-12: edges now derive from click logs/nav paths with edge typing and trigger metadata.

### [x] TSK-008 — Enforce safe variant exploration with restoration
- scope:
  - Support dependency-revealing variant exploration for eligible controls while preventing destructive actions and restoring original UI state after each exploration pass.
- accepts:
  - Exploration excludes destructive actions such as save/apply/reset/reboot/submit.
  - Control state is restored to pre-exploration values after variant scanning.
- notes:
  - Done 2026-02-12: variant exploration remains limited to select/radio controls and restores prior state after scan.

### [x] TSK-009 — Infer and persist field visibility dependencies
- scope:
  - Infer reveals/hides dependencies by diffing field visibility before and after controlled variant changes and attach dependency rules to controlling fields.
- accepts:
  - Dependency metadata is present when field visibility changes are observed.
  - Dependency records identify controlling field condition and affected fields.
- notes:
  - Done 2026-02-12: before/after visibility diffs during variant scans now attach dependency metadata on controlling fields.

### [x] TSK-010 — Generate navigation and layout YAML views from canonical map
- scope:
  - Produce two YAML outputs from canonical capture data: navigation tree view and on-screen layout view, with stable references back to canonical node/field identities.
- accepts:
  - Navigation YAML includes path, breadcrumb/container context, groups, fields, and actions.
  - Layout YAML preserves group hierarchy/order and links entries back to canonical IDs.
- notes:
  - Done 2026-02-12: YAML view generation added (`ui-tree.navigation.yaml`, `ui-tree.layout.yaml`) via mapper outputs + export tool.

### [x] TSK-011 — Capture per-node visual snapshots for traceability
- scope:
  - Capture and persist one visual snapshot per node with trace metadata for downstream documentation and auditability.
- accepts:
  - Node records reference snapshot metadata when capture is available.
  - Snapshot artifacts are organized by run and resolvable from output metadata.
- notes:
  - Done 2026-02-12: per-node snapshot references are attached when captures are available.

### [x] TSK-012 — Enforce PRD non-goal boundaries and compatibility expectations
- scope:
  - Ensure delivery remains within PRD scope by excluding end-user editing products, analytics dashboards, and forced downstream replacement while preserving compatibility expectations.
- accepts:
  - No end-user editor capability is introduced in this scope.
  - Output changes preserve backward-compatibility posture unless an explicit migration path is defined.
- notes:
  - Done 2026-02-12: implementation stayed within mapper/contract/export scope and preserved backward-compatible `pages[]`/`fields[]`.
