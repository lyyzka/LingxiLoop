# Arcane production projects

Arcane v2.10.2 is the only deployment control plane. `aly` runs the Manager;
servers A and B run outbound-only Edge Agents in poll mode. Configure repository
credentials, environment variables, and secrets in Arcane. Never commit `.env`
files or webhook tokens.

| Host | Project | Purpose |
| --- | --- | --- |
| `aly` | `arcane-manager` | Manager on `127.0.0.1:3552` and Docker socket proxy |
| `aly` | `aly-ingress` | Traefik for Arcane and the existing WegoLibrary |
| A/B | `arcane-agent` | Edge Agent; use a different generated token on each host |
| A | `lingxiloop-core-state` | PostgreSQL, Redis, WuKongIM |
| A | `lingxiloop-app-a` | migration and Web/API |
| B | `server-b-ingress` | Traefik and the shared `lingxiloop-ingress` network |
| B | `lingxiloop-app-b` | migration, Web/API, Worker, Gateway |
| B | `lingxiloop-knowledge-agent` | SurrealDB and Open Notebook |
| B | `uptime` | fresh Uptime Kuma instance |

Landing and LingxiLit are Git Sync projects owned by their repositories. On
`aly`, create `/opt/arcane/projects/wegolibrary` as a symlink to
`/opt/apps/wegolibrary`; Arcane follows that link and Traefik continues to use
the existing host port `18081`. Memos is deliberately outside Arcane.

Both Traefik projects use only the file provider and new ACME volumes. They do
not mount the Docker socket or reuse previous certificates. Only ports 80 and
443 are public; the Manager and both Agents have no public management port.

CI pins published images in the four product Compose files, then calls each
project's tokenized Git Sync webhook. A `202` response means accepted; confirm
completion in Arcane's Event Log and with service health checks.

First release order: B ingress and landing, A core state, Admin Worker,
knowledge and LingxiLit, App A, App B, then Uptime. Configure 16 fresh Uptime
monitors for website, Web, Admin, Gateway, IM, DNS, PostgreSQL, Redis, WuKongIM,
dependency contract, API-A, shared Agent heartbeat, Open Notebook, OpenLit,
Uptime, and Arcane.

## Production operations MCP

The Admin Worker serves a stateless Streamable HTTP MCP endpoint at
`https://admin.lingxilearn.cn/api/mcp`. Set these Worker secrets before enabling
it: `MCP_SERVICE_TOKEN`, `MCP_AUTH_USER_ID`, `ARCANE_API_KEY`,
`ARCANE_TARGETS_JSON`, and `ARCANE_GITOPS_WEBHOOKS`. `MCP_AUTH_USER_ID` must be
the Better Auth ID of an active administrator already linked to a business
user. Rotate `MCP_SERVICE_TOKEN` to revoke all MCP clients.

`ARCANE_TARGETS_JSON` must contain exactly the six project keys in the table:

```json
{
  "lingxiloop-core-state": { "environmentId": "...", "projectId": "..." },
  "lingxiloop-app-a": { "environmentId": "...", "projectId": "..." },
  "server-b-ingress": { "environmentId": "...", "projectId": "..." },
  "lingxiloop-app-b": { "environmentId": "...", "projectId": "..." },
  "lingxiloop-knowledge-agent": { "environmentId": "...", "projectId": "..." },
  "uptime": { "environmentId": "...", "projectId": "..." }
}
```

`ARCANE_GITOPS_WEBHOOKS` is a JSON object mapping only projects with a Git Sync
hook to their tokenized HTTPS URL. Use an Arcane API key restricted to project
read/logs/events and project/container lifecycle permissions. The MCP has no
tools for secrets, arbitrary commands, SQL, project destruction, files, or
volumes.

For a local Codex client, add the endpoint and the generated token to the local
Codex config (never to this repository):

```toml
[mcp_servers.lingxiloop_production]
url = "https://admin.lingxilearn.cn/api/mcp"
http_headers = { Authorization = "Bearer <MCP_SERVICE_TOKEN>" }
```
