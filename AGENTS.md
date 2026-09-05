# LingxiLoop repository rules

These rules specialize the global development instructions for this repository. Apply only the sections relevant to the files or systems the task touches. A more specific `AGENTS.md` lower in the tree may further specialize them. When `AGENTS.md` instructions conflict, follow the narrower applicable rule while preserving security, authorization, credential, destructive-action, and external-side-effect boundaries.

LingxiLoop is a stable Web product. Preserve the current architecture unless the user explicitly requests an architectural change.

## Task scope and authorization

- For explanation, review, or diagnosis requests, inspect and report; do not also change source, configuration, external services, or production unless the user asks for that change.
- For implementation, fix, or build requests with a clear scope, complete the authorized work and proportionate validation instead of stopping after a plan. Use safe repository conventions to resolve minor ambiguity.
- Ask only when missing information would materially change the result or the next step would exceed the authorized scope. Do not infer permission to deploy, publish, send messages, expose credentials, or delete important data from permission to edit repository files.

## Supported surface

- The browser Web app is the only supported release surface.
- Electron is local-development compatibility only. Unless the user explicitly changes the supported release surface, do not add desktop publishing, auto-update, download entry points, CI runners, packaging tests, or desktop-specific product tests.
- Pass `--publish never` to every local Electron packaging command.

## Architecture

- When changing process entry points, keep Web/API and background workers separate; Web processes do not start scheduled or queue workers.
- For Agent OS runtime or integrations, keep it independently deployable. Its only model-visible tool is `ipython`; product effects cross the authenticated Host Bridge.
- Preserve data ownership: PostgreSQL owns product state, WuKongIM owns durable IM messages, Redis carries ephemeral coordination, and vendored Open Notebook/SurrealDB owns its independent knowledge schema.
- When adding or changing LLM calls, use the shared server client and ledger, and preserve lease, retry, idempotency, message, and audit contracts.
- At server trust boundaries, enforce tenant and project authorization server-side. Do not trust client identifiers, expose secrets, log tokens, or weaken signed callback/webhook verification.
- For Web UI changes, preserve keyboard operation, visible focus, semantic labels, reduced-motion behavior, and readable contrast.

## PostgreSQL evolution

These rules apply when changing the PostgreSQL schema or migration lifecycle:

- `server/src/db/migrations/0001_v1_baseline.sql` is immutable. Represent each new schema change with one new, strictly increasing, descriptively named SQL migration.
- Do not edit, rename, reorder, or delete an applied migration. Prefer forward-compatible expand/backfill/contract changes; each migration must be safe in its own transaction.
- Runtime processes may check migration readiness but must not execute DDL. Deployment runs `npm run db:migrate` before Web/Worker startup.
- A non-empty database without `schema_migrations` is unsupported and must be rebuilt as an empty database by operations. Application code must not auto-adopt or auto-delete it.
- Open Notebook/SurrealDB uses its separate vendored schema lifecycle.

## Verification

Use the global proportional-validation rule. The commands below define the owning surface and available checks, not a mandatory checklist. Run the smallest relevant command or test that directly covers the change; broaden within that surface when risk, failures, cross-package impact, or an explicit user request justifies it. Do not run all-surface or workspace-wide checks.

- Web: choose from `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
- Admin/Control: use only the matching `admin:*` or `control:*` command.
- Server: choose from `npm run server:lint`, `npm run server:typecheck`, `npm run server:test`, and the owning integration file.
- Agent Eval: run only `eval:harness` or `eval:runtime` for the changed suite.
- Vendored Open Notebook: run commands from its directory for only the affected backend or frontend.

PostgreSQL migration changes require the migration integration case and affected domain cases. Agent runtime changes require the relevant deterministic Eval suite and owning integration cases.

For repository tests and verification, do not use browser automation or Playwright, and do not add Playwright dependencies, configuration, snapshots, or test artifacts.

## Production work

- Use the `operate-openship-production` Skill only when a task matches its production-operation scope; its procedures and references do not apply to unrelated work.
- Repository edits, including deployment configuration, neither change live production nor authorize deployment. Keep live mutations within the user's explicit scope and update only production references whose facts changed.
- When OpenShip access is needed, use authentication supplied by the configured MCP transport. Never read, print, or copy its PAT into repository files or Skills; use a harmless MCP health call only when access validation is required.
