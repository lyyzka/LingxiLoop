# Product coordination

Committed WuKong messages persist a LingxiOS wake intent in the webhook transaction. `receive()` runs after commit; a durable outbox retries failures and converges on the package's deterministic work identity. Knowledge attachments remain deferred until ingestion reaches a terminal state. Web exposes only authenticated product approval/control routes, while the Worker exclusively claims namespaced LingxiOS work.

Company invitation acceptance commits membership, audit and one tenant-scoped
member-onboarding effect in the same PostgreSQL transaction. The Worker claims
that effect with a renewable lease and fence, then creates teammate direct
channels only through the Conversations public application. A process or
WuKongIM failure is retried from the durable effect and channel binding; the
acceptance request never creates a parallel conversation row or requires the
user to replay a consumed invitation.
