# Product Requirements Document
## Title: Three-Product Architecture for Printer UI Automation
## Project: is_browser
## Status: Active
## Author: Chris
## Date: 2026-02-11

---

## 1. Problem Statement

The project currently combines three fundamentally different concerns in a single codebase:

1. Crawling and mapping a printer Web UI
2. Authoring and storing configuration profiles (form + database)
3. Applying those configurations back to a device (UX + automation)

This coupling causes:
- unclear ownership of code
- confusing folder semantics (e.g. “artifacts”)
- accidental dependencies between components
- difficulty running or testing components independently

This PRD defines a **clear architectural separation** so each concern can operate as a **standalone product**, with explicit contracts between them.

---

## 2. Goals (What Success Looks Like)

- Each major capability can run **independently** of the others
- Boundaries are enforced by structure, not convention
- Shared data flows only through explicit, versioned contracts
- A new contributor can immediately answer:
  - “Where does crawling live?”
  - “Where do settings get authored?”
  - “Where does apply logic run?”

---

## 3. Non-Goals

- Rewriting Playwright logic from scratch
- Changing printer-specific behavior
- Introducing distributed systems or remote services unnecessarily
- Splitting into multiple git repositories (monorepo is retained)

---

## 4. Products (Hard Boundaries)

### 4.1 Product A — Crawler

**Purpose**  
Discover and map the printer Web UI into a canonical, machine-readable schema.

**Responsibilities**
- Authenticate to printer UI
- Traverse pages, dialogs, modals
- Capture:
  - navigation graph
  - setting definitions
  - selectors
  - option sets
- Emit a **UI Map artifact**

**Outputs**
- `ui-map.json` (versioned, schema-validated)

**Must NOT**
- Know about databases
- Know about profiles or values
- Apply settings to devices

---

### 4.2 Product B — Settings Authoring (Form + DB)

**Purpose**  
Allow humans to author, store, and manage configuration profiles based on a known UI schema.

**Responsibilities**
- Load a UI Map as the schema source
- Generate forms dynamically from that schema
- Store profile values in a database
- Validate values against schema

**Inputs**
- UI Map artifact

**Outputs**
- Stored profiles (values only)

**Must NOT**
- Crawl devices
- Contain Playwright or apply logic
- Depend on the apply UX being present

---

### 4.3 Product C — Apply UX / Runner

**Purpose**  
Apply a stored profile to a physical device in a controlled, observable way.

**Responsibilities**
- Load UI Map (schema + selectors)
- Load profile values (from DB, API, or file)
- Generate an apply plan
- Execute plan using Playwright
- Log results

**Inputs**
- UI Map artifact
- Profile values

**Outputs**
- Apply run logs / results

**Must NOT**
- Generate or mutate schema
- Depend on the form UI being available
- Accept inline JSON settings as the primary source of truth

---

## 5. Shared Contract (The Only Allowed Coupling)

All products may depend on a shared **contract package** that defines:

### 5.1 UI Map Schema
- Pages
- Settings
- Stable setting keys
- Selectors
- Option sets
- Navigation relationships
- Schema version

### 5.2 Profile Schema
- Account identifier
- Variation identifier
- Map of `settingKey → value`

### 5.3 Apply Run Schema
- Run metadata
- Per-setting outcome (applied / skipped / failed)
- Errors and timestamps

No product may bypass or redefine these schemas.

---

## 6. Structural Requirements

- Repository uses a **monorepo layout**
- Top-level separation must make ownership obvious
- Imports must obey directionality:
  - products → shared packages
  - shared packages MUST NOT import product code

---

## 7. Runtime Independence Requirements

Each product must be runnable with only its direct inputs:

| Product | Requires | Must Not Require |
|------|--------|----------------|
| Crawler | Printer + browser | DB, form UI, apply UX |
| Form + DB | UI Map | crawler, apply UX |
| Apply UX | UI Map + profile | form UI |

---

## 8. Validation & Safety

- Schema version mismatches must fail fast with clear errors
- Disabled or missing settings must be logged as **skipped**, not failed
- Apply ordering must be deterministic and observable

---

## 9. Documentation Requirement

The repository must contain:
- One-page architecture overview
- Clear explanation of:
  - what a UI Map is
  - what a Profile is
  - what an Apply Run is
  - where each concern lives

---

## 10. Acceptance Criteria (High Level)

- All three products can be started independently
- No circular imports between products
- Folder names reflect intent, not history
- Contracts are explicit, versioned, and enforced
