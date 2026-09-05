---
name: runtime
description: Create, connect, or debug an assistant-ui runtime and its thread, message, composer, or attachment state.
---

# assistant-ui Runtime

Inspect the installed version and relevant `references/` file before editing.

- Select the existing runtime integration before introducing another state or transport layer.
- Keep mutations in supported runtime APIs; derive UI state from selectors rather than duplicate event-driven state.
- Guard optional scopes and preserve cancellation, errors, attachments, and message ordering.
