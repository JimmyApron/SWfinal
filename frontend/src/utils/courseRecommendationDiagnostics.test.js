import { generateCourseRecommendations } from './courseRecommendationEngine';
import { searchPlacesByKeyword } from '../api/kakaoPlacesApi';
jest.mock('../api/kakaoPlacesApi', () => ({ searchPlacesByKeyword: jest.fn() }));
const condition = { activities: ['cafe'], travelMode: 'walking', minRating: 4, budget: 10000 };
const schedule = { locationlat: 37, locationlng: 127, starttime: '10:00', endtime: '18:00' };
const place = (id, extra = {}) => ({ id, name: '카페', category: '카페', lat: 37, lng: 127, rating: 5, price: 1000, ...extra });
let oldEnvironment;
let log;
beforeEach(() => {
  oldEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  log = jest.spyOn(console, 'info').mockImplementation(() => {});
  searchPlacesByKeyword.mockReset();
});
afterEach(() => { process.env.NODE_ENV = oldEnvironment; log.mockRestore(); });
const result = () => JSON.parse(log.mock.calls.find(([tag]) => tag === '[MeetUP course diagnostic]')[1]);
test('검색/중복/좌표/평점/예산/카테고리별 건수와 성공 조합 수', async () => {
  searchPlacesByKeyword.mockResolvedValue([place('a'), place('b', { lat: null }), place('c', { rating: 2 }), place('d', { price: 20000 }), place('e', { name: '박물관', category: '박물관' })]);
  await generateCourseRecommendations({ condition, schedule });
  expect(result().search).toMatchObject({ planned: 3, succeeded: 3, failed: 0, rawCount: 15, uniqueCount: 5, duplicateExcluded: 10, coordinateExcluded: 1, coordinateValid: 4 });
  expect(result().filter).toMatchObject({ ratingExcluded: 1, priceExcluded: 1, categoryExcluded: 1, candidates: 1, requiredSlots: 1, targetSlots: 1 });
  expect(result().combination.accepted).toBe(1);
});
test('API 실패와 정상 응답 0개 구분, HTTP 상태는 추정하지 않음', async () => {
  searchPlacesByKeyword.mockRejectedValue(Object.assign(new Error('secret token'), { searchStage: 'sdk_load' }));
  await generateCourseRecommendations({ condition, schedule });
  expect(result().outcome).toBe('api_failure_all');
  expect(result().search.requests[0]).toMatchObject({ failureStage: 'sdk_load', httpStatus: null, outcome: 'failure' });
  log.mockClear();
  searchPlacesByKeyword.mockResolvedValue([]);
  await generateCourseRecommendations({ condition, schedule });
  expect(result().outcome).toBe('search_empty');
  expect(result().search.empty).toBe(3);
});
test('후보 있지만 시간 조합 실패 구분', async () => {
  searchPlacesByKeyword.mockResolvedValue([place('a'), place('b'), place('c')]);
  await generateCourseRecommendations({ condition, schedule: { ...schedule, endtime: '10:30' } });
  expect(result().outcome).toBe('no_combination');
  expect(result().filter).toMatchObject({ availableMinutes: 30, minimumStayMinutes: 180, candidates: 3 });
  expect(result().combination.timeLimitExcluded).toBe(3);
});
test('필수 음식 슬롯의 후보 0개와 활동 슬롯 후보 구분', async () => {
  searchPlacesByKeyword.mockResolvedValue([place('a'), place('b'), place('c')]);
  await generateCourseRecommendations({ condition: { ...condition, mealPreferences: { lunch: 'korean' } }, schedule });
  expect(result().filter.slotMatches.map((s) => s.matches)).toEqual([0, 3]);
  expect(result().combination.slotMismatchExcluded).toBe(3);
});
test('이동 한도 및 코스 합산 예산 제외 기록', async () => {
  searchPlacesByKeyword.mockResolvedValue([place('a'), place('b', { lat: 38 }), place('c', { lat: 39 })]);
  await generateCourseRecommendations({ condition: { ...condition, maxTravelMinutes: 1 }, schedule });
  expect(result().combination.travelLimitExcluded).toBeGreaterThan(0);
  log.mockClear();
  searchPlacesByKeyword.mockResolvedValue([place('a'), place('b'), place('c')]);
  await generateCourseRecommendations({ condition: { ...condition, budget: 2500 }, schedule });
  expect(result().combination.totalBudgetExcluded).toBeGreaterThan(0);
});
test('SDK 콜백 상태만 허용하고 개인정보/원본 오류 출력 안 함', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  searchPlacesByKeyword.mockImplementation(async ({ onDiagnostic }) => { onDiagnostic({ sdkStatus: 'OK', body: 'SECRET' }); return [place('private-id')]; });
  await generateCourseRecommendations({ condition: { ...condition, preferredRegion: 'PRIVATE_ADDRESS', notes: 'SECRET' }, schedule });
  const output = JSON.stringify(log.mock.calls);
  for (const secret of ['PRIVATE_ADDRESS', 'private-id', 'SECRET', 'Authorization']) expect(output).not.toContain(secret);
  expect(result().search.requests[0].sdkStatus).toBe('OK');
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});
test('production은 성공·실패 모두 진단 로그 미출력, 반환 구조 유지', async () => {
  process.env.NODE_ENV = 'production';
  searchPlacesByKeyword.mockResolvedValue([place('a')]);
  const response = await generateCourseRecommendations({ condition, schedule });
  expect(response).not.toHaveProperty('diagnostics');
  expect(log).not.toHaveBeenCalled();
  searchPlacesByKeyword.mockRejectedValue(new Error('PRIVATE'));
  await generateCourseRecommendations({ condition, schedule });
  expect(log).not.toHaveBeenCalled();
});
