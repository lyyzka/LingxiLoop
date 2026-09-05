---
name: agent-runtime
description: Change LingxiLoop Agent OS leasing, kernels, Host Bridge effects, messages, or LLM ledgers. Use for server/src/agent-os and Agent runtime contracts.
---

# Agent runtime

Trace claim → model turn → `ipython` → Host Bridge → ledger → final message before editing.

- `ipython` is the only model-visible tool. Host Bridge effects repeat server-side authorization for the acting user, company, project, and run.
- Preserve leases, bounded retries, idempotency, stale-owner rejection, WuKongIM as durable messages, and kernel/home isolation.
- LLM paths use the shared client and ledger without prompt secrets.
- Add deterministic affected integration coverage; update Agent Eval only when user-visible decisions or traces change. Run `server:typecheck`, owning tests, and then `eval:runtime` only when applicable.
