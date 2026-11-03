import { recommendedTransitRoute } from './recommendedTransitRoute'
const origin = { lat: 37.5, lng: 127 }
const destination = { lat: 37.503, lng: 127 }
const walking = (distance, duration = 420) => ({ distance, duration, segments: [[origin, destination]] })
const transit = { duration: 600, steps: [] }

test('500m actual walking route skips transit API entirely', async () => {
  const request = jest.fn(async () => walking(500))
  expect((await recommendedTransitRoute(origin, destination, request)).mode).toBe('walking')
  expect(request.mock.calls).toEqual([['walking']])
})
test.each([[501, 400, 'walking'], [1000, 600, 'walking'], [800, 700, 'transit'], [1001, 400, 'transit']])(
  'actual distance %sm and duration %ss picks %s', async (distance, duration, mode) => {
    const request = jest.fn(async type => type === 'walking' ? walking(distance, duration) : transit)
    expect((await recommendedTransitRoute(origin, destination, request)).mode).toBe(mode)
    expect(request.mock.calls).toEqual([['walking'], ['transit']])
  }
)
test('short straight distance cannot override a detour longer than 1km', async () => {
  const request = jest.fn(async type => type === 'walking' ? walking(1800, 400) : transit)
  expect((await recommendedTransitRoute(origin, destination, request)).mode).toBe('transit')
})
test('distant pairs skip walking API to save quota', async () => {
  const request = jest.fn(async () => transit)
  expect((await recommendedTransitRoute(origin, { lat: 37.6, lng: 127 }, request)).mode).toBe('transit')
  expect(request.mock.calls).toEqual([['transit']])
})
test('walking lookup failure still returns transit', async () => {
  const request = jest.fn(async type => { if (type === 'walking') throw new Error('unavailable'); return transit })
  expect((await recommendedTransitRoute(origin, destination, request)).data).toBe(transit)
})
test('unknown walking time does not win a 500m–1km comparison', async () => {
  const request = jest.fn(async type => type === 'walking' ? walking(800, null) : transit)
  expect((await recommendedTransitRoute(origin, destination, request)).mode).toBe('transit')
})
