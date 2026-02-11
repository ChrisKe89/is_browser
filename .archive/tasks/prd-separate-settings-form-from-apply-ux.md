# PRD: Separate Settings Form From Apply UX

## 1. Overview
This feature separates the settings form experience from the settings-application UX into fully independent products.
The problem today is coupling between configuration authoring and operational execution, which increases change risk and slows delivery.
This matters because internal admins and operators have different goals, and the products should evolve without impacting each other.

## 2. Goals
- Establish full product-level independence between settings form and apply UX.
- Ensure each product can change without creating regressions in the other.
- Keep a single shared settings data model as the only cross-product dependency.
- Improve operational reliability by preventing cross-surface change impact.

## 3. User Stories

### US-001: Admin Manages Settings Independently

Description:
As an internal admin, I want to author and update settings in a dedicated form product so that I can manage configuration without affecting operator workflows.

Acceptance Criteria:
- Admins can complete settings authoring in a dedicated interface scoped to configuration work.
- Changes to the form product do not alter operator-facing apply UX behavior by default.
- Admin workflows remain available even when apply UX changes are released.

### US-002: Operator Applies Settings Independently

Description:
As an operator, I want a dedicated apply UX focused only on execution so that I can run operations without exposure to admin configuration complexity.

Acceptance Criteria:
- Operators can execute apply workflows without navigating admin form functionality.
- Apply UX behavior remains stable when form product updates are released.
- Operator workflows use shared settings data model outputs without requiring form UI context.

### US-003: Independent Product Change Management

Description:
As a product owner, I want each surface to have independent lifecycle and release control so that teams can ship changes safely and quickly.

Acceptance Criteria:
- Form and apply UX can be versioned and released independently.
- A release in one product does not require synchronized release in the other.
- Cross-product compatibility is validated against the shared data model.

## 4. Functional Requirements
- FR-1: The system must provide a dedicated settings form product for internal admin users.
- FR-2: The system must provide a dedicated apply UX product for operator users.
- FR-3: The settings form product must not expose apply execution workflows.
- FR-4: The apply UX product must not expose admin configuration authoring workflows.
- FR-5: The two products must operate with independent change lifecycles.
- FR-6: The only shared dependency between products must be the settings data model contract.
- FR-7: Changes in either product must not alter the other product's behavior unless the shared data model contract changes.
- FR-8: The system must provide clear ownership boundaries for form product code and apply UX code.
- FR-9: The system must preserve existing apply capability for operators during and after separation.
- FR-10: The system must maintain compatibility expectations for data produced by the form and consumed by apply UX.

## 5. Non-Goals (Out of Scope)
- Redesigning the core settings schema itself.
- Changing operator business rules for apply execution.
- Introducing new operator roles or permissions model in this feature.
- Reworking unrelated discovery, logging, or device-resolution capabilities.

## 6. Design Considerations
- Admin and operator experiences should reflect their distinct responsibilities.
- Product boundaries should be obvious from navigation and terminology.
- User-facing behavior should prioritize continuity for operators.

## 7. Technical Considerations
- Separation must preserve a stable shared settings data contract.
- Product boundaries must support independent release and rollback practices.
- Compatibility management is required when shared data model changes are proposed.

## 8. Success Metrics
- Zero incidents where a form-product release causes unintended apply UX regression.
- Demonstrated independent release cadence for each product.
- Reduction in cross-team coordination required for routine changes.
- Reduction in operator-impacting issues tied to admin-surface updates.

## 9. Open Questions
- What governance process will control shared data model changes across products?
- Are there current mixed-role users who need temporary dual access?
- What deprecation timeline is required for any legacy combined workflows?
- What compatibility window is required when data model versions evolve?
