---
name: operate-arcane-production
description: Operate LingxiLoop production through Arcane GitOps, including deploy verification, environment recovery, and retiring legacy OpenShip resources.
---

# Operate Arcane Production

Use Arcane Manager and its paired Shanghai A/B agents as the deployment control plane. Prefer the Manager API and GitOps syncs; use the Arcane UI/Event Log to inspect live state. Do not deploy product Compose files with direct Docker commands.

## Topology

- Arcane Manager v2.10.2 owns the control plane; Shanghai A owns `lingxiloop-core-state` and `lingxiloop-app-a`.
- Shanghai B owns `server-b-ingress`, `landing`, `lingxiloop-knowledge-agent`, `lingxilit`, `lingxiloop-app-b`, and `uptime`.
- LingxiLoop GitOps Compose files live below `deploy/arcane/`; LingxiLit uses `deploy/arcane/compose.yml` so its large documentation tree is not synced.
- Public routes are `lingxilearn.cn`, `loop.lingxilearn.cn`, `openlit.lingxilearn.cn`, `uptime.lingxilearn.cn`, and `admin.lingxilearn.cn`.
- Production application releases use the four GitOps syncs `lingxiloop-core-state`, `lingxiloop-app-a`, `lingxiloop-app-b`, and `lingxiloop-knowledge-agent`.

## Invariants

- Preserve `/opt/apps/wegolibrary` and `/opt/apps/memos_jPcn` on the Manager host. They are outside the LingxiLoop cutover.
- OpenShip is retired. Do not recreate its containers, directories, networks, releases, webhooks, or compatibility adapters.
- Manager variables are the production configuration source; reconcile them with both agents' materialized variables. Sigillo retains only the `LingxiLoop Control Plane` production project for operator credentials, never application copies. Never print secrets, tokens, or decrypted values.
- Production LingxiOS needs non-zero model input or output prices. For `deepseek-ai/DeepSeek-V4-Flash`, use the approved Sigillo pricing data rather than a guessed rate.
- Use accelerated GitHub/GHCR routes already registered in Arcane; do not add proxy or Mihomo configuration.

## Release automation

- GitHub Actions publishes immutable images, pins the two application manifests, then invokes the four tokenized Arcane GitOps webhooks held only in the production secret `ARCANE_GIT_SYNC_WEBHOOK_URLS`. Each webhook targets `gitops` with the `sync` action.
- A successful GitHub rollout without that secret does not update live workloads. Create or rotate webhooks through the Manager API, store their one-time URLs immediately with `gh secret set ARCANE_GIT_SYNC_WEBHOOK_URLS --env production`, and remove the obsolete `RELEASE_HMAC_SECRET` instead of restoring the OpenShip path.
- Verify a webhook returns `202`, then use the Arcane Event Log/project health and the affected public endpoint. Do not print webhook URLs or tokens.

## Operating flow

1. Confirm the affected agent and dependent services are healthy before mutation.
2. Update source Compose, push it, then run the owning Arcane GitOps sync and wait for its project health result.
3. Verify the owned public endpoint and a narrow internal health check.
4. Before deleting retired resources, list exact containers, volumes, networks, and directories. Delete only the listed targets; never run a global prune.
5. If the Manager variable API is temporarily unavailable, restore only the affected agent's materialized variables through its authenticated Arcane agent API, then reconcile the Manager variable source before any later sync.

## Retired resources

- OpenShip and Mihomo are absent from production. Do not recreate their containers, networks, images, service units, webhook secrets, or directories.
- Preserve the Manager-host WegoLibrary and Memos deployments, including their networks and data. Remove only exact, inspected dangling volumes or unreferenced legacy images; never run a global prune.

## Checks

Use the smallest checks that demonstrate the affected surface: Compose config validation before source changes, Arcane project health after sync, then HTTPS status checks for the corresponding public route. Treat `307` from OpenLIT and `302` from Uptime Kuma as normal login redirects.
