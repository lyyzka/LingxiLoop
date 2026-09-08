export const arcaneTargetNames = [
  'lingxiloop-core-state',
  'lingxiloop-app-a',
  'server-b-ingress',
  'lingxiloop-app-b',
  'lingxiloop-knowledge-agent',
  'uptime',
] as const

export type ArcaneTargetName = typeof arcaneTargetNames[number]
export type ArcaneEnv = {
  ARCANE_BASE_URL: string
  ARCANE_TARGETS_JSON: string
  ARCANE_API_KEY: string
  ARCANE_GITOPS_WEBHOOKS: string
}

type ArcaneTarget = { environmentId: string; projectId: string }
type ArcaneTargets = Record<ArcaneTargetName, ArcaneTarget>
type ArcaneRuntime = { data?: { runtimeServices?: Array<{ containerId?: string; containerName?: string }> } }

function targets(env: ArcaneEnv): ArcaneTargets {
  const parsed = JSON.parse(env.ARCANE_TARGETS_JSON) as Record<string, unknown>
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || Object.keys(parsed).sort().join() !== [...arcaneTargetNames].sort().join()) {
    throw new Error(`ARCANE_TARGETS_JSON must contain exactly: ${arcaneTargetNames.join(', ')}`)
  }
  for (const name of arcaneTargetNames) {
    const value = parsed[name] as Partial<ArcaneTarget> | undefined
    if (!value || typeof value.environmentId !== 'string' || !value.environmentId.trim()
      || typeof value.projectId !== 'string' || !value.projectId.trim()
      || Object.keys(value).some((key) => key !== 'environmentId' && key !== 'projectId')) {
      throw new Error(`invalid Arcane target: ${name}`)
    }
  }
  return parsed as ArcaneTargets
}

function target(env: ArcaneEnv, name: ArcaneTargetName): ArcaneTarget {
  return targets(env)[name]
}

function baseUrl(env: ArcaneEnv): URL {
  const url = new URL(env.ARCANE_BASE_URL)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('ARCANE_BASE_URL must be an HTTPS origin')
  }
  return url
}

async function boundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let text = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (text.length < 262_144) text += decoder.decode(value, { stream: true }).slice(0, 262_144 - text.length)
  }
  return text.length < 262_144 ? text + decoder.decode().slice(0, 262_144 - text.length) : text
}

async function arcaneRequest(env: ArcaneEnv, path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers = new Headers(init.headers)
    headers.set('x-api-key', env.ARCANE_API_KEY)
    if (init.body) headers.set('content-type', 'application/json')
    const response = await fetch(new URL(path, baseUrl(env)), { ...init, headers, signal: controller.signal, redirect: 'manual' })
    const text = await boundedText(response)
    if (!response.ok) throw new Error(`Arcane ${response.status}: ${text.slice(0, 1000)}`)
    if (!text) return { ok: true, status: response.status }
    try { return JSON.parse(text) } catch { return text }
  } finally {
    clearTimeout(timeout)
  }
}

function projectPath(env: ArcaneEnv, name: ArcaneTargetName, suffix = ''): string {
  const { environmentId, projectId } = target(env, name)
  return `/api/environments/${encodeURIComponent(environmentId)}/projects/${encodeURIComponent(projectId)}${suffix}`
}

export function listArcaneTargets(env: ArcaneEnv): Record<string, ArcaneTarget> {
  return targets(env)
}

export async function inspectArcaneTarget(env: ArcaneEnv, name: ArcaneTargetName): Promise<unknown> {
  const path = projectPath(env, name)
  const [project, runtime, updates] = await Promise.all([
    arcaneRequest(env, path),
    arcaneRequest(env, `${path}/runtime`),
    arcaneRequest(env, `${path}/updates`),
  ])
  return { name, project, runtime, updates }
}

export async function listArcaneEvents(env: ArcaneEnv, name: ArcaneTargetName, limit: number): Promise<unknown> {
  const value = target(env, name)
  const [runtime, events] = await Promise.all([
    arcaneRequest(env, projectPath(env, name, '/runtime')) as Promise<ArcaneRuntime>,
    arcaneRequest(env, `/api/events/environment/${encodeURIComponent(value.environmentId)}?search=${encodeURIComponent(name)}&sort=createdAt&order=desc&limit=100`),
  ])
  if (!events || typeof events !== 'object' || Array.isArray(events)) throw new Error('invalid Arcane events response')
  const body = events as { data?: unknown }
  if (!Array.isArray(body.data)) return body
  const resources = new Set([value.projectId, name])
  for (const service of runtime.data?.runtimeServices ?? []) {
    if (service.containerId) resources.add(service.containerId)
    if (service.containerName) resources.add(service.containerName)
  }
  return { ...body, data: body.data.filter((event) => event && typeof event === 'object'
    && [Reflect.get(event, 'resourceId'), Reflect.get(event, 'resourceName')].some((resource) => typeof resource === 'string' && resources.has(resource))).slice(0, limit) }
}

async function assertProjectContainer(env: ArcaneEnv, name: ArcaneTargetName, containerId: string): Promise<void> {
  const response = await arcaneRequest(env, projectPath(env, name, '/runtime')) as ArcaneRuntime
  if (!response.data?.runtimeServices?.some((service) => service.containerId === containerId)) {
    throw new Error(`container is not a current member of ${name}`)
  }
}

export async function runArcaneProjectAction(env: ArcaneEnv, name: ArcaneTargetName,
  action: 'up' | 'down' | 'restart' | 'redeploy' | 'pull' | 'update_services' | 'git_sync', services: string[] = []): Promise<unknown> {
  if (action === 'git_sync') {
    const hooks = JSON.parse(env.ARCANE_GITOPS_WEBHOOKS || '{}') as Record<string, unknown>
    const raw = hooks[name]
    if (typeof raw !== 'string') throw new Error(`no GitOps webhook configured for ${name}`)
    const url = new URL(raw)
    const base = baseUrl(env)
    if (url.protocol !== 'https:' || url.host !== base.host || !/^\/api\/webhooks\/trigger\/arc_wh_[\w-]+$/.test(url.pathname)) {
      throw new Error(`invalid GitOps webhook configured for ${name}`)
    }
    const response = await fetch(url, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(30_000) })
    if (response.status !== 202) throw new Error(`Arcane Git Sync returned ${response.status}`)
    return { accepted: true, status: 202 }
  }
  const suffix = action === 'update_services' ? '/update-services' : `/${action}`
  const query = action === 'restart' && services.length
    ? `?${services.map((service) => `services=${encodeURIComponent(service)}`).join('&')}`
    : ''
  const body = action === 'update_services' ? JSON.stringify({ services })
    : action === 'up' || action === 'redeploy' ? '{}' : undefined
  return arcaneRequest(env, projectPath(env, name, suffix) + query, { method: 'POST', body },
    action === 'up' || action === 'redeploy' || action === 'pull' ? 300_000 : 30_000)
}

export async function runArcaneContainerAction(env: ArcaneEnv, name: ArcaneTargetName, containerId: string,
  action: 'start' | 'stop' | 'restart' | 'pause' | 'unpause'): Promise<unknown> {
  await assertProjectContainer(env, name, containerId)
  const { environmentId } = target(env, name)
  return arcaneRequest(env, `/api/environments/${encodeURIComponent(environmentId)}/containers/${encodeURIComponent(containerId)}/${action}`, { method: 'POST' })
}

export async function readArcaneLogs(env: ArcaneEnv, name: ArcaneTargetName,
  options: { containerId?: string; tail: number; sinceSeconds?: number }): Promise<{ logs: string; truncated: boolean }> {
  const value = target(env, name)
  if (options.containerId) await assertProjectContainer(env, name, options.containerId)
  const type = options.containerId ? 'containers' : 'projects'
  const id = options.containerId ?? value.projectId
  const path = `/api/environments/${encodeURIComponent(value.environmentId)}/ws/${type}/${encodeURIComponent(id)}/logs`
  const url = new URL(path, baseUrl(env))
  url.searchParams.set('follow', 'false')
  url.searchParams.set('tail', String(options.tail))
  url.searchParams.set('timestamps', 'true')
  url.searchParams.set('format', 'text')
  if (options.sinceSeconds) url.searchParams.set('since', String(Math.floor(Date.now() / 1000) - options.sinceSeconds))

  const response = await fetch(url, { headers: { Upgrade: 'websocket', 'x-api-key': env.ARCANE_API_KEY }, redirect: 'manual' })
  const socket = response.webSocket
  if (response.status !== 101 || !socket) throw new Error(`Arcane log connection returned ${response.status}`)
  socket.accept()
  const chunks: string[] = []
  let size = 0
  let truncated = false
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { socket.close(1000, 'snapshot complete'); resolve() }, 15_000)
    socket.addEventListener('message', (event) => {
      const chunk = typeof event.data === 'string' ? event.data : '[binary log data omitted]'
      size += chunk.length
      if (size > 262_144) {
        truncated = true
        socket.close(1000, 'snapshot limit reached')
        return
      }
      chunks.push(chunk)
    })
    socket.addEventListener('close', () => { clearTimeout(timeout); resolve() })
    socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Arcane log stream failed')) })
  })
  return { logs: chunks.join('\n'), truncated }
}
