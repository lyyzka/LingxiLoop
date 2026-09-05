---
name: tools
description: Register or debug assistant-ui model tools and their rendered tool-call UI.
---

# assistant-ui Tools

Inspect the installed version and relevant `references/` file before implementation.

- Reuse the project's current tool pattern. For new assistant-ui tools, use the installed toolkit API when available.
- Keep schemas strict, tool descriptions task-specific, and server-side effects authorized and validated.
- Render running, complete, incomplete, and approval states. Never let client UI replace server authorization.
