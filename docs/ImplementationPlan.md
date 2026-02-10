# Implementation Plan

## Overview
This document complements the PRD and details the concrete work breakdown.

## Milestones
1. **Schema + Form**
   - Define `config/settings-schema.json`.
   - Serve static HTML/JS form to generate settings JSON.
   - Save JSON to `customer_settings/{customer} - {account}/settings.json`.

2. **Discovery + Orchestration**
   - Implement ARP + ping sweep.
   - Query SNMP (v1/v2c, community `public`) for model and serial when reachable.
   - Split combined product code + serial strings so serial is last 6 chars (left-padded with `0`).
   - Add manual IP entry.
   - Provide operator API and UI endpoints.

3. **Automation + Logging**
   - Apply settings via Playwright.
   - Add structured device logs and CSV report.
   - Implement retry/pause/resume.
   - Add auth-state capture and reuse for login-gated pages.

4. **Remote Panel**
   - Define coordinate profile format.
   - Replay profiles against remote panel window.

5. **Docs + UAT**
   - Complete user and dev docs.
   - Validate UAT scenarios.

6. **Crawler Enhancements**
   - Support hash routes (e.g., `#hashHome`).
   - Map modal dialogs by clicking known triggers and scoping field discovery to the modal root.
   - Add configurable click-flow navigation (`config/crawler-flows.json`) for deep settings paths.

## Deliverables
- `tasks/prd-printer-webui-automation.md`
- `docs/UAT.md`
- `config/settings-schema.json`
- `config/remote-panel-profiles.json`
