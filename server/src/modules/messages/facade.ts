import { bumpClimate } from '../../agents/climate.js'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/transaction.js'
import { replyInEmailConversation } from '../email/index.js'
import { CH_REACTIONS, publish } from '../../redis.js'
import { storage } from '../../storage.js'
import { MessagesApplication } from './application.js'
import type { MessagesInfrastructure } from './application.js'
import type { Queryable } from '../../db/queryable.js'

export function createMessagesApplication(db: Queryable, transaction: MessagesInfrastructure['transaction'], publishReaction: MessagesInfrastructure['publishReaction']) {
  return new MessagesApplication({
  db,
  storage,
  transaction,
  replyEmail: replyInEmailConversation,
  bumpReactionClimate: async ({ companyId, agentId, aboutId, emoji }) => {
    await bumpClimate({
      companyId,
      agentId,
      aboutId,
      affinity: 0.05,
      trust: 0.02,
      note: `received ${emoji} from ${aboutId}`,
    }, db)
  },
  publishReaction,
})
}
export const messagesApplication = createMessagesApplication(pool, work => withTransaction(pool, work), event => publish(CH_REACTIONS, event))
