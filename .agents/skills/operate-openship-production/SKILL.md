---
name: operate-openship-production
description: Inspect, change, recover, or audit LingxiLoop's OpenShip production environment. Use for live production actions and for changes to deploy/openship, production manifests or environment, hosts, routing, DNS/TLS, releases, capacity, monitoring, or incidents. Do not use for unrelated repository work or ordinary handoff.
---

# Operate LingxiLoop OpenShip Production

Work within the existing two-server architecture and the user's requested scope. OpenShip and the hosts are authoritative for current runtime state; repository manifests and references describe intended or previously observed state.

## Authority and safety

- Separate `current runtime`, `desired manifest`, `historical`, and `unresolved` facts. Do not present one as another.
- Repository changes do not authorize live deployment. Mutate production only when the user requested that production action, and stop once the requested outcome is verified.
- Never print, commit, copy into a patch, or summarize plaintext credentials. Use secret names and equality requirements only, redact commands or arguments that may expose values, and let the configured OpenShip MCP transport supply its PAT.
- Destructive recovery requires explicit authorization for exact targets plus a fresh backup or confirmed data classification. Historical cleanup or reset approval is not standing permission.
- Prefer OpenShip MCP, targeted host-safe commands, `wrangler`, DNS tools, and HTTP/WebSocket probes. Do not control a browser for production operations.

## Read only the references the task needs

- [references/current-deployment.md](references/current-deployment.md): read when inspecting or changing live projects, services, deployments, images, hosts, or current production identity.
- [references/environment-contract.md](references/environment-contract.md): read before changing production manifests, service or project environment, GitHub Actions, Workers, or secret-source mappings.
- [references/domains-and-network.md](references/domains-and-network.md): read for DNS, TLS, Edge, Gateway, firewall, WireGuard, WebSocket, ports, or ingress.
- [references/operations-and-history.md](references/operations-and-history.md): read for releases, upgrades, recovery, cleanup, capacity, failover, architecture changes, and known operational traps.
- [references/deployment-ledger.md](references/deployment-ledger.md): read only when tracing or comparing historical deployments.
- [references/uptime-kuma.md](references/uptime-kuma.md): read only for Uptime Kuma, monitoring, public status, metrics, or its backups.

Do not load unrelated references or turn a bounded task into a full-platform audit. For a requested audit or an incident with unknown scope, expand to all references and live checks relevant to the affected systems.

## Production invariants

- Preserve the documented topology unless the user explicitly requests an architectural change. Server B remains the only public application ingress; Server A owns PostgreSQL, Redis, and WuKongIM. Do not claim automatic failover for their single-primary failure domains.
- Keep AgentOS, databases, SurrealDB, ClickHouse, Open Notebook, and OTLP private as documented in the network reference. Do not expose a private port to make a check pass.
- Run PostgreSQL migrations before new Web, Worker, or AgentOS binaries when the release includes migrations. A completed one-shot migration with exit code `0` is success, not an outage.
- Use the existing CI-controlled immutable-image release path. An accepted deployment request is not completion; verify the affected deployment and actual running image or configuration.
- Preserve named volumes and existing security boundaries unless the user explicitly authorizes a scoped change.

## Work and verification

1. Identify the exact requested outcome, affected systems, authorization boundary, and required references.
2. Inspect only the affected live objects. Compare repository intent, OpenShip configuration, and actual containers only where that comparison can change the decision.
3. Make the smallest authorized change. Do not add unrelated cleanup, topology changes, or remediation.
4. Verify the observable outcome at the affected surface. Broaden checks only for a requested release, audit, incident, failover exercise, or cross-system change.
5. If live facts changed, update only the applicable references without secret values. Record unresolved drift explicitly.

For releases, verify affected deployments reach `ready`, intended immutable images are actually running, relevant health probes pass, and applicable migrations completed. For environment changes, compare required names and equality without reading values. For network changes, verify only the affected authoritative DNS, route, TLS, private flow, or public endpoint. For recovery or cleanup, read the operations reference first and validate exact targets, downtime, and recovery evidence.

Report the verified current result, material limitations, and unresolved issues. Do not require a whole-platform checklist for a bounded change.
