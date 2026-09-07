import { z } from 'zod'

export const activityQuerySchema = z.object({ conversationId: z.string().trim().min(1).max(200) }).strict()
