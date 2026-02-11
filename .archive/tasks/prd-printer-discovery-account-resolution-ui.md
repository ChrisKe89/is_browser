# Product Requirements Document

## 1. Overview
This feature delivers a frontend interface for discovering and preparing Fujifilm printers for automation workflows.  
It solves the current operational gap where device discovery, identity retrieval, account mapping, and run-status visibility are fragmented or manual.  
It matters because operators need a reliable, low-friction way to detect printers, resolve customer context, and produce auditable logs with minimal intervention.

## 2. Goals
- Provide a single operator UI to discover and manage Fujifilm printers on configured network ranges.
- Support both automatic discovery and manual IP entry in one unified device list.
- Enrich detected devices with model and serial data using global SNMP settings.
- Resolve customer account and variation automatically when model and serial are known.
- Enable manual intervention when automatic account resolution fails.
- Persist key user-entered settings (including IP/subnet inputs) across app restarts.
- Provide clear, always-visible run state and synchronized status transitions.
- Produce structured JSON and CSV logging for traceability and operations reporting.

## 3. User Stories

### US-001: Discover Devices on Configured Network
Description:  
As an operator, I want to scan configured subnet ranges so that reachable Fujifilm printers can be found quickly.

Acceptance Criteria:
- The interface allows entry and update of one or more subnet ranges for scanning.
- Running discovery returns reachable devices from those configured ranges.
- Only devices that pass reachability checks are shown as discovered devices.

### US-002: Add Device by Manual IP
Description:  
As an operator, I want to manually enter an IPv4 address so that I can add known devices even if auto-discovery misses them.

Acceptance Criteria:
- The interface validates that manual input is a valid IPv4 address.
- The system verifies reachability before accepting the device.
- Manually added devices appear in the same list as auto-detected devices.

### US-003: Verify Device WebUI Reachability
Description:  
As an operator, I want each detected device verified for WebUI reachability so that automation starts only on accessible devices.

Acceptance Criteria:
- Each detected or manually added device includes a WebUI reachability result.
- Devices failing WebUI reachability are clearly marked and not treated as ready.
- Reachability outcome is available in logs and status output.

### US-004: Persist Network Inputs Across Sessions
Description:  
As an operator, I want configured IP/subnet inputs remembered so that I do not re-enter them each time I reopen the app.

Acceptance Criteria:
- Configured network values persist when the app is closed and reopened.
- Saved values are loaded automatically on next startup.
- Operators can update saved values through the interface.

### US-005: Retrieve and Normalize Device Identity
Description:  
As an operator, I want model and serial data retrieved and normalized so that devices can be mapped to customer accounts.

Acceptance Criteria:
- The system uses global SNMP settings to retrieve model and serial-related identity data.
- If identity data arrives as combined product code and serial, serial is normalized as the last 6 characters.
- If normalized serial has fewer than 6 characters, it is left-padded with `0` to length 6.

### US-006: Select Account and Variation
Description:  
As an operator, I want to select a customer profile by account number and then choose a variation so that the correct profile is applied.

Acceptance Criteria:
- Account selection is available via search-first input by account number.
- Variation choices are filtered to the selected account.
- Variation selection is required when multiple valid variations exist.

### US-007: Auto-Resolve Known Devices
Description:  
As an operator, I want known model+serial combinations resolved automatically so that manual selection is reduced.

Acceptance Criteria:
- For known model+serial combinations, the system resolves customer account and variation via database lookup.
- Resolved variation must match model name requirements.
- Auto-resolved results are shown in device context before execution.

### US-008: Handle Unmatched Devices with User Intervention
Description:  
As an operator, I want explicit intervention flow when no database match exists so that I can continue processing safely.

Acceptance Criteria:
- Unmatched devices are flagged as requiring user intervention.
- The operator can manually choose account and variation to proceed.
- Intervention events are captured in logs and status history.

### US-009: Track Execution Status in Real Time
Description:  
As an operator, I want a persistent status label so that I always know whether the run is working, complete, failed, or waiting for me.

Acceptance Criteria:
- A status label is always visible during operation.
- Supported states include `WORKING`, `COMPLETED`, `FAILED`, and `USER INTERVENTION REQUIRED`.
- Status transitions are synchronized with automation state transitions.

### US-010: Produce Structured Operational Logs
Description:  
As an operator, I want per-device JSON and CSV logs so that runs are auditable and reportable.

Acceptance Criteria:
- Step-level success/failure logs are stored at `.\devices\logs\customers\{customer} - {account}\{serial}_{model}.json`.
- CSV logging supports all-time or daily output mode.
- CSV includes columns: `date, device, product_code, serial, customer_name, account, script_applied, script_location, status`.

## 4. Functional Requirements
- FR-1: The system must provide a frontend interface for printer discovery, selection, and status tracking.
- FR-2: The system must allow users to configure subnet range inputs used for discovery scans.
- FR-3: The system must discover reachable devices on configured subnet ranges.
- FR-4: The system must allow manual IPv4 entry and reject invalid IPv4 input.
- FR-5: The system must verify reachability for manually entered IPv4 addresses before adding devices.
- FR-6: The system must present auto-detected and manually added devices in one unified device list.
- FR-7: The system must verify WebUI reachability for each device candidate.
- FR-8: The system must persist user-configured network inputs across app restarts.
- FR-9: The system must use global SNMP settings to retrieve device model and serial-related data.
- FR-10: The system must normalize serial from combined product code/serial values using the last 6 characters.
- FR-11: The system must left-pad normalized serial values with `0` when length is under 6.
- FR-12: The system must allow user profile selection by account number from database-sourced records.
- FR-13: The system must allow variation selection from variations available to the selected account.
- FR-14: The system must auto-resolve customer account and variation for known model+serial combinations.
- FR-15: The system must enforce variation-model matching rules for resolved or selected variations.
- FR-16: The system must require explicit user intervention when no valid model+serial mapping is found.
- FR-17: The system must write step-level JSON logs with success/failure outcomes to the required customer/account path.
- FR-18: The system must write device CSV logs in either all-time or daily mode with required columns.
- FR-19: The system must display an always-visible status label with the required state set.
- FR-20: The system must keep status updates synchronized with automation state transitions.
- FR-21: The feature deliverable must meet project linting and type-checking quality gates.

## 5. Non-Goals (Out of Scope)
- Managing printer firmware updates or printer-side configuration changes.
- Supporting non-Fujifilm device families.
- Building new identity sources beyond configured SNMP and database records.
- Designing customer/account master-data management workflows.
- Defining backend implementation details for discovery internals, persistence technology, or automation framework internals.

## 6. Design Considerations (Optional)
- Prioritize an operations-focused layout that keeps discovery controls, device list, and status visible without deep navigation.
- Ensure intervention-required devices are visually distinct from ready devices.
- Make account-number search and variation selection quick for repetitive operator workflows.
- Keep state labels and device readiness cues readable at a glance.

## 7. Technical Considerations (Optional)
- Discovery, reachability, SNMP identity retrieval, and database lookup are integration boundaries and must return clear failure states.
- Identity normalization must be deterministic to prevent mapping ambiguity.
- Logging paths and naming must be stable to support downstream reporting and audits.
- Status state transitions must remain consistent with underlying automation execution states.

## 8. Success Metrics
- Device onboarding completion rate from discovery/manual add to ready state.
- Median time from device detection to script-ready status.
- Reduction in manual data entry and intervention frequency for known devices.
- Operational reliability measured by failed run rate and log completeness/consistency.

## 9. Open Questions
- What is the default CSV mode on first run: all-time or daily?
- What is the expected subnet input format for operators (single CIDR, multiple CIDRs, ranges)?
- What timeout/retry policy defines “reachable” for scan, manual IP validation, and WebUI checks?
- How should duplicate detections (same IP or same serial on different IPs) be handled in the device list?
- What model-name normalization rules are authoritative for variation-model matching?
