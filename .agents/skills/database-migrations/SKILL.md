---
name: database-migrations
description: Safely evolve LingxiLoop PostgreSQL schema and migration lifecycle. Use for product tables, constraints, policies, indexes, or server/src/db/migrations.
---

# Database migrations

Inspect existing migrations and affected queries first. `0001_v1_baseline.sql` is immutable.

- Add exactly one next-numbered, transactional, forward-compatible migration. Prove constraints against existing rows and avoid unbounded locks.
- Preserve ownership, authorization, foreign keys, timestamps, and ledger invariants. Runtime may check readiness but never runs DDL.
- Add affected behavior-level integration coverage; run `server:typecheck`, `db:migrate`, a second no-op migration, and the owning integration tests.
- A legacy non-empty database is rebuilt by operations; application code never adopts it.
