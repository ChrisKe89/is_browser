# TODO
## Project: is_browser
## Branch: feature/printer-discovery-ui-and-db-only-settings
## Updated: 2026-02-10

### [ ] TSK-001 — [DB-Only Settings] Use database values as the only apply runtime source
- scope:
  - Update apply execution so setting values are read from database-backed profiles only and runtime behavior no longer depends on settings JSON files.
- accepts:
  - Apply runs complete without requiring any settings JSON input.
  - Applied setting values come from database-backed profile records across repeated runs.
  - The apply entrypoint still starts runs with existing operator-visible behavior.
- notes:

### [ ] TSK-002 — [DB-Only Settings] Add developer control to enable or disable individual settings
- scope:
  - Provide a developer-facing control path to mark settings enabled or disabled and to reverse that state on demand.
- accepts:
  - A developer can set an individual setting to disabled and later set it back to enabled.
  - Disabled state is persisted and available to apply logic before setting execution.
- notes:

### [ ] TSK-003 — [DB-Only Settings] Skip disabled settings without failing runs
- scope:
  - Evaluate setting enable/disable state before apply attempts and skip disabled settings as non-failures.
- accepts:
  - Disabled settings are not applied during a run.
  - Disabled settings do not change run outcome to failed by themselves.
  - Runs continue applying other eligible settings after disabled settings are skipped.
- notes:

### [ ] TSK-004 — [DB-Only Settings] Skip enabled settings with missing values without failing runs
- scope:
  - Ensure enabled settings with no stored value are skipped automatically while preserving profile identity selection by `accountNumber` and `variation`.
- accepts:
  - Enabled settings with missing stored values are skipped.
  - Missing values do not change run outcome to failed by themselves.
  - Settings lookup continues to use `accountNumber` + `variation` identity behavior.
- notes:

### [ ] TSK-005 — [Printer Discovery UI] Support subnet input and reachable-device discovery
- scope:
  - Implement operator input for one or more subnet ranges and run discovery that returns only reachable devices from configured ranges.
- accepts:
  - Operators can enter and update subnet range values used for scanning.
  - Discovery results include only devices that pass reachability checks.
  - Discovery results are shown in the UI after a scan is run.
- notes:

### [ ] TSK-006 — [Printer Discovery UI] Support manual IPv4 add into the unified device list
- scope:
  - Add manual device entry with IPv4 validation and reachability verification before adding the device to the same list used by auto-discovery.
- accepts:
  - Invalid IPv4 input is rejected by the interface.
  - Manual IPs are accepted only after reachability verification succeeds.
  - Manually added devices appear in the same device list as auto-detected devices.
- notes:

### [ ] TSK-007 — [Printer Discovery UI] Verify and display per-device WebUI reachability state
- scope:
  - Evaluate WebUI reachability for each detected or manually added device and expose readiness state in UI and status outputs.
- accepts:
  - Each device row shows a WebUI reachability result.
  - Devices that fail WebUI reachability are clearly marked as not ready.
  - WebUI reachability outcomes are available for logging and status output.
- notes:

### [ ] TSK-008 — [Printer Discovery UI] Persist network discovery inputs across app restarts
- scope:
  - Save configured network input values and restore them automatically on startup while allowing later edits.
- accepts:
  - Network input values remain available after closing and reopening the app.
  - Saved network values load automatically on next startup.
  - Operators can update persisted values through the interface.
- notes:

### [ ] TSK-009 — [Printer Discovery UI] Retrieve device identity from SNMP and normalize serial values
- scope:
  - Use global SNMP settings to read model and serial-related identity data and normalize serial values using PRD rules.
- accepts:
  - Identity retrieval uses configured global SNMP settings.
  - Combined product-code/serial identity values normalize serial to the last 6 characters.
  - Normalized serial values shorter than 6 characters are left-padded with `0` to length 6.
- notes:

### [ ] TSK-010 — [Printer Discovery UI] Add account search and variation selection workflow
- scope:
  - Provide account-number-first selection and variation choices filtered to the selected account, including required selection when multiple valid variations exist.
- accepts:
  - Account selection supports searching by account number.
  - Variation choices are limited to options for the selected account.
  - Variation selection is required when more than one valid variation exists.
- notes:

### [ ] TSK-011 — [Printer Discovery UI] Auto-resolve known model+serial devices to account and variation
- scope:
  - Resolve known model+serial combinations via database lookup and enforce model-to-variation matching before marking devices as resolved.
- accepts:
  - Known model+serial combinations auto-resolve to account and variation.
  - Resolved variations satisfy variation-model matching requirements.
  - Auto-resolved account and variation are visible in device context before execution.
- notes:

### [ ] TSK-012 — [Printer Discovery UI] Add explicit intervention flow for unmatched devices
- scope:
  - Flag unmatched devices for intervention, allow manual account and variation selection, and record intervention history.
- accepts:
  - Unmatched devices are marked as requiring user intervention.
  - Operators can manually choose account and variation to proceed.
  - Intervention events appear in logs and status history.
- notes:

### [ ] TSK-013 — [Printer Discovery UI] Keep an always-visible run status label synchronized with automation state
- scope:
  - Display persistent run status with required states and keep transitions aligned with automation lifecycle.
- accepts:
  - A status label remains visible during operation.
  - Status values include `WORKING`, `COMPLETED`, `FAILED`, and `USER INTERVENTION REQUIRED`.
  - Status transitions match automation state transitions.
- notes:

### [ ] TSK-014 — [Printer Discovery UI] Write per-device step-level JSON logs to customer/account paths
- scope:
  - Emit step-level success and failure outcomes to per-device JSON files using the required path and naming structure.
- accepts:
  - JSON logs are written to `.\devices\logs\customers\{customer} - {account}\{serial}_{model}.json`.
  - JSON output includes step-level success and failure outcomes for each device run.
- notes:

### [ ] TSK-015 — [Printer Discovery UI] Write operational CSV logs in all-time or daily mode with required columns
- scope:
  - Produce CSV outputs in both supported modes and include the required operational reporting fields.
- accepts:
  - CSV logging supports all-time mode and daily mode.
  - CSV rows include `date, device, product_code, serial, customer_name, account, script_applied, script_location, status`.
  - CSV output is generated for device runs in the selected mode.
- notes:
