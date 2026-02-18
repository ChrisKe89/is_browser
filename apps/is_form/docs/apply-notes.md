# Apply Notes (Deterministic + Modal Safe)

- Use `field_id` as the only profile key when loading/saving values.
- `field_id` is deterministic: `page_path::context::dom_selector`.
- Never use ephemeral crawler node IDs at apply time.
- For modal actions (`context` starts with `modal:`), locate the modal container first, then chain locators inside that container.
- For repeated controls like `Save`/`Cancel`, avoid global queries. Scope to modal and then `getByRole(...)`.
- Use locator chaining/filtering with stable dependencies (`locators.dependency`, `locators.dom_selector`) to reduce ambiguous matches.
