import { getRouteTime } from './routeTimeApi'

jest.mock('./apiBaseUrl', () => ({ getApiBaseUrl: () => '/api' }))
afterEach(() => { delete global.fetch })

test('walking uses pedestrian routing and supplies coordinates, time and distance to meeting maps', async () => {
  const segments = [[{ lat: 37.5, lng: 127 }, { lat: 37.51, lng: 127.01 }]]
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ segments, duration: 600, distance: 750 }) })
  const origin = segments[0][0], destination = segments[0][1]
  await expect(getRouteTime({ origin, destination, mode: 'walking' })).resolves.toMatchObject({ path: segments.flat(), duration: 600, distance: 750 })
  expect(fetch).toHaveBeenCalledWith('/api/route/walking', expect.objectContaining({ body: JSON.stringify({ origin, destination, mode: 'walking' }) }))
})

test('transit retains its existing endpoint and encoded path', async () => {
  const route = { encodedPolyline: 'encoded', duration: 300, distance: 1000 }
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => route })
  await expect(getRouteTime({ origin: {}, destination: {}, mode: 'transit' })).resolves.toEqual(route)
  expect(fetch.mock.calls[0][0]).toBe('/api/route/time')
})

test('walking failures surface the server message rather than drawing a guessed route', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {})
  global.fetch = jest.fn().mockResolvedValue({ ok: false, headers: { get: () => 'application/json' }, json: async () => ({ message: '도보 경로 없음' }) })
  try {
    await expect(getRouteTime({ origin: {}, destination: {}, mode: 'walking' })).rejects.toThrow('도보 경로 없음')
  } finally { log.mockRestore() }
})
