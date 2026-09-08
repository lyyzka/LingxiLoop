# Release

The server image contains the exact published LingxiOS dependency and its
Python runner. Database migrations must complete before Web or Worker starts;
only App B runs the Worker.

The GitHub workflow publishes immutable commit-tagged images, pins the four
Compose projects under `deploy/arcane`, applies D1 migrations when needed, and
deploys the Admin Worker. It then POSTs the tokenized Arcane Git Sync webhook
URLs stored in the production secret `ARCANE_GIT_SYNC_WEBHOOK_URLS`.

Arcane v2.10.2 owns deployment state. Its webhook `202` response only confirms
acceptance; verify completion in the Arcane Event Log and with service health
checks. Arcane variables hold product configuration and secrets. External
credentials come from Sigillo and must never be committed or printed.

Required GitHub production secrets are `CLOUDFLARE_API_TOKEN` and
`ARCANE_GIT_SYNC_WEBHOOK_URLS`. Required Worker secrets are managed with
Wrangler. After `/api/internal/bootstrap-admin` creates the first verified
administrator, delete `BOOTSTRAP_ADMIN_TOKEN`.

Production is forward-only. Fix failed releases in place; there is no retained
application-state rollback for the Arcane first release.

The production operations MCP additionally requires the five Worker secrets
documented in `deploy/arcane/README.md`. Apply them with `wrangler secret put`,
then upload a new Worker version; never place their values in Git, CI output, or
operator transcripts.
