---
name: agent-eval
description: Maintain LingxiLoop deterministic Agent Eval suites, baselines, and CI gates. Use for changes under eval or the Agent Eval runners.
---

# Agent Eval

Keep Eval deterministic, reviewable, and safe to upload.

- Use fixed fixtures, ordering, time, randomness, and providers. Score observable behavior and traces, not implementation details.
- Change baselines only for intentional behavior changes; keep reports synthetic, bounded, and secret-free.
- Run the changed gate (`npm run eval:harness` or `npm run eval:runtime`) plus directly affected tests. Runtime changes need only their affected PostgreSQL/Redis integration coverage.
