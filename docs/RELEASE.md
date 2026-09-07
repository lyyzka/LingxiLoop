# Release and rollback

The server image contains the exact published LingxiOS dependency and its Python runner. Release migration must complete before Web or Worker starts; only App B runs the Worker. This repository change does not itself alter the live OpenShip environment.

Pushes to `main` deploy only after lint, all TypeScript checks, builds, unit/integration tests pass. No browser-test runner is installed or invoked by this workflow.

The workflow publishes four immutable GHCR images (`lingxiloop-server`, `lingxiloop-wukongim`, `lingxiloop-open-notebook`, `lingxiloop-gateway`), pins the OpenShip manifests, applies D1 migrations, deploys the Refine/Worker management plane, then signs one idempotent release request. The Worker first synchronizes the App A/B Web service rows to the pinned server image, then starts the four product OpenShip projects from that manifest commit; OpenShip owns the Shanghai rollout, health decision and rollback window. GitHub push auto-deploy must remain disabled so an unverified push cannot deploy early.

Required GitHub `production` configuration:

- Variables: `CLOUDFLARE_ACCOUNT_ID`, `VITE_LINGXILIT_URL=https://openlit.lingxilearn.cn`.
- Secrets: `CLOUDFLARE_API_TOKEN`, `RELEASE_HMAC_SECRET`.

The management UI is published at `https://admin.lingxilearn.cn`; the Worker preview URL is disabled.
CI uploads and promotes a Worker Version without rewriting the existing Custom Domain, so its account token does not need zone-route permission. Use the normal `control:deploy` command only when intentionally changing that domain binding.
The Worker reaches OpenShip through the dashboard's same-origin `/api/proxy/api/*` path; `/api/*` on the management hostname is not the OpenShip API.

Required Worker secrets are managed only with `wrangler secret put`: `BETTER_AUTH_SECRET`, `GATEWAY_HMAC_SECRET`, `RELEASE_HMAC_SECRET`, `BOOTSTRAP_ADMIN_TOKEN`, `OPENSHIP_PAT`, `RESEND_API_KEY`, `RESEND_FROM`, `TURNSTILE_SECRET_KEY`, and optional Cloudflare Access service-token values. The non-secret `OPENSHIP_PROJECT_IDS` and `OPENSHIP_IMAGE_TARGETS` lists live in `wrangler.jsonc`. After the first verified administrator is created through `/api/internal/bootstrap-admin`, delete `BOOTSTRAP_ADMIN_TOKEN` with Wrangler.

`server/src/db/migrations/0001_v1_baseline.sql` remains immutable. The current cutover starts from empty PostgreSQL and D1 databases; PostgreSQL runs all migrations through the one-shot `db-migrate` service before Web/Worker startup. Application processes only check migration readiness.

Rollback is an OpenShip deployment action exposed in Refine. It changes digest-pinned application images, never reverses PostgreSQL or D1 migrations. Use a database backup paired with the earlier release if a forward-only schema change is incompatible.

## Registration and document recovery

Registration requires a `registration` audience, a dedicated provision/invitation capability,
and a signed body digest. Provisioning also binds the verified auth subject. Roll out the
Worker signer before the origin verifier to keep registration available; the ordinary
user proxy must reject `/api/internal/*` throughout the rollout.

Document edit success confirms the database commit. A rejected edit remains optimistic
and unconfirmed until its retained delta is retried. Redis fanout and compaction do not
determine edit success. Active rooms replay the durable snapshot/log cursor every five
seconds, including after missed notifications; retained failed deltas prevent eviction.
Process loss can discard unconfirmed deltas, so a client must retain its unsaved state.

## LingxiOS runtime

Migration `0010_lingxios_native_runtime.sql` performs the empty-state cutover and installs the schema shipped by the exact package version under the migration lock. Startup checks its runtime, schema, protocol, and file digest. App B must provide model token-cost rates, mount the persistent kernel-home volume, and retain the checked-in CPU, memory and PID bounds. The image supplies Python 3 and Bubblewrap; Worker readiness verifies the namespace sandbox before it accepts work. Rollback never reverses the schema migration.
