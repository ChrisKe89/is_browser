# PRD Draft: Crawl Quality and Graph Correctness

## 1. Overview
This feature improves crawler output quality so navigation graphs and field dependencies accurately represent the printer UI state.  
It addresses false transitions, noisy interaction logs, and incorrect field-diff behavior that currently produce invalid graph relationships.  
This matters because downstream map consumers depend on these artifacts for reliable profile authoring and automated apply behavior.

## 2. Goals
- Ensure navigation and dependency graphs only contain UI-meaningful transitions.
- Eliminate false “revealed field” signals from non-reveal interactions.
- Improve crawl determinism and reduce interaction noise in generated artifacts.
- Preserve backward compatibility through additive schema changes.
- Deliver in two phases: correctness first, then quality/readability improvements.

## 3. User Stories

### US-001: Exclude System Alerts from Graph Semantics
Description:  
As an `is_mapper` maintainer, I want system-level alert dismissals separated from UI navigation actions so that graph edges and dependencies stay valid.

Acceptance Criteria:
- System alert interactions are recorded for diagnostics but excluded from navigation path and breadcrumb semantics.
- System alert interactions do not create node transitions or dependency edges.
- System alert interactions do not contribute to field reveal/discovery diffs.

### US-002: Prevent False Field Reveal Events on Cancel/Close
Description:  
As an `is_mapper` maintainer, I want cancel/close actions treated as restoration events so that dependency signals are not corrupted.

Acceptance Criteria:
- Cancel/close interactions do not generate positive “new field” reveal events.
- Modal close behavior may represent reduction of visible scope, but not reveal expansion.
- Field reveal semantics remain aligned with genuine context-expanding actions.

### US-003: Enforce Scope-Accurate Field Discovery
Description:  
As an `is_mapper` maintainer, I want field discovery and diffs constrained to active UI scope so that hidden/background content does not pollute results.

Acceptance Criteria:
- Field discovery is evaluated within the currently active UI scope only.
- Before/after field comparisons use matching scope contexts.
- Out-of-scope fields are excluded from reveal/discovery conclusions.

### US-004: Normalize Equivalent Interaction Sequences
Description:  
As an `is_mapper` maintainer, I want equivalent user intent represented as one logical action so that logs and graph output are readable and stable.

Acceptance Criteria:
- Duplicate multi-step interactions representing one intent are collapsed into a single logical action entry.
- Redundant wrapper-level click noise is not represented as independent navigation semantics.
- Interaction kind classification coverage improves and `unknown` usage is minimized.

### US-005: Improve Transition Semantics and Action Discoverability
Description:  
As an `is_mapper` maintainer, I want transition and action records to reflect intent categories so downstream systems can reason about state changes.

Acceptance Criteria:
- Transition records distinguish key interaction classes (e.g., navigation, modal transitions, alert dismissal, section expansion).
- Active-context actions (including modal actions) are consistently represented in node-level action metadata.
- Click-log records contain enough context to reconstruct transitions deterministically, including hash-routing scenarios.

## 4. Functional Requirements
1. FR-1: The system must classify system-level alert interactions separately from standard UI interactions.
2. FR-2: The system must prevent system-level alert interactions from affecting graph navigation, dependency, and breadcrumb outputs.
3. FR-3: The system must only compute positive field reveal outcomes for explicitly scope-expanding transition classes.
4. FR-4: The system must treat cancel/close as state restoration transitions and prevent false positive reveal output.
5. FR-5: The system must discover fields and compute diffs within the currently active UI scope.
6. FR-6: The system must normalize duplicate interaction sequences that represent a single logical user intent.
7. FR-7: The system must reduce and constrain `unknown` interaction classification to unresolved edge cases only.
8. FR-8: The system must represent modal-context actions consistently in node action metadata.
9. FR-9: The system must use typed transition categories for graph edges.
10. FR-10: The system must capture stable node identity context in click logs before and after interactions.
11. FR-11: Any schema evolution for interaction/field-diff metadata must be additive and maintain backward compatibility.

## 5. Non-Goals (Out of Scope)
- Redesigning the overall crawler architecture.
- Replacing canonical map formats or changing system-of-record ownership.
- Introducing non-additive contract changes in this effort.
- Solving unrelated field type inference quality issues outside this interaction/graph correctness scope.
- Full P2 completion in phase one.

## 6. Design Considerations
- Prioritize human-readable navigation artifacts.
- Keep diagnostic data available while isolating it from semantic graph outputs.
- Favor intent-level interaction representation over raw click verbosity.

## 7. Technical Considerations
- Rollout is two-phase: Phase 1 targets correctness (P0), Phase 2 targets stability/readability enhancements (P1).
- Backward compatibility is additive-only for map/log schema evolution.
- Changes must preserve deterministic behavior expectations for repeated crawls on identical firmware.

## 8. Success Metrics
- Zero system-alert-derived transitions in navigation graph outputs.
- Zero false positive field reveal events from cancel/close interactions.
- Significant reduction in `unknown` interaction classifications.
- Reduced average navPath length for equivalent crawl coverage.
- Stable edge reconstruction from click logs in hash-based navigation cases.

## 9. Open Questions
- Should P2 schema clarity improvements (visibility/discovery/removal distinction) be included in phase two or deferred to a separate PRD?
- What threshold defines acceptable residual `unknown` classification rate?
- Should breadcrumb derivation from explicit UI breadcrumb components be mandatory where available, or best-effort?
