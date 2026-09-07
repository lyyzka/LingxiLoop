# OpenShip production deployment

The desired manifest set contains four product projects on two servers. The old Agent OS projects are retired; the server image installs the exact published LingxiOS package from the npm lockfile. Each role
has an explicit Compose file; production does not use profiles or the local
MVP Compose stack.

| OpenShip project | Compose path | Target | Services |
| --- | --- | --- | --- |
| `lingxiloop-core-state` | `deploy/openship/core-state.yml` | Server A | PostgreSQL, Redis, WuKongIM |
| `lingxiloop-app-a` | `deploy/openship/app-a.yml` | Server A | migration, Web/API |
| `lingxiloop-app-b` | `deploy/openship/app-b.yml` | Server B | migration, Web/API, worker, gateway |
| `lingxiloop-knowledge-agent` | `deploy/openship/knowledge-agent.yml` | Server B | SurrealDB, Open Notebook |

Keep every project Always On with OpenShip auto-deploy disabled. GitHub Actions
builds all four LingxiLoop images with one immutable commit tag, pins every
OpenShip manifest, deploys the control-plane Worker, then sends one signed
release request that fans out to all four product projects. A deployment-only manifest
change reuses the complete pinned cohort and still performs the four-project
rollout.

## Network contract

Server B is the only public application ingress. OpenShip Edge terminates TLS
and routes the retained hostnames to the gateway on `127.0.0.1:8080`. Private
traffic is limited to:

| Source | Destination | Ports |
| --- | --- | --- |
| Server B | Server A | API-A `5181`, WuKongIM API `5001`, WSS `5200`, PostgreSQL `5432`, Redis `6379` |
| Server A | Server B | Open Notebook `5055` |

WuKongIM `5200` and API-A `5181` bind to Server A's `10.20.0.2` address.
SurrealDB has no host port. The
gateway serves the apex and `www`, balances `loop` across both APIs, and
proxies `im` to WuKongIM.

Retained DNS-only A records point to Server B (`111.229.65.23`):
`lingxilearn.cn`, `www.lingxilearn.cn`, `loop.lingxilearn.cn`,
`im.lingxilearn.cn`, and `openlit.lingxilearn.cn`. The admin Worker uses
`https://admin.lingxilearn.cn`; OpenShip uses
`https://ops.christmas1314.xyz`.

## Required values

Both app projects share the authoritative state endpoints and secrets:

```dotenv
DATABASE_URL=postgresql://lingxiloop:<password>@10.20.0.2:5432/lingxiloop
REDIS_URL=redis://10.20.0.2:6379
WUKONG_API_URL=http://10.20.0.2:5001
WUKONG_WS_PUBLIC_URL=wss://im.lingxilearn.cn
OPEN_NOTEBOOK_URL=http://10.20.0.3:5055
DATABASE_POOL_MAX=8
AGENT_OS_INPUT_COST_MICROS_PER_MILLION=<current-model-rate>
AGENT_OS_OUTPUT_COST_MICROS_PER_MILLION=<current-model-rate>
WUKONG_USER_TOKEN_SECRET=<shared-secret>
```

App B's Worker persists `/var/lib/lingxios/homes` in its named volume and runs each Python kernel through Bubblewrap with PID, mount, user and network namespaces. The manifest also bounds Worker CPU, memory and process count. Confirm the two model-rate values whenever the configured model or provider pricing changes.

Set `INSTANCE_ID=app-a` or `INSTANCE_ID=app-b` in the matching project. The knowledge project uses this callback origin:

```dotenv
LINGXILOOP_CONTROL_PLANE_URL=https://loop.lingxilearn.cn
```

The knowledge project uses the same origin for its embedding proxy. Store
database URLs, tokens, model keys, R2 credentials, and registry credentials as
OpenShip secrets. Do not expose or copy them into source files.

## App B worker runtime guard

OpenShip 0.6.9 does not model the Worker's Compose `read_only`, `tmpfs`,
`pids_limit`, or `security_opt` settings. A normal App B refresh can therefore
replace a valid Worker with a container that cannot create the Bubblewrap
namespaces required by LingxiOS. Keep those fields in `app-b.yml` as the desired
deployment contract, and run the host-managed guard on Server B until the
deployer preserves them natively.

Install or refresh the guard from a checked-out copy of this repository:

```sh
sudo deploy/openship/install-worker-runtime-guard.sh
```

The guard watches only `openship-lingxiloop-app-b-worker`. If OpenShip starts a
non-compliant replacement, the guard copies that container's current immutable
image, environment, OpenShip labels, named home volume, project network,
restart policy, CPU/memory limits, logging config, and command, then recreates
only the Worker with the required read-only root, `/tmp` tmpfs, PID limit 128,
unconfined seccomp, and unmasked system paths. The replacement must log
`worker started` and pass an in-container Bubblewrap namespace probe before the
old stopped container is deleted; otherwise the guard rolls back to it. Secret
environment values are never emitted to logs or placed on the command line.

Treat `/usr/local/sbin/lingxiloop-worker-runtime-guard` and
`/etc/systemd/system/lingxiloop-worker-runtime-guard.service` as Server B
host-managed production assets. Remove the guard only after a real OpenShip
refresh has been proven to retain all four Worker runtime invariants.

## Verification

After every rollout, require all four OpenShip deployments to reach `ready`,
all expected production services to report healthy, no drift issue, and the
public Web/API/IM probes to pass. App A
must contain only `db-migrate` and `lingxiloop`; App B must contain exactly
`db-migrate`, `lingxiloop`, `worker`, and `gateway`.
Additionally require `lingxiloop-worker-runtime-guard.service` to be active and
`/usr/local/sbin/lingxiloop-worker-runtime-guard --check` to exit zero on Server B.
