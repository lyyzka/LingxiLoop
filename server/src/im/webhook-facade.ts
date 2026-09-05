import { pool } from '../db/pool.js'
import { withTransaction } from '../db/transaction.js'
import { createAttachmentKnowledgeJob, isKnowledgeAttachmentMime } from '../modules/knowledge/public.js'
import { WukongWebhookApplication } from './webhook-application.js'
import { wukongClient } from './wukong.js'

export const wukongWebhookApplication = new WukongWebhookApplication({
  transaction: (work) => withTransaction(pool, work),
  verify: (raw, signature, token) => wukongClient().verifyWebhook(raw, signature, token),
  isKnowledgeAttachment: isKnowledgeAttachmentMime,
  createKnowledgeJob: createAttachmentKnowledgeJob,

})
