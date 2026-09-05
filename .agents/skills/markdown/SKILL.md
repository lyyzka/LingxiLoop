---
name: markdown
description: Implement or debug markdown rendering in an assistant-ui message surface.
---

# assistant-ui Markdown

Inspect the installed assistant-ui version and the relevant `references/` file before editing.

- Render markdown only in the text-part branch; preserve non-text parts.
- Add syntax highlighting, math, or Mermaid only when requested and already supported by the installed dependencies.
- Do not render incomplete streamed diagrams. Keep generated HTML and links safely handled by the renderer's existing policy.
