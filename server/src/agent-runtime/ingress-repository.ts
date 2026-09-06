import type { Queryable } from '../db/queryable.js'

export async function releaseKnowledgeAgentWakes(db: Queryable, sourceId: string): Promise<void> {
  await db.query(
    `UPDATE lingxios_ingress_outbox SET available_at=COALESCE(available_at,NOW()),error=NULL
      WHERE knowledge_source_id=$1 AND delivered_at IS NULL`,
    [sourceId],
  )
}
