---
name: primitives
description: Build or change an assistant-ui Thread, Composer, message, action bar, or branch picker from primitives.
---

# assistant-ui Primitives

Inspect the installed version and the relevant `references/` file before implementation.

- Keep the existing runtime and provider boundary; primitives are unstyled, so use the project's styling system.
- Handle all message part types the current UI already supports and keep tool/data rendering registered.
- Preserve keyboard behavior, focus, labels, responsive layout, and cancellation/error states.
