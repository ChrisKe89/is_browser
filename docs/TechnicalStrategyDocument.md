# Technical Strategy Document

## is_browser – Deterministic Printer Configuration Platform

---

## 1. Purpose of This Document

This document defines:

* Architectural structure
* Data contracts
* Stability guarantees
* Identity rules
* Execution principles
* Boundaries between layers

It does **not** define implementation tasks.
It defines how the system must behave and be structured.

---

## 2. System Architecture Overview

The platform is composed of five core layers:

1. **UI Mapping Layer (is_mapper)**
2. **Knowledge Graph Model**
3. **Configuration Storage Layer**
4. **Application Engine (is_application)**
5. **Operator Interface**

Each layer has strict responsibilities and must not bleed into others.

---

## 3. Architectural Principles

### 3.1 Canonical Knowledge Graph

The UI mapping layer produces a **canonical, versioned knowledge graph** representing:

* Navigation paths
* UI nodes (pages, modals)
* Groups/sections
* Fields (controls)
* Constraints
* Dependencies
* Actions (Save/Cancel/etc.)

This graph is:

* Deterministic
* Replayable
* Stable across identical firmware runs
* Model-specific

The knowledge graph is the source of truth for:

* YAML exports
* Form generation
* Replay automation

No downstream layer may invent UI structure.

---

### 3.2 Deterministic Identity

Every structural element must have a stable identity:

#### Nodes

* Based on URL path (normalized)
* Modal title
* Breadcrumb
* Structural hash

#### Fields

* Normalized label
* Control type
* Preferred selector
* Group title
* Node fingerprint

Canonical replay artifacts are generated as:

* `dist/ui_schema.json`
* `dist/ui_form.yaml`
* `dist/verify_report.json`

Identity rules for this contract:

* `containerKey = sha1(join(" > ", breadcrumb) + "|" + type + "|" + title + "|" + urlNormalized + "|" + frameUrl)`
* `settingKey = sha1(containerKey + "|" + groupTitle + "|" + label + "|" + type + "|" + domIdOrNameIfAny)`

Repeated mapping runs on unchanged firmware must produce identical IDs.

If IDs change, the mapping layer is considered unstable.

---

### 3.3 Strict Layer Separation

#### UI Knowledge ≠ Customer Configuration

The UI graph defines:

> What is possible.

Customer profiles define:

> What is desired.

Profiles must never embed selectors or navigation logic.

---

#### Storage ≠ Automation

Storage layer:

* Stores structured profile data.
* Contains no Playwright logic.

Application engine:

* Reads profile.
* Uses UI graph to execute.

---

#### Documentation ≠ Truth

YAML is:

* A derived representation.
* Human-readable.
* Auto-generated.

It is not the source of truth.

---

## 4. Data Model Strategy

### 4.1 Canonical Model Structure

The knowledge graph must include:

#### Node

* nodeId (stable)
* kind (page/modal/etc.)
* title
* url
* breadcrumb
* navPath (human labels + selectors)
* groups[]
* actions[]
* fingerprint

#### Group

* groupId
* title
* order
* fields[]

#### Field

* fieldId (stable)
* label
* labelQuality (explicit/derived/missing)
* controlType
* valueType
* options[]
* constraints (min/max/step/maxLength/pattern/inputMode/readOnly)
* hints[] / rangeHint
* defaultValue
* currentValue
* dependencies[]
* selectors[]

Field metadata additions must remain backward compatible (additive optional fields only).

---

### 4.2 Profile Model

Profiles must:

* Reference fieldId
* Store desiredValue
* Include metadata:

  * model
  * optional firmware
  * customer
  * variation
  * version

Profiles must not duplicate UI structure.

---

## 5. Mapping Strategy

### 5.1 Scope Resolution

Mapping must:

* Detect modal context
* Respect iframe boundaries
* Avoid capturing hidden background DOM
* Preserve group hierarchy as displayed

---

### 5.2 Variant Exploration

When exploring dropdowns/radios:

* Capture original value
* Explore variants
* Record newly revealed fields
* Restore original state

Dependencies must be stored as structural rules.

---

### 5.3 Save Scope Modeling

Mapping must:

* Distinguish page-level save
* Distinguish modal-level save
* Capture action semantics

Automation must rely on this modeling.

---

## 6. Replay Strategy

### 6.1 Deterministic Navigation

Application engine must:

* Navigate using stored navPath
* Prefer role + label selectors
* Verify landing node fingerprint before applying

---

### 6.2 Safe Application

Engine must:

* Confirm current value before changing
* Only modify fields defined in profile
* Avoid unintended Save actions
* Provide observable progress logs

---

### 6.3 State Verification

After application:

* Re-read field values
* Confirm match with desired profile
* Report discrepancies

---

## 7. Device Detection Strategy

Detection layer must:

1. Discover device (network or manual entry)
2. Query SNMP:

   * Model
   * Serial
3. Resolve matching profile
4. Pass control to application engine

Detection logic must not contain mapping logic.

---

## 8. Logging & Observability

Each run must generate:

* Step-level structured logs
* Final device report entry
* Status state transitions:

  * WORKING
  * COMPLETED
  * FAILED
  * USER_INTERVENTION_REQUIRED

Logs must be deterministic and traceable to profile version.

---

## 9. Versioning Strategy

### 9.1 Firmware Drift

When firmware changes:

* Run mapper
* Compare graph fingerprints
* Identify structural differences
* Determine compatibility

Profiles should declare compatible model + firmware scope.

---

### 9.2 Profile Versioning

Profiles must:

* Be versioned
* Support historical audit
* Allow diff comparison

---

## 10. Stability Requirements

The system is considered stable when:

* Mapping same firmware twice → identical graph IDs
* Applying same profile twice → no unintended changes
* YAML exports are consistent across runs
* Node/field fingerprinting is resilient to minor DOM order shifts

---

## 11. Non-Goals (Technical)

This strategy does not currently support:

* Visual DOM replication
* Vendor-agnostic device abstraction
* Fully dynamic UI inference outside mapped structure
* SNMP-only configuration application

---

## 12. Governance Rules

Codex and developers must not:

* Embed Playwright selectors inside profiles
* Bypass knowledge graph for application logic
* Modify YAML manually
* Hardcode navigation outside navPath
* Use unstable CSS-only selectors as primary identity

All feature documents must respect this strategy.

---

## 13. Extension Points (Future)

Potential evolution paths:

* Firmware drift visualizer
* Profile diff UI
* Dependency rule engine validation
* Multi-model abstraction layer
* Policy-based profile generation
* SNMP + WebUI hybrid apply

These must not compromise core invariants.

---

## Relationship to PRD

The PRD defines:

> What the system is and why.

This document defines:

> How it must be architected to preserve that identity.

Feature specs define:

> What to build next.

---
