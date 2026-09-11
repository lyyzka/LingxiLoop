import assert from 'node:assert/strict'
import test from 'node:test'
import worker, { type Env } from './index'

test('private objects reject old signed URLs before any bucket access', async () => {
  const env = { BUCKET: { get: () => { throw new Error('private bucket access') }, head: () => { throw new Error('private bucket access') } } } as unknown as Env
  for (const method of ['GET','HEAD']) {
    const response = await worker.fetch(new Request('https://cdn.test/attachments/company/file?exp=9999999999999&sig=old', {method}),env)
    assert.equal(response.status,403)
    assert.equal(response.headers.get('cache-control'),'no-store')
  }
  assert.equal((await worker.fetch(new Request('https://cdn.test/%ZZ'),env)).status,400)
})

test('public avatar delivery reads only the requested avatar key', async () => {
  const keys: string[] = []
  const env = { BUCKET: { head: async (key: string) => { keys.push(key); return null } } } as unknown as Env
  assert.equal((await worker.fetch(new Request('https://cdn.test/avatars/photo.png',{method:'HEAD'}),env)).status,404)
  assert.deepEqual(keys,['avatars/photo.png'])
})
