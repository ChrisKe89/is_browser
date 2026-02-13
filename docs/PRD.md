# Product Requirement Document: is_browser – Deterministic Printer Configuration Platform

---

## 1. Executive Summary

is_browser is a deterministic printer configuration platform that transforms embedded WebUI interactions into a structured, replayable knowledge system.

The platform:

1. Maps printer WebUIs into a stable, model-aware knowledge graph.
2. Converts mapped UI structures into human-readable configuration forms.
3. Stores customer- and model-specific configuration profiles.
4. Applies those profiles deterministically to physical devices.
5. Provides transparent, auditable execution with human-readable progress output.

This initiative replaces manual, tribal, click-driven configuration with a repeatable, versioned, and observable system.

---

## 2. Strategic Objectives

### 2.1 Structural Determinism

The system must generate stable identifiers for UI nodes and settings across repeated mapping runs on the same firmware.

### 2.2 Model-Aware Configuration

Profiles must be tied to:

- Device model
- Optional firmware variation
- Customer account
- Profile variation

No configuration may assume cross-model compatibility without explicit validation.

### 2.3 Separation of Concerns

The system architecture must maintain strict separation between:

- UI Knowledge (what exists on the device)
- Customer Configuration (what should be applied)
- Automation Execution (how it is applied)
- Documentation (how it is presented)

### 2.4 Human Transparency

Every automated run must:

- Provide step-level progress visibility
- Produce structured logs
- Be auditable after completion

---

## 3. System Architecture Overview

### 3.1 UI Mapping Layer (is_mapper)

Purpose:
Create a canonical representation of the printer UI that is:

- Navigable (button path sequence)
- Structured (layout groups and sections)
- Semantic (control types, constraints, options)
- Versioned
- Stable across repeated runs

Outputs:

- Canonical JSON knowledge graph
- Auto-generated YAML representations (navigation + layout views)

This layer defines system truth.

---

### 3.2 Configuration Representation Layer

Purpose:
Generate structured configuration profiles derived from the mapped UI.

Characteristics:

- Mimics device labels and grouping
- Preserves option sets and defaults
- Allows customer-specific overrides
- Supports multiple variations per customer
- Versioned and diffable

Profiles must not embed automation logic.

---

### 3.3 Configuration Storage Layer

Purpose:
Store profiles keyed by:

- Model
- Optional firmware version
- Customer account
- Variation identifier

Must support:

- Retrieval by model + serial
- Comparison between profiles
- Controlled version evolution

---

### 3.4 Application Engine (is_application)

Purpose:
Apply configuration profiles deterministically using the stored UI knowledge graph.

Must:

- Navigate using mapped paths
- Use stable selectors
- Verify state transitions
- Respect modal save scopes
- Avoid destructive actions unless specified
- Provide real-time progress output

Automation must be deterministic and observable.

---

### 3.5 Operator UX Layer

Purpose:
Provide a controlled interface for applying configurations.

Flow:

1. Detect device via network.
2. Query SNMP for model + serial.
3. Resolve matching configuration profile.
4. If one match → apply.
5. If multiple matches → prompt selection.
6. Display real-time terminal-style progress.

This layer does not define configuration — it orchestrates application.

---

## 4. Functional Boundaries

### In Scope

- UI mapping via Playwright
- Knowledge graph generation
- YAML documentation generation
- Profile storage per model/customer
- SNMP-based model detection
- Deterministic configuration replay
- Structured logging and audit reporting

### Out of Scope (Current Phase)

- Multi-vendor abstraction
- Cloud-hosted SaaS model
- Non-WebUI configuration channels
- Full UI visual replication

---

## 5. Success Criteria

The system is successful when:

1. Repeated UI mappings produce stable identifiers.
2. YAML exports reflect on-screen navigation and layout.
3. Profiles can be selected automatically via model + serial.
4. Configuration application completes successfully on ≥95% of devices.
5. All runs produce structured logs and device audit records.
6. Firmware updates produce controlled structural diffs rather than system failure.

---

## 6. Risks & Mitigation

### Firmware Structural Drift

Mitigation: Fingerprint-based node and field stability.

### UI Selector Fragility

Mitigation: Role-first, label-based selector hierarchy.

### Hidden Setting Dependencies

Mitigation: Variant exploration and dependency capture.

### Multi-Modal Save Scope Errors

Mitigation: Explicit modal modeling in knowledge graph.

---

## 7. Governance & Evolution

This PRD defines strategic direction and architectural principles.

Implementation details belong in:

- `prd-feature-*.md` files
- Technical design documents
- Task tracking artifacts

The PRD may evolve when:

- Architectural boundaries shift
- Model abstraction requirements expand
- Platform identity changes

It must not devolve into a task checklist.

---

# Key Difference From Original PRD

The earlier PRD was operational and feature-driven.

This executive version:

- Defines system identity.
- Establishes architectural invariants.
- Sets structural success criteria.
- Separates vision from implementation.

---
