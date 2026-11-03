const assert = require('node:assert/strict')
const { createWalkingRouteCache } = require('./walkingRouteCache')
async function main() {
  let time = 0
  let calls = 0
  const cache = createWalkingRouteCache({ ttlMs: 100, maxEntries: 2, now: () => time })
  const load = async () => { calls++; return { status: 200, body: calls } }
  const results = await Promise.all([cache('A-B', load), cache('A-B', load), cache('A-B', load)])
  assert.equal(calls, 1)
  assert.deepEqual(results.map(r => r.body), [1, 1, 1])
  await cache('A-B', load)
  assert.equal(calls, 1)
  await cache('B-A', load)
  assert.equal(calls, 2) // Direction matters.
  time = 100
  await cache('A-B', load)
  assert.equal(calls, 3)
  await cache('C-D', load)
  await cache('E-F', load)
  await cache('A-B', load)
  assert.equal(calls, 6) // Bounded cache evicts oldest entry.
  let failures = 0
  const fail = async () => { failures++; return { status: 502 } }
  await cache('failure', fail); await cache('failure', fail)
  assert.equal(failures, 2)
  await assert.rejects(cache('throw', async () => { throw new Error('network') }))
  assert.equal((await cache('throw', load)).status, 200)
  console.log('walking route cache tests passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
