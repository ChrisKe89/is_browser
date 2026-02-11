## PRD: Mapper UI Graph + YAML Export

### 1. Overview
The mapper should evolve from flat field capture into a structured UI graph that reflects real navigation, containers, groups, actions, and values. The output must support two machine-readable YAML views: a navigation-oriented tree and a layout-oriented tree that preserves on-screen section structure (for example, "Advanced Settings / Input Settings / Password Policy").

This matters because current outputs are difficult to use for repeatable automation, reliable documentation, and change tracking across captures.

### 2. Goals
- Generate a single structured UI map that captures screens, modals, groups, fields, actions, and navigation relationships.
- Preserve first-seen defaults while also capturing current values per field.
- Represent radio controls as grouped enum-like fields instead of per-option field noise.
- Produce YAML outputs that are readable and stable for internal developer workflows.
- Ensure deduplication is stable across repeated captures of the same UI.
- Keep layout-view generation required in first release, with best-effort fidelity.

### 3. User Stories

### US-001: Structured UI Node Capture
Description:  
As an internal automation maintainer, I want each captured screen/modal represented as a structured node so that I can reason about UI state and traversal paths.

Acceptance Criteria:
- Captures include node identity, node kind, title, and location context.
- Node records include grouped fields and available actions.
- Captured nodes can be referenced consistently across output views.

### US-002: Stable Field Identity and Dedupe
Description:  
As an internal developer, I want stable field identity and deduplication so that repeated scans do not create duplicate or conflicting entries.

Acceptance Criteria:
- Equivalent controls map to the same stable identity across a run.
- Repeated visits do not duplicate already captured fields.
- Different controls with similar labels are not incorrectly merged.

### US-003: Value Baseline + Current State
Description:  
As an internal developer, I want both default and current values so that I can compare baseline state against observed runtime state.

Acceptance Criteria:
- Each captured field may include both default and current values when discoverable.
- Default values remain stable once initially captured.
- Current values reflect the latest observed state at capture time.

### US-004: Group-Accurate Layout View
Description:  
As an internal maintainer, I want a layout-oriented output that preserves section/group structure so that generated documentation mirrors the UI.

Acceptance Criteria:
- Output includes ordered groups/sections for each node.
- Fields are associated to their groups in a predictable order.
- Layout output is generated in first release with best-effort fidelity.

### US-005: Navigation-Oriented YAML View
Description:  
As an internal maintainer, I want a navigation-tree YAML view so that I can trace how to reach each settings container.

Acceptance Criteria:
- Output includes navigation path context for each node.
- Output distinguishes containers such as page vs modal.
- Navigation view references captured groups and fields for each reachable node.

### US-006: Safe Dependency Discovery
Description:  
As an internal maintainer, I want variant-driven dependency discovery so that revealed/hidden field behavior can be modeled without destructive UI side effects.

Acceptance Criteria:
- Capture can detect fields revealed or hidden by control value changes.
- Capture avoids destructive actions during exploration.
- Captured dependency information is attached to relevant controlling fields when inferred.

### 4. Functional Requirements
- FR-1: The system must produce a unified UI graph containing nodes and edges for captured UI states.
- FR-2: The system must capture grouped field structure within each node.
- FR-3: The system must capture field identity metadata sufficient for stable dedupe.
- FR-4: The system must capture default and current values when available.
- FR-5: The system must represent radio controls as grouped enum-like entries.
- FR-6: The system must capture action controls available in each node (for example save/cancel/apply/close categories).
- FR-7: The system must capture breadcrumb and path context when available.
- FR-8: The system must generate a navigation-oriented YAML view.
- FR-9: The system must generate a layout-oriented YAML view that preserves group ordering.
- FR-10: The system must include run-level artifacts linking generated outputs to capture metadata.
- FR-11: The system must avoid destructive interaction paths during variant exploration.
- FR-12: The system must preserve baseline defaults even after additional exploration steps.
- FR-13: The system must support manual and crawler capture paths under the same output model.

### 5. Non-Goals (Out of Scope)
- Building end-user UI editors for the generated YAML.
- Guaranteeing perfect dependency inference for all dynamic UI frameworks.
- Capturing every hidden state that requires privileged or destructive flows.
- Replacing downstream systems that already consume existing JSON unless explicitly migrated.
- Building analytics dashboards on top of captured graph data in this release.

### 6. Design Considerations (Optional)
- Output should remain readable for internal developers and automation maintainers.
- Layout and navigation YAML views should remain traceable back to canonical graph records.
- Best-effort grouping is acceptable where page semantics are inconsistent, but grouping should remain deterministic when possible.

### 7. Technical Considerations (Optional)
- Data model expansion should remain backward-compatible where feasible.
- Field and node identity strategy is critical for long-term stability across runs.
- Capture should accommodate frame/container context to reduce ambiguous selectors.
- Artifact structure should support troubleshooting and reproducibility.

### 8. Success Metrics
- At least 95% of repeated captures on unchanged UI produce stable node/field identities.
- Navigation YAML and layout YAML are generated successfully for target capture flows.
- Generated outputs preserve major section/group structure expected by maintainers.
- Duplicate-field noise is materially reduced versus current mapper output.
- Internal maintainers can use outputs to trace and review settings paths without manual reconstruction.

### 9. Open Questions
- What minimum accuracy threshold is acceptable for inferred field dependencies?
- Should schema versioning increment immediately with model expansion or be staged?
- What policy should apply when breadcrumb and visible title conflict?
- How should partial-capture sessions be flagged in exported YAML for downstream users?
- What is the preferred long-term compatibility strategy for existing consumers of current map output?
