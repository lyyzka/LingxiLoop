export interface Env {
  BUCKET: R2Bucket
}

// Only public profile pictures may be fetched without application authorization.
const PUBLIC_PREFIXES = ['avatars/']

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new Response('method not allowed', { status: 405 })
    }
    const url = new URL(req.url)
    let key: string
    try { key = decodeURIComponent(url.pathname.replace(/^\/+/, '')) } catch {
      return new Response('invalid path', { status: 400 })
    }
    if (!key) return new Response('not found', { status: 404 })

    if (!PUBLIC_PREFIXES.some(prefix => key.startsWith(prefix))) {
      return new Response('authenticated application read required', { status: 403, headers: { 'cache-control': 'no-store' } })
    }

    // Honor If-None-Match for cache revalidation. R2's get() accepts the
    // condition; a HEAD goes through head() with no body. Both shapes
    // expose the same metadata surface that we copy onto the response.
    const ifNoneMatch = req.headers.get('if-none-match') ?? undefined
    const obj: R2Object | R2ObjectBody | null = req.method === 'HEAD'
      ? await env.BUCKET.head(key)
      : await env.BUCKET.get(key, ifNoneMatch ? { onlyIf: { etagDoesNotMatch: ifNoneMatch } } : undefined)

    if (!obj) return new Response('not found', { status: 404 })

    const headers = new Headers()
    const meta = obj.httpMetadata
    if (meta?.contentType) headers.set('content-type', meta.contentType)
    if (meta?.contentLanguage) headers.set('content-language', meta.contentLanguage)
    if (meta?.contentDisposition) headers.set('content-disposition', meta.contentDisposition)
    if (meta?.contentEncoding) headers.set('content-encoding', meta.contentEncoding)
    headers.set('etag', obj.httpEtag)
    headers.set(
      'cache-control',
      'public, max-age=86400, immutable',
    )

    // The GET path can produce an `R2ObjectBody` (full read) or just an
    // `R2Object` (conditional miss → 304). HEAD always produces an
    // `R2Object`. Body is only present on the full-GET branch.
    const body: ReadableStream | null = 'body' in obj ? (obj as R2ObjectBody).body : null
    const status = req.method === 'GET' && ifNoneMatch && !body ? 304 : 200
    return new Response(req.method === 'HEAD' ? null : body, { status, headers })
  },
}
