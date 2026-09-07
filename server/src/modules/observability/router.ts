import { Router } from 'express'
import { safe } from '../../http/async-handler.js'
import { requireConversationMember } from '../../http/authorization.js'
import { HttpError } from '../../http/errors.js'
import { activityQuerySchema } from './contracts.js'
import { observabilityApplication } from './facade.js'

export const observabilityRouter = Router()

observabilityRouter.get('/coworker/activity', safe(async (req, res) => {
  const input = activityQuerySchema.safeParse(req.query)
  if (!input.success) throw new HttpError(400, 'conversationId is required')
  const { companyId } = await requireConversationMember(req, input.data.conversationId)
  res.json(await observabilityApplication.activity(companyId, input.data.conversationId))
}))
