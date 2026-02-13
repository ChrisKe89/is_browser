# Architecture – is_browser

This document describes the structural architecture of is_browser and how its components interact.

It implements the strategy defined in:

- PRD
- Technical Strategy Document

---

## 1. Logical Architecture Layers

The platform is structured into five logical layers:

1. UI Mapping Layer (is_mapper)
2. Knowledge Graph Model
3. Configuration Storage Layer
4. Application Engine (is_application)
5. Operator Interface

These layers must remain strictly separated.

---

## 2. UI Mapping Layer – is_mapper

Responsibility:

- Crawl printer WebUI.
- Build canonical knowledge graph.
- Capture navigation paths, groups, fields, constraints.
- Generate JSON map.
- Generate YAML derived views.

Outputs:

- Versioned UI Map (JSON)
- YAML navigation view
- YAML layout view

This layer defines system truth.

No downstream component may redefine UI structure.

---

## 3. Knowledge Graph Model

The knowledge graph is defined in `packages/contract`.

It includes:

- Nodes (pages, modals)
- Groups
- Fields
- Selectors
- Actions
- Edges (navigation relationships)

The graph:

- Is model-specific.
- Is firmware-aware.
- Must be deterministic.
- Must produce stable identifiers across repeated runs.

---

## 4. Configuration Storage Layer

Implemented via `packages/sqlite-store`.

Responsibilities:

- Store profiles by model + customer + variation.
- Persist apply run audits.
- Version profiles.
- Maintain separation from UI structure.

Profiles reference `fieldId` only.
They do not contain selectors or navigation logic.

---

## 5. Application Engine – is_application

Responsibilities:

- Load profile.
- Resolve target device via SNMP.
- Navigate using stored navPath.
- Apply changes using stored selectors.
- Respect modal save scopes.
- Produce structured logs.
- Persist run outcomes.

Application engine must:

- Verify landing node identity before applying.
- Only modify defined fields.
- Confirm final state.

It must not bypass the knowledge graph abstraction.

---

## 6. Form Product – is_form

Responsibilities:

- Load UI map schema from DB.
- Render configuration form grouped by UI structure.
- Validate values against UI constraints.
- Save profiles.

The form product:

- Does not define UI structure.
- Does not contain automation logic.

---

## 7. Shared Packages

#### packages/contract

Canonical schemas:

- UI Map
- Profile
- Apply Run

#### packages/sqlite-store

Persistence layer.

#### packages/browser

Playwright helpers.

#### packages/env

Environment loading.

---

## 8. Runtime Independence

Each product may run independently:

- is_mapper requires printer + browser.
- is_form requires UI map + DB.
- is_application requires UI map + profile DB + printer.

No product may depend on runtime state of another.

---

## 9. Data Flow Overview

1. Mapper produces UI Map.
2. UI Map imported into DB.
3. Form product uses DB schema to create profiles.
4. Operator resolves device identity.
5. Application engine loads profile.
6. Engine uses UI Map to navigate and apply.
7. Run audit stored.

---

## 10. Governance Alignment

Architecture must remain aligned with:

- Deterministic identity requirements
- Separation of concerns
- Documentation hierarchy

Any change affecting data contracts requires Technical Strategy update first.

---
