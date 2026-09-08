import { pool } from '../db/pool.js'
import { HttpError } from '../http/errors.js'
import { env } from '../env.js'
import { ImSessionApplication } from './session-application.js'
import { wukongClient } from './wukong.js'

export const imSessionApplication = new ImSessionApplication({
  tokenGeneration: async (userId) => {
    const { rows } = await pool.query<{ period_id: string }>(`SELECT member.period_id FROM company_memberships member
      JOIN users account ON account.id=member.user_id WHERE member.user_id=$1 AND member.status='ACTIVE'
        AND member.ended_at IS NULL AND account.departed_at IS NULL AND account.suspended_at IS NULL AND account.deleted_at IS NULL`, [userId])
    if (!rows[0]?.period_id) throw new HttpError(403, 'active company membership required')
    return rows[0].period_id
  },
  userTokenSecret: env.WUKONG_USER_TOKEN_SECRET,
  bootstrap: (userId, token) => wukongClient().bootstrap(userId, token),
})
