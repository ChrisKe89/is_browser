# Documentation Governance

## is_browser – Deterministic Printer Configuration Platform

---

## 1. Purpose

This document defines how documentation is structured, how authority flows between documents, and how changes must be made.

The goal is to:

* Preserve architectural clarity
* Prevent documentation drift
* Maintain separation between strategy and implementation
* Ensure long-term system stability

This governance applies to both human contributors and AI agents (including Codex).

---

## 2. Documentation Hierarchy

Documentation follows a strict hierarchy.
Higher layers define intent. Lower layers define execution.

```
PRD.md
    ↓
TechnicalStrategy.md
    ↓
Architecture.md
    ↓
prd-feature-*.md
    ↓
App READMEs
    ↓
Root README.md
```

Lower layers must not override higher layers.

---

## 3. Document Roles & Authority

### 3.1 PRD (Product Requirements Document)

Defines:

* System identity
* Strategic objectives
* Success criteria
* Non-goals
* High-level scope boundaries

The PRD answers:

> What is this system and why does it exist?

The PRD:

* Must remain strategic.
* Must not contain implementation tasks.
* Must not contain CLI instructions or operational detail.

The PRD may only change when:

* System identity shifts.
* Strategic scope expands or contracts.
* Core objectives change.

---

### 3.2 Technical Strategy Document (TSD)

Defines:

* Architectural invariants
* Data model contracts
* Deterministic identity requirements
* Layer boundaries
* Replay and mapping principles
* Stability guarantees

The TSD answers:

> How must the system be architected to preserve its identity?

The TSD:

* Is authoritative for structural rules.
* Cannot contradict the PRD.
* Must be updated before feature work that alters data contracts.

---

### 3.3 Architecture.md

Describes:

* System components
* Data flow
* Package responsibilities
* Deployment structure

The Architecture document:

* Must align with PRD and TSD.
* Describes implementation shape, not strategic direction.

---

### 3.4 prd-feature-*.md

Defines:

* Feature scope
* Acceptance criteria
* Implementation boundaries
* Validation requirements

Feature documents:

* Must not redefine architecture.
* Must not modify core data model contracts unless TSD is updated first.
* May reference PRD and TSD but may not override them.

---

### 3.5 App-Level README.md

Defines:

* App purpose
* Runtime commands
* Local development instructions
* Environment variables
* App-specific architecture notes

App READMEs:

* Must not redefine system architecture.
* Must not introduce strategic product decisions.
* Must not duplicate PRD content.

---

### 3.6 Root README.md

Defines:

* High-level system overview
* Monorepo structure
* Minimal development quick start
* Links to authoritative documents

The root README:

* Must remain general and stable.
* Must not accumulate CLI flags or deep operational instructions.
* Must not become the canonical source of truth for architecture.

---

## 4. Change Control Rules

### 4.1 Architectural Integrity

No document below the TSD may:

* Alter deterministic ID requirements.
* Merge UI knowledge and configuration logic.
* Embed Playwright selectors in profiles.
* Bypass the knowledge graph abstraction.
* Introduce automation logic into storage models.

If a feature requires altering any of the above:

* The TSD must be updated first.
* The PRD must be reviewed if strategic scope shifts.

---

### 4.2 Derived Artifacts

The following are derived artifacts:

* YAML exports
* Generated form schemas
* JSON map outputs
* Screenshots

Derived artifacts:

* Are not canonical sources of truth.
* Must not be manually edited.
* Must be regenerated from the knowledge graph.

---

### 4.3 Separation of Concerns Enforcement

The following separations are mandatory:

UI Knowledge Graph
≠ Customer Profiles
≠ Automation Logic
≠ Documentation Exports

Any feature that blurs these boundaries must be rejected or escalated to TSD update.

---

## 5. Stability Requirements

The system must preserve:

1. Stable node and field identifiers across repeated mapping runs on identical firmware.
2. Deterministic navigation replay.
3. Clear separation between model knowledge and customer configuration.
4. Versioned and auditable profile storage.

Documentation changes must not weaken these guarantees.

---

## 6. AI Agent Governance (Codex & Automation)

AI agents operating in this repository must adhere to the following:

1. PRD and Technical Strategy documents are architectural sources of truth.
2. Feature work must not rewrite strategic documents unless explicitly instructed.
3. Root README must remain high-level.
4. Feature specs may expand implementation detail but must not redefine architecture.
5. Schema changes require explicit acknowledgement in Technical Strategy.

If uncertain whether a change affects architecture:

* Assume it does.
* Escalate via Technical Strategy update before proceeding.

---

## 7. Evolution Model

The documentation system evolves in the following order:

1. Strategic shift → Update PRD.
2. Architectural contract change → Update Technical Strategy.
3. Component structure change → Update Architecture.md.
4. New capability → Add prd-feature-*.md.
5. Runtime behavior change → Update relevant app README.

Reverse flow (feature redefining PRD) is not permitted.

---

## 8. Enforcement Philosophy

Governance exists to:

* Preserve clarity.
* Prevent silent architectural drift.
* Maintain long-term maintainability.
* Support safe AI-assisted development.

It is not intended to slow feature development.
It is intended to prevent compounding structural mistakes.

---

## 9. Ownership

The repository owner retains authority over:

* PRD direction
* Architectural invariants
* Governance model

AI agents may propose changes but must not autonomously redefine system identity.

---

## End of Governance Document

---