# UAT Scenarios

## Environment Setup
- Printer is on the local subnet.
- WebUI is reachable at `https://<device-ip>/`.
- `.env` has valid `PRINTER_USER` and `PRINTER_PASS`.
- Operator server is running: `npm run server`.

## Scenario 1: Device Discovery
1. Open the operator UI.
2. Trigger discovery.
3. Verify detected devices show IPs and status.

**Expected**
- At least one reachable device is listed.
- Unreachable devices are marked as such.

## Scenario 2: Manual IP Entry
1. Enter a valid IP not found in discovery.
2. Submit.

**Expected**
- Device appears in list if reachable.
- Errors are shown for invalid IPs.

## Scenario 3: Profile Form Save
1. Open the form UI.
2. Enter account number and variation.
3. Fill required fields and save.

**Expected**
- Profile values are saved in `config_profile` and `config_profile_value`.
- Per-setting enabled flags are persisted.
- Form remains open after save.

## Scenario 4: Apply Settings from Profile
1. Start apply using `POST /api/start/profile` with `ip`, `accountNumber`, and `variation`.

**Expected**
- Playwright applies settings without manual intervention.
- Status changes to WORKING then COMPLETED.

## Scenario 5: Disable Settings On Demand
1. Load an existing profile in `form.html`.
2. Disable one or more settings (or use Disable All), then save profile.
3. Start profile apply.

**Expected**
- Disabled settings are skipped.
- Enabled settings are still applied.

## Scenario 6: Remote Panel (NVM)
1. Start profile apply where remote panel actions are configured.
2. Run automation.

**Expected**
- Remote panel opens and coordinate actions are replayed.
- Result is logged in device log JSON.

## Scenario 7: Retry on Failure
1. Disconnect network mid-run.
2. Observe retry prompts.

**Expected**
- Job pauses with USER INTERVENTION REQUIRED.
- Retry continues on reconnection.

## Scenario 8: Logging and Reports
1. Complete a run.

**Expected**
- Log JSON written to `devices/logs/...`.
- Device CSV updated in all-time or daily mode.
