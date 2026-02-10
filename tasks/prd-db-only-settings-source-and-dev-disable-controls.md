# PRD: DB-Only Settings Source + Developer Disable Controls

## 1. Overview

The apply workflow should use the database as the single source of truth for settings values.
The current behavior that relies on settings JSON files should be removed from the runtime apply path.
Additionally, developers need a simple way to disable unneeded settings so those settings are not applied during runs.

This matters because it reduces configuration drift, avoids duplicate sources of truth, and gives maintainers direct control over noisy or irrelevant settings.

## 2. Goals

- Make database-backed profile values the only settings source used by apply runs.
- Keep the current apply entrypoint behavior stable from the user’s perspective.
- Allow developers to enable or disable specific settings on demand.
- Ensure disabled settings are skipped without blocking runs.
- Ensure enabled settings with no value are skipped without blocking runs.

## 3. User Stories

### US-001: Apply Uses Database as Single Source

Description:
As a technician/developer, I want apply runs to load settings only from the database so that there is one authoritative source for runtime values.

Acceptance Criteria:
- Apply runs execute using database-backed setting values.
- Runtime apply behavior does not depend on settings JSON files.
- The source of applied values is consistent across runs.

### US-002: Developer-Controlled Setting Enable/Disable

Description:
As a developer, I want to disable specific settings that are never needed so that apply runs ignore unnecessary fields.

Acceptance Criteria:
- A developer can mark a setting as enabled or disabled on demand.
- Disabled settings are excluded from apply behavior.
- Re-enabling a setting returns it to normal apply eligibility.

### US-003: Disabled Settings Are Non-Blocking

Description:
As a technician, I want disabled settings to be skipped so that runs continue without interruption.

Acceptance Criteria:
- Disabled settings do not stop the run.
- Disabled settings are not treated as failures.
- Run completion is not blocked by disabled settings.

### US-004: Missing Values Are Non-Blocking

Description:
As a technician, I want enabled settings without stored values to be skipped so that incomplete profiles do not halt execution.

Acceptance Criteria:
- Enabled settings with no value are skipped.
- Missing values are not treated as run-blocking failures.
- Remaining eligible settings continue to apply.

## 4. Functional Requirements

- FR-1: The system must use database-stored profile values as the only runtime source for apply settings.
- FR-2: The apply entrypoint must continue to exist and initiate apply runs without requiring a settings JSON input.
- FR-3: The system must provide a developer-facing mechanism to enable or disable individual settings on demand.
- FR-4: The enable/disable state must be evaluated before attempting to apply a setting.
- FR-5: Disabled settings must be skipped automatically.
- FR-6: Enabled settings that do not have a stored value must be skipped automatically.
- FR-7: Skipped settings must not convert a run into a failed state by themselves.
- FR-8: The system must preserve existing profile identity behavior (`accountNumber` + `variation`) for selecting setting values.

## 5. Non-Goals (Out of Scope)

- Building end-user UX flows beyond what is required for developer control of setting enable/disable.
- Changing printer-side behavior or setting semantics.
- Expanding profile model to support conditional logic per device state.
- Introducing additional runtime settings sources beyond the database.

## 6. Design Considerations

- The enable/disable control should be straightforward for developers to use and reverse.
- The workflow should clearly communicate that database values are authoritative.
- Operator-facing behavior should remain predictable and low-friction.

## 7. Technical Considerations

- Existing profile and apply data boundaries should be preserved where possible.
- Migration from JSON-driven apply to DB-only apply should avoid breaking active operational flows.
- Any backward-compatibility behavior should be explicit and temporary, if included.

## 8. Success Metrics

- 100% of apply runs source settings values from the database.
- 0 required runtime dependencies on settings JSON files for apply execution.
- Reduced apply attempts for irrelevant settings due to developer disable controls.
- No increase in failed runs attributable to disabled or missing-value settings.

## 9. Open Questions

- Should enable/disable control be global for all profiles or support profile-specific overrides in a future phase?
- Should skipped settings be fully silent in operator-visible output or only omitted from failure reporting?
- Should there be an explicit migration/notice period before removing JSON-based apply paths entirely?
