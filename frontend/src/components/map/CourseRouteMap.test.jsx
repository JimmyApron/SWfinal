import { render, screen, waitFor, within } from '@testing-library/react'
import CourseRouteMap from './CourseRouteMap'
import KakaoMapView from './KakaoMapView'
jest.mock('./KakaoMapView', () => jest.fn(() => <div>map</div>))
const places = [{ lat: 37, lng: 127, orderNumber: 1 }, { lat: 38, lng: 128, orderNumber: 2 }]
beforeEach(() => { global.fetch = jest.fn(); KakaoMapView.mockClear() })
test('renders road geometry including intermediate turns instead of joining stops', async () => {
  const path = [{ lat: 37, lng: 127 }, { lat: 38, lng: 127 }, { lat: 38, lng: 128 }]
  fetch.mockResolvedValue({ ok: true, json: async () => ({ segments: [path], duration: 180 }) })
  render(<CourseRouteMap places={places} travelMode="walking" allowWalkingLookup />)
  expect(await screen.findByText('실제 도보 경로 · 총 이동 약 3분')).toBeInTheDocument()
  const props = KakaoMapView.mock.calls.at(-1)[0]
  expect(props.memberRoutePaths[0].path).toEqual(path)
  expect(props.routePath).toBeUndefined()
  expect(fetch.mock.calls[0][0]).toContain('/route/walking')
})
test('failed lookup clears lines and never draws a straight fallback', async () => {
  fetch.mockResolvedValue({ ok: false, json: async () => ({ message: '도보 경로 없음' }) })
  render(<CourseRouteMap places={places} travelMode="walking" allowWalkingLookup />)
  expect(await screen.findByText('도보 경로 없음')).toBeInTheDocument()
  expect(KakaoMapView.mock.calls.at(-1)[0].memberRoutePaths).toEqual([])
})
test('missing intermediate stop does not create a shortcut', async () => {
  render(<CourseRouteMap places={[places[0], { ...places[1], orderNumber: 3 }]} travelMode="walking" allowWalkingLookup />)
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('일부 장소의 좌표'))
  expect(fetch).not.toHaveBeenCalled()
})

test('does not request walking routes outside the recommendation screen', async () => {
  render(<CourseRouteMap places={places} travelMode="walking" />)
  expect(await screen.findByText('도보 경로 조회는 코스 추천 화면에서만 제공합니다.')).toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()
  expect(KakaoMapView.mock.calls.at(-1)[0].memberRoutePaths).toEqual([])
})

test.each([['car', '/kakao/route'], ['transit', '/route/time']])('%s routes never call the walking API', async (mode, endpoint) => {
  fetch.mockResolvedValue({ ok: false, json: async () => ({ message: 'test finished' }) })
  render(<CourseRouteMap places={places} travelMode={mode} allowWalkingLookup />)
  await screen.findByText('test finished')
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0][0]).toContain(endpoint)
  expect(fetch.mock.calls[0][0]).not.toContain('/route/walking')
})

test('car course displays all road vertices returned by Kakao', async () => {
  const path = [{ lat: 37, lng: 127 }, { lat: 37.1, lng: 127 }, { lat: 38, lng: 128 }]
  fetch.mockResolvedValue({ ok: true, json: async () => ({ path, duration: 300 }) })
  render(<CourseRouteMap places={places} travelMode="car" />)
  await screen.findByText('실제 자동차 경로 · 총 이동 약 5분')
  expect(KakaoMapView.mock.calls.at(-1)[0].memberRoutePaths).toEqual([{ mode: 'car', path }])
  const details = within(screen.getByRole('region', { name: '구간별 실제 이동 안내' }))
  expect(details.getByText('자동차')).toBeInTheDocument()
  expect(details.getByText('약 5분')).toBeInTheDocument()
})

test('transit course displays Google step geometry and distinguishes walking sections', async () => {
  const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@'
  fetch.mockResolvedValue({ ok: true, json: async () => ({ duration: 600, steps: [
    { travelMode: 'WALKING', encodedPolyline: encoded, duration: 180 },
    { travelMode: 'TRANSIT', encodedPolyline: encoded, duration: 420, transitDetails: { lineShortName: '1호선' } },
  ] }) })
  render(<CourseRouteMap places={places} travelMode="transit" />)
  await screen.findByText('실제 대중교통 경로 · 총 이동 약 10분')
  const routes = KakaoMapView.mock.calls.at(-1)[0].memberRoutePaths
  expect(routes.map(route => route.mode)).toEqual(['walking', 'transit'])
  expect(routes[0].path).toHaveLength(3)
  expect(routes[0].path[1]).toEqual({ lat: 40.7, lng: -120.95 })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0][0]).toContain('/route/time')
  const details = within(screen.getByRole('region', { name: '구간별 실제 이동 안내' }))
  expect(details.getByText('대중교통')).toBeInTheDocument()
  expect(details.getByText('약 10분')).toBeInTheDocument()
  expect(details.getByText('세부 구간: 도보 약 3분 → 1호선 약 7분')).toBeInTheDocument()
})

test('a failed section does not erase the other real walking routes', async () => {
  const path = [{ lat: 37, lng: 127 }, { lat: 37.5, lng: 127 }, { lat: 38, lng: 128 }]
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ segments: [path], duration: 180 }) })
    .mockResolvedValueOnce({ ok: false, json: async () => ({ message: '이 구간의 경로가 없습니다.' }) })
  render(<CourseRouteMap places={[...places, { lat: 38.1, lng: 128.1, orderNumber: 3 }]} travelMode="walking" allowWalkingLookup />)
  await screen.findByText(/일부 경로만 표시됩니다/)
  expect(KakaoMapView.mock.calls.at(-1)[0].memberRoutePaths).toEqual([{ mode: 'walking', path }])
  expect(screen.getByRole('status')).toHaveTextContent('2→3: 이 구간의 경로가 없습니다.')
  expect(screen.getByRole('status')).not.toHaveTextContent('총 이동 약')
})

test('recommendation transit mode compares short walks using TMAP and retains detailed timing', async () => {
  const closePlaces = [{ lat: 37.5, lng: 127, orderNumber: 1 }, { lat: 37.503, lng: 127, orderNumber: 2 }]
  const path = [closePlaces[0], { lat: 37.502, lng: 127.001 }, closePlaces[1]]
  fetch.mockResolvedValue({ ok: true, json: async () => ({ distance: 450, duration: 360, segments: [path] }) })
  render(<CourseRouteMap places={closePlaces} travelMode="transit" allowWalkingLookup />)
  await screen.findByText('실제 대중교통 경로 · 가까운 1구간은 도보 추천 · 총 이동 약 6분')
  expect(KakaoMapView.mock.calls.at(-1)[0].memberRoutePaths).toEqual([{ mode: 'walking', path }])
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0][0]).toContain('/route/walking')
  const details = within(screen.getByRole('region', { name: '구간별 실제 이동 안내' }))
  expect(details.getByText('도보 · 가까운 구간 도보 추천')).toBeInTheDocument()
  expect(details.getByText('약 6분')).toBeInTheDocument()
  expect(details.getByText('450m')).toBeInTheDocument()
})
