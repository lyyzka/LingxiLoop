import { pool } from '../db/pool.js'
import { toggleWukongReaction, wukongReactions } from '../modules/messages/public.js'
import { ImMessagesApplication } from './messages-application.js'
import { publishReadReceiptAdvance, recordReadReceiptAdvance } from './read-receipts.js'
import { wukongClient } from './wukong.js'

export function createImMessagesApplication(signal?: AbortSignal) {
  return new ImMessagesApplication({
  db: pool,
  withConnection: async (work) => {
    const client = await pool.connect()
    try {
      return await work(client)
    } finally {
      client.release()
    }
  },
  syncMessages: (...args) => wukongClient(signal).syncMessages(...args),
  listConversations: (...args) => wukongClient(signal).listConversations(...args),
  clearUnread: (...args) => wukongClient(signal).clearUnread(...args),
  reactions: wukongReactions,
  toggleReaction: toggleWukongReaction,
  sendMessage: (...args) => wukongClient(signal).sendMessage(...args),
  setUnread: (...args) => wukongClient(signal).setUnread(...args),
  recordReadReceipt: recordReadReceiptAdvance,
  publishReadReceipt: publishReadReceiptAdvance,
})
}
export const imMessagesApplication = createImMessagesApplication()
