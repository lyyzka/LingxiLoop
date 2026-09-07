# LingxiLoop

LingxiLoop uses the published `lingxios@2.1.0` runtime. The Web process owns authenticated ingress and control operations; the Worker is the only process that claims LingxiOS work.

LingxiLoop is a Web learning-collaboration product with direct messages, Study Rooms, and Labs.

The browser Web app is the only supported release surface. Electron remains available only for local development; it is never published, auto-updated, offered for download, or tested in CI.

## Architecture

```text
Browser Web ──> LingxiLoop Web/API ──> PostgreSQL / Redis / WuKongIM / Open Notebook
                         │
LingxiLoop Worker ───────┘
```

- WuKongIM is the authoritative durable message store.
- PostgreSQL stores product state, audit, and the append-only LLM ledger.
- Redis carries ephemeral coordination.
- Vendored Open Notebook/SurrealDB owns its independent knowledge schema lifecycle.
- Web and Worker use the same server image but are independently scalable processes; Web never starts background jobs.

## Local development

Requirements: Node.js 22, PostgreSQL 16 with pgvector, and Redis 7.

```powershell
npm ci
Copy-Item .env.local.example .env.local
# Fill the required database, Redis, OpenAI, WuKongIM, identity, and R2 values.
npm run dev:migrate
npm run dev:preview
```

Open `http://localhost:5180`. For direct process development, run `npm run dev:all`. Electron can be run locally with `npm run electron:dev`; every package command is fixed to `--publish never`.

PostgreSQL starts from [`0001_v1_baseline.sql`](server/src/db/migrations/0001_v1_baseline.sql) and evolves only through new numbered migrations. `npm run db:migrate` takes an advisory lock and verifies names and checksums. The native runtime cutover is atomic: migration `0010_lingxios_native_runtime.sql` rejects any old runtime data, removes the retired schema, installs the exact package schema, and records its version and SHA-256 manifest. Application startup only checks migration and package readiness; Web and Worker never execute DDL.

For the packaged service topology:

```powershell
Copy-Item .env.example .env
# Fill required product and secret values; image tags are managed by CI.
npm run mvp:up
```

Compose runs the one-shot `db-migrate` service before Web and Worker.

## Verification

Run only the commands for the changed surface: Web uses the unprefixed lint/typecheck/test/build commands; Admin, Control, and Server use their matching prefixes; Agent Eval uses `eval:check`; integration accepts owning files through `--file`.

CI classifies changed paths, runs only their checks, and publishes only affected images to `ghcr.io/<repository-owner-lowercase>/` with immutable commit-SHA tags. CI does not install or run a browser.

Production deployment and migration requirements are in [`docs/RELEASE.md`](docs/RELEASE.md). The current domain model is in [`docs/DOMAIN_MODEL.md`](docs/DOMAIN_MODEL.md), and Agent Eval is documented in [`docs/agent-eval.md`](docs/agent-eval.md).

Licensed under [MIT](LICENSE).
