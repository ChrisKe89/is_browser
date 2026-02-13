# TODO

## Project: is_mapper

## Branch: fix/crawl-quality-graph-correctness

## Updated: 2026-02-11

### [x] TSK-001 — Isolate system alert interactions from graph semantics (US-001, FR-1, FR-2)

- scope:
  - Classify system-level alerts as diagnostic-only interaction records so they never affect canonical navigation or dependency semantics.
- accepts:
  - Interactions identified as system alerts are present in click logs with alert classification.
  - System alert interactions do not update breadcrumbs, navPath steps, node transitions, or dependency edges.
  - System alert interactions do not contribute to field reveal/discovery diffs.
- notes:
  - Completed 2026-02-11

### [x] TSK-002 — Enforce scope-locked discovery and same-scope diffing (US-003, FR-5)

- scope:
  - Constrain field discovery and before/after diffing to the active UI scope root for deterministic modal vs page behavior.
- accepts:
  - When a modal is visible, field discovery and diffing run only inside the modal scope.
  - When no modal is visible, field discovery and diffing run only inside main-content scope.
  - Field diffs compare like-for-like scope context and exclude out-of-scope fields.
- notes:
  - Completed 2026-02-11

### [x] TSK-003 — Apply transition-aware reveal policy with restore-safe close/cancel behavior (US-002, FR-3, FR-4)

- scope:
  - Restrict positive reveal semantics to context-expanding transitions and treat cancel/close as state restoration.
- accepts:
  - Positive reveal outputs are emitted only for approved expanding transitions.
  - Cancel/close actions never emit positive newly visible/discovered field sets.
  - Close/restoration transitions may reduce visible scope without being represented as reveals.
- notes:
  - Completed 2026-02-11

### [x] TSK-004 — Normalize radio interactions into one logical action (US-004, FR-6)

- scope:
  - Collapse duplicate label-then-input radio interaction sequences into a single intent-level record.
- accepts:
  - A label-plus-input radio selection sequence is represented as one `radio_select` action.
  - The normalized action stores the selected option label and deterministic radio target reference.
  - Navigation artifacts show one radio action per user choice instead of duplicate steps.
- notes:
  - Completed 2026-02-11

### [x] TSK-005 — Improve click-kind classification and suppress wrapper-click noise (US-004, FR-7)

- scope:
  - Expand semantic click classification and suppress non-semantic wrapper clicks that immediately precede real control interactions.
- accepts:
  - Classifier covers radio option/input, dropdown trigger or combobox, tab, modal open, modal close, and system alert.
  - Wrapper/blob clicks followed by semantic control clicks in the same interaction area are excluded from navPath and breadcrumb semantics.
  - `unknown` classification is limited to unresolved edge cases.
- notes:
  - Completed 2026-02-11

### [x] TSK-006 — Add typed transitions and consistent modal action inventories (US-005, FR-8, FR-9)

- scope:
  - Represent interaction transitions with intent types and consistently expose modal action capabilities on active nodes.
- accepts:
  - Transition typing includes open modal, close modal, navigate, tab switch, dismiss alert, and expand section.
  - Active modal nodes consistently include normalized actions such as Save, Cancel, Close, Apply, and OK when present.
  - Alert dismissal remains diagnosable as a typed interaction without polluting canonical dependency relationships.
- notes:
  - Completed 2026-02-11

### [x] TSK-007 — Add node identity context to click logs with additive schema compatibility (US-005, FR-10, FR-11)

- scope:
  - Capture before/after node identity in click logs to support deterministic reconstruction under hash-routing and URL drift.
- accepts:
  - Each click-log entry includes `nodeIdBefore` and `nodeIdAfter`.
  - Existing click-log and map fields remain valid with additive-only schema evolution.
  - Node transitions are reconstructable from click logs even when URL-level change signals are ambiguous.
- notes:
  - Completed 2026-02-11
