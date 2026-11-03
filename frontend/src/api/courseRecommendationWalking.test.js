import { applyWalkingRouteTimes } from './courseRecommendationApi';

const stop = (id, latitude, longitude) => ({ id, placeName: `장소 ${id}`, latitude, longitude, travelTimeFromPrevMin: 5 });

afterEach(() => { delete global.fetch; });

test('도보 구간 시간을 실제 경로의 시간·거리로 바꾸고 실패한 구간은 추정치를 유지', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ duration: 1200, distance: 1500 }) })
    .mockResolvedValueOnce({ ok: false, json: async () => ({}) });
  const course = { stops: [stop(1, 37.5, 127.0), stop(2, 37.51, 127.01), stop(3, 37.52, 127.02)], estimatedTravelTimeMin: 10 };
  const result = await applyWalkingRouteTimes(course);
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(global.fetch.mock.calls[0][0]).toMatch(/\/route\/walking$/);
  expect(result.stops[1]).toMatchObject({ travelTimeFromPrevMin: 20, distanceFromPrevM: 1500 });
  expect(result.stops[2].travelTimeFromPrevMin).toBe(5);
  expect(result.estimatedTravelTimeMin).toBe(25);
});

test('좌표가 없는 장소와 첫 장소는 조회하지 않는다', async () => {
  global.fetch = jest.fn();
  const course = { stops: [stop(1, 37.5, 127.0), stop(2, null, null)], estimatedTravelTimeMin: 5 };
  const result = await applyWalkingRouteTimes(course);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(result.stops[1].travelTimeFromPrevMin).toBe(5);
});
