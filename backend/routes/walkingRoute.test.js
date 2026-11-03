const assert = require('node:assert/strict')
const express = require('express')
const app = express()
app.use(express.json())
app.use(require('./walkingRoute'))
const originalFetch = global.fetch
const originalKey = process.env.TMAP_APP_KEY
const server = app.listen(0, '127.0.0.1', async () => {
  const request = body => originalFetch(`http://127.0.0.1:${server.address().port}/walking`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const body = { origin: { lat: 37.5, lng: 127 }, destination: { lat: 37.51, lng: 127.01 } }
  try {
    delete process.env.TMAP_APP_KEY
    assert.equal((await request(body)).status, 503)
    process.env.TMAP_APP_KEY = 'test'
    assert.equal((await request({ ...body, origin: { lat: null, lng: 127 } })).status, 400)
    global.fetch = async (url, options) => {
      assert.equal(options.headers.appKey, 'test')
      assert.equal(JSON.parse(options.body).reqCoordType, 'WGS84GEO')
      return { ok: true, json: async () => ({ features: [
        { geometry: { type: 'Point', coordinates: [127, 37.5] }, properties: { totalTime: 120, totalDistance: 150 } },
        { geometry: { type: 'LineString', coordinates: [[127, 37.5], [127, 37.51], [127.01, 37.51]] } },
      ] }) }
    }
    const result = await (await request(body)).json()
    assert.equal(result.segments[0].length, 3)
    assert.deepEqual(result.segments[0][1], { lat: 37.51, lng: 127 })
    assert.equal(result.duration, 120)
    global.fetch = async () => { throw new Error('cached requests must not call TMAP') }
    assert.equal((await request(body)).status, 200)
    const differentBody = { ...body, destination: { lat: 37.52, lng: 127.01 } }
    global.fetch = async () => ({ ok: true, json: async () => ({ features: [] }) })
    assert.equal((await request(differentBody)).status, 404)
    global.fetch = async () => ({ ok: false, json: async () => ({ error: {} }) })
    assert.equal((await request(differentBody)).status, 502)
    console.log('walking route tests passed')
  } catch (error) { console.error(error); process.exitCode = 1 }
  finally {
    global.fetch = originalFetch
    if (originalKey === undefined) delete process.env.TMAP_APP_KEY
    else process.env.TMAP_APP_KEY = originalKey
    server.close()
  }
})
