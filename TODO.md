# TODO
## Project: is_browser
## PRD: PRD-Three-Product-Architecture.md
## Branch: feature/three-product-separation
## Updated: 2026-02-11

---

### [ ] TSK-001 — Create explicit three-product folder structure
- relates-to: PRD §4, §6
- do:
  - Introduce top-level folders for:
    - crawler
    - settings-authoring (form + DB)
    - apply-runner
  - Introduce shared contract/package area
- done-when:
  - A new contributor can identify each product by folder name alone
  - No product code lives at repo root

---

### [ ] TSK-002 — Extract crawler into a standalone product
- relates-to: PRD §4.1, §7
- do:
  - Move crawler entrypoints and logic into crawler product
  - Remove DB and apply dependencies
- done-when:
  - Crawler runs end-to-end and emits a valid UI Map artifact
  - Crawler runs without DB or servers present

---

### [ ] TSK-003 — Define shared contract package
- relates-to: PRD §5
- do:
  - Create contract schemas for:
    - UI Map
    - Profile
    - Apply Run
  - Add versioning and validation
- done-when:
  - All products validate inputs/outputs against the contract
  - No schema duplication exists across products

---

### [ ] TSK-004 — Refactor settings form + DB into standalone authoring product
- relates-to: PRD §4.2, §7
- do:
  - Ensure form loads UI Map as schema input
  - Ensure DB stores values only (no selectors)
- done-when:
  - Form runs with only DB + UI Map present
  - Missing UI Map results in a clear error state

---

### [ ] TSK-005 — Refactor apply UX into standalone runner product
- relates-to: PRD §4.3, §7
- do:
  - Ensure apply reads:
    - UI Map for schema + selectors
    - profile values from DB / API / file
  - Remove legacy inline JSON settings paths
- done-when:
  - Apply can run without form UI
  - Apply fails fast on schema incompatibility

---

### [ ] TSK-006 — Enforce DB-only values at apply time
- relates-to: PRD §4.3, §8
- do:
  - Remove or hard-disable non-DB runtime value sources
- done-when:
  - All apply runs source values from profile data only

---

### [ ] TSK-007 — Rename ambiguous folders to intent-driven names
- relates-to: PRD §6, §9
- do:
  - Replace `artifacts/` with:
    - tools/recordings
    - tools/scripts
    - tools/samples
- done-when:
  - No references to `artifacts/` remain
  - tools folder has README explaining purpose

---

### [ ] TSK-008 — Add standalone smoke tests per product
- relates-to: PRD §7, §8
- do:
  - Add non-printer-dependent tests for:
    - crawler output validation
    - form + DB boot + save
    - apply plan generation (dry-run)
- done-when:
  - All tests pass without real hardware

---

### [ ] TSK-009 — Write architecture and data model docs
- relates-to: PRD §9
- do:
  - Add concise docs explaining:
    - system architecture
    - data contracts
    - developer workflow
- done-when:
  - New contributors can orient without tribal knowledge
