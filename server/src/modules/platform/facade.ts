import { pool } from '../../db/pool.js'
import { ogPreview } from '../../og.js'
import { redis } from '../../redis.js'
import { storage } from '../../storage.js'
import { knowledgeEngineHealth, openNotebookEnabled } from '../knowledge/public.js'
import { PlatformApplication } from './application.js'

export const platformApplication = new PlatformApplication({
  db: pool,
  storage,
  redisPing: async () => { await redis.ping() },
  openNotebookEnabled,
  openNotebookHealth: knowledgeEngineHealth,
  loadOpenGraph: ogPreview,
})
