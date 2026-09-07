const webhookUrls = (process.env.ARCANE_GIT_SYNC_WEBHOOK_URLS ?? '').split(/\s+/).filter(Boolean)

if (!webhookUrls.length) throw new Error('ARCANE_GIT_SYNC_WEBHOOK_URLS is required')

await Promise.all(webhookUrls.map(async (value) => {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.hostname !== 'ops.christmas1314.xyz' || !/^\/api\/webhooks\/trigger\/arc_wh_[\w-]+$/.test(url.pathname)) {
    throw new Error('invalid Arcane Git Sync webhook URL')
  }
  const response = await fetch(url, { method: 'POST' })
  if (response.status !== 202) throw new Error(`Arcane Git Sync webhook returned ${response.status}`)
}))
