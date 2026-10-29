import { generateCourseRecommendations, courseCombinationKey } from './courseRecommendationEngine';
import { searchPlacesByKeyword } from '../api/kakaoPlacesApi';
import { buildCourseVoteDbRows, normalizeCourseVoteSelection } from './courseVoteUtils';
import { deduplicateRecommendationResult, loadRecommendationResultFromStorage, getCourseRecommendationStorageKey } from '../api/courseRecommendationApi';
import { generateRecommendationResult, saveRecommendationResultToStorage } from '../api/courseRecommendationApi';

jest.mock('../api/kakaoPlacesApi', () => ({ searchPlacesByKeyword: jest.fn() }));
const schedule = { locationlat: 37, locationlng: 127, starttime: '09:00', endtime: '21:00' };
const condition = { activities: ['cafe'], travelMode: 'walking', maxTravelMinutes: 45, minRating: 0, budget: null };
const place = (id, category = '카페', extra = {}) => ({ id: String(id), name: `${category} ${id}`, category, address: '서울', lat: 37 + id / 10000, lng: 127, rating: 4.5, price: 1000, priceSource: "test_verified_fixture", ...extra });
const run = (changes = {}, time = {}) => generateCourseRecommendations({ condition: { ...condition, ...changes }, schedule: { ...schedule, ...time } });
beforeEach(() => searchPlacesByKeyword.mockReset().mockResolvedValue(Array.from({ length: 8 }, (_, i) => place(i + 1))));

test('충분한 실제 후보에서 5개 서로 다른 장소 조합', async () => {
  const { courses } = await run();
  expect(courses).toHaveLength(5);
  expect(new Set(courses.map((c) => courseCombinationKey(c.stops))).size).toBe(5);
  expect(courses.every((c) => c.stops.every((s) => Number(s.id) >= 1 && Number(s.id) <= 8))).toBe(true);
});
test('동일 장소 집합의 순서만 바뀐 코스도 중복으로 판단', () => {
  expect(courseCombinationKey([{ id: '1' }, { id: '2' }])).toBe(courseCombinationKey([{ id: '2' }, { id: '1' }]));
});
test('검색별 동일 ID의 주소 표기 차이로 후보를 부풀리지 않음', async () => {
  searchPlacesByKeyword.mockResolvedValue([place(1), place(1, '카페', { address: '다른 표기' }), place(2), place(3)]);
  const { courses } = await run();
  expect(courses).toHaveLength(1);
  expect(new Set(courses[0].stops.map((s) => s.id)).size).toBe(3);
});
test.each([1, 2, 3])('후보 %i개면 가능한 1개 조합만 반환', async (count) => {
  searchPlacesByKeyword.mockResolvedValue(Array.from({ length: count }, (_, i) => place(i + 1)));
  const { courses } = await run();
  expect(courses).toHaveLength(1);
  expect(courses[0].stops).toHaveLength(count);
});
test('빈 후보는 빈 코스와 안내', async () => {
  searchPlacesByKeyword.mockResolvedValue([]);
  expect((await run()).courses).toEqual([]);
});
test('저녁 일정에 아침 요청은 검색 전 거부', async () => {
  const response = await run({ mealPreferences: { breakfast: 'any' } }, { starttime: '18:00', endtime: '22:00' });
  expect(response.courses).toHaveLength(0);
  expect(response.warning).toContain('시간대에 맞지 않는');
  expect(searchPlacesByKeyword).not.toHaveBeenCalled();
});
test('사용자가 선택한 중심/반경 우선 적용, 원 밖 후보 제외', async () => {
  searchPlacesByKeyword.mockResolvedValue([place(1, '카페', { lat: 35, lng: 129 }), place(2, '카페', { lat: 35.001, lng: 129 }), place(3, '카페', { lat: 37, lng: 127 })]);
  const response = await run({ searchCenter: { lat: 35, lng: 129 }, searchRadiusMeters: 1000 });
  expect(searchPlacesByKeyword).toHaveBeenCalledWith(expect.objectContaining({ lat: 35, lng: 129, radius: 1000 }));
  expect(response.center.source).toBe('selected_area');
  expect(response.courses[0].stops.map((stop) => stop.id)).toEqual(['1', '2']);
});
test('잘못된 선택 중심/반경은 검색 전에 거부', async () => {
  expect((await run({ searchCenter: { lat: null, lng: null } })).courses).toHaveLength(0);
  expect((await run({ searchRadiusMeters: 20001 })).courses).toHaveLength(0);
  expect(searchPlacesByKeyword).not.toHaveBeenCalled();
});
test('좌표 없는 일정도 지역과 선택 장소 유형을 함께 검색하며 임의 중심을 사용하지 않음', async () => {
  searchPlacesByKeyword.mockImplementation(async ({ keyword }) => keyword === '테스트지역' ? [] : [place(1), place(2), place(3), place(4)]);
  const response = await run({ preferredRegion: '테스트지역' }, { locationlat: null, locationlng: null });
  expect(searchPlacesByKeyword).toHaveBeenCalledWith(expect.objectContaining({ keyword: '테스트지역 카페', lat: null, lng: null }));
  expect(response.courses.length).toBeGreaterThan(0);
  expect(searchPlacesByKeyword.mock.calls.every(([query]) => query.lat == null && query.lng == null)).toBe(true);
});
test('좌표 없는 5개 활동/3개 식사 조건의 검색어 유지, 필수 슬롯은 완화하지 않음', async () => {
  searchPlacesByKeyword.mockResolvedValue([]);
  await run({ preferredRegion: '테스트지역', activities: ['experience', 'cafe', 'culture', 'walk', 'bar'], mealPreferences: { breakfast: 'any', lunch: 'any', dinner: 'any' } }, { locationlat: null, locationlng: null });
  const keywords = searchPlacesByKeyword.mock.calls.map(([query]) => query.keyword);
  for (const term of ['체험', '카페', '박물관', '공원', '술집', '음식점']) expect(keywords).toContain(`테스트지역 ${term}`);
  expect(new Set(keywords).size).toBe(keywords.length);
});
test('아침/점심/저녁별 음식 선호와 선택 활동 모두 유지', async () => {
  searchPlacesByKeyword.mockResolvedValue([place(1, '한식'), place(2, '일식'), place(3, '양식'), place(4, '카페'), place(5, '카페')]);
  const { courses } = await run({ mealPreferences: { breakfast: 'korean', lunch: 'japanese', dinner: 'western' } });
  expect(courses.length).toBeGreaterThan(0);
  for (const course of courses) {
    expect(course.stops.find((s) => s.mealKey === 'breakfast').category).toBe('한식');
    expect(course.stops.find((s) => s.mealKey === 'lunch').category).toBe('일식');
    expect(course.stops.find((s) => s.mealKey === 'dinner').category).toBe('양식');
    expect(course.stops.some((s) => s.category === '카페')).toBe(true);
  }
});
test('음식 선호를 만족할 식당 없으면 임의 대체 안 함', async () => {
  expect((await run({ mealPreferences: { lunch: 'korean' } })).courses).toHaveLength(0);
});
test('카페와 산책 선택이면 둘 다 포함, 무관한 장소로 채우지 않음', async () => {
  searchPlacesByKeyword.mockResolvedValue([place(1), place(2), place(3, '공원'), place(4, '박물관')]);
  const { courses } = await run({ activities: ['cafe', 'walk'] });
  expect(courses.length).toBeGreaterThan(0);
  courses.forEach((c) => {
    expect(c.stops.some((s) => s.category === '공원')).toBe(true);
    expect(c.stops.some((s) => s.category === '카페')).toBe(true);
    expect(c.stops.some((s) => s.category === '박물관')).toBe(false);
  });
});
test('방문 시간 누적, 이동 제한과 일정 종료 준수', async () => {
  const minutes = (t) => t.split(':').reduce((h, m) => Number(h) * 60 + Number(m));
  const { courses } = await run({}, { starttime: '10:00:00', endtime: '14:00:00' });
  expect(courses.length).toBeGreaterThan(0);
  courses.forEach((c) => {
    c.stops.forEach((s, index) => {
      expect(s.order).toBe(index + 1);
      expect(s.travelTimeFromPrevMin).toBeLessThanOrEqual(45);
      if (index) expect(minutes(s.visitStartTime)).toBe(minutes(c.stops[index - 1].visitEndTime) + s.travelTimeFromPrevMin);
    });
    expect(minutes(c.stops[c.stops.length - 1].visitEndTime)).toBeLessThanOrEqual(14 * 60);
    expect(c.totalDurationMin).toBe(c.stops.reduce((sum, s) => sum + s.expectedStayMin + s.travelTimeFromPrevMin, 0));
  });
});
test('이동 제한을 초과하는 장소 조합 거부', async () => {
  searchPlacesByKeyword.mockResolvedValue([place(1), place(2, '카페', { lat: 38 }), place(3, '카페', { lat: 39 })]);
  expect((await run({ maxTravelMinutes: 10 })).courses).toHaveLength(0);
});
test.each([{ starttime: '10:00', endtime: '10:30' }, { starttime: '25:00' }, { starttime: '20:00', endtime: '10:00' }])('부족하거나 잘못된 일정 범위 거부 %j', async (times) => {
  expect((await run({}, times)).courses).toHaveLength(0);
});
test('최소 평점과 코스 총예산 초과 장소/조합 제외', async () => {
  searchPlacesByKeyword.mockResolvedValue([place(1), place(2), place(3), place(4, '카페', { rating: 3 }), place(5, '카페', { price: 5000 })]);
  const { courses } = await run({ minRating: 4, budget: 3500 });
  expect(courses).toHaveLength(1);
  expect(courses[0].estimatedCostPerPerson).toBe(3000);
});
test('누락 좌표 제외, 제약 없는 누락 평점/비용은 null 유지', async () => {
  searchPlacesByKeyword.mockResolvedValue([place(1, '카페', { lat: null }), place(2, '카페', { rating: null, price: null }), place(3)]);
  const { courses } = await run();
  expect(courses[0].stops.map((s) => s.id)).toEqual(['2', '3']);
  expect(courses[0].stops[0].rating).toBeNull();
  expect(courses[0].estimatedCostPerPerson).toBeNull();
});
test('누락 평점/비용은 유지하되 조건 충족으로 단정하지 않고 안내', async () => {
  searchPlacesByKeyword.mockResolvedValue([place(1, '카페', { rating: null, price: null })]);
  expect((await run({ minRating: 4 })).warning).toContain('충족 여부를 확인할 수 없습니다');
  const result = await run({ budget: 5000 });
  expect(result.courses).toHaveLength(1);
  expect(result.courses[0].estimatedCostPerPerson).toBeNull();
  expect(result.warning).toContain('충족 여부를 확인할 수 없습니다');
});
test('중복 제거된 코스 ID와 장소가 선택지/저장 데이터로 그대로 전달', async () => {
  const { courses } = await run();
  const selected = [courses[0], courses[2]];
  expect(normalizeCourseVoteSelection(selected).map((o) => o.courseid)).toEqual(selected.map((c) => c.id));
  expect(new Set(selected.map((c) => courseCombinationKey(buildCourseVoteDbRows(c).stops)))).toHaveProperty('size', 2);
});
test('이전 화면 state와 캐시에 남은 이름만 다른 중복도 복구 시 제거', async () => {
  const { courses } = await run();
  const old = { courses: [courses[0], { ...courses[0], id: 'renamed', name: '다른 이름', stops: [...courses[0].stops].reverse() }, courses[1]] };
  expect(deduplicateRecommendationResult(old).courses.map((c) => c.id)).toEqual([courses[0].id, courses[1].id]);
  localStorage.setItem(getCourseRecommendationStorageKey(1, 2), JSON.stringify(old));
  expect(loadRecommendationResultFromStorage(1, 2).courses).toHaveLength(2);
  localStorage.clear();
});
test('외부 검색 실패는 가짜 코스 없이 빈 결과', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  searchPlacesByKeyword.mockRejectedValue(new Error('offline'));
  expect((await run()).courses).toHaveLength(0);
  warn.mockRestore();
});

test('카카오 가격·평점 누락과 과거 평점 조건에도 추천, 추정 예산은 실제 가격과 분리·복구', async () => {
  searchPlacesByKeyword.mockResolvedValue([place(1, '카페', { rating: null, price: null }), place(2, '카페', { rating: null, price: null }), place(3, '카페', { rating: null, price: null })]);
  const result = await generateRecommendationResult({ condition: { ...condition, minRating: 4.5, priority: 'rating', budget: 20000 }, schedule });
  expect(result.courses).toHaveLength(1);
  expect(result.condition).toMatchObject({ minRating: 0, priority: 'travel' });
  const course = result.courses[0];
  expect(course.budgetEstimate).toMatchObject({ min: 15000, max: 30000, status: 'uncertain' });
  expect(course.estimatedCostPerPerson).toBeNull();
  expect(course.stops.every(stop => stop.rating === null && stop.estimatedCost === null)).toBe(true);
  saveRecommendationResultToStorage(40, 177, result);
  expect(loadRecommendationResultFromStorage(40, 177).courses[0].budgetEstimate).toEqual(course.budgetEstimate);
  const rows = buildCourseVoteDbRows(course);
  expect(rows.estimated_cost_per_person).toBeNull();
  expect(rows.stops[0].estimated_cost).toBeNull();
  expect(rows.recommendation_condition).toContain('카테고리별 추정');
  expect(normalizeCourseVoteSelection([course])[0].estimated_cost).toBeNull();
});

test('추정 예산 초과는 코스를 삭제하지 않고 초과로 표시', async () => {
  searchPlacesByKeyword.mockResolvedValue([place(1, '카페', { price: null })]);
  const { courses } = await run({ budget: 1000 });
  expect(courses).toHaveLength(1);
  expect(courses[0].budgetEstimate.status).toBe('over');
});

test('좌표 유무와 무관하게 한국어 유형 검색, 중복 요청 제거', async () => {
  await run({ activities: ['culture', 'cafe'] });
  const keywords = searchPlacesByKeyword.mock.calls.map(([query]) => query.keyword);
  expect(keywords).toContain('카페');
  expect(keywords).toContain('박물관');
  expect(keywords).not.toContain('museum');
  expect(new Set(keywords).size).toBe(keywords.length);
});

test('저녁 전에 카페 방문이 가능한 일정은 식사 슬롯 뒤로 강제하지 않음', async () => {
  searchPlacesByKeyword.mockResolvedValue([place(1, '음식점'), place(2), place(3)]);
  const { courses } = await run({ mealPreferences: { dinner: 'any' } }, { starttime: '15:00', endtime: '18:30' });
  expect(courses.length).toBeGreaterThan(0);
  expect(courses[0].stops[0].category).toBe('카페');
  expect(courses[0].stops[2].mealKey).toBe('dinner');
});

test('예산 우선은 출처가 있는 저비용 후보를 먼저 추천', async () => {
  searchPlacesByKeyword.mockResolvedValue([place(1, '카페', { price: 9000 }), place(2), place(3), place(4), place(5)]);
  const { courses } = await run({ priority: 'budget' });
  expect(courses[0].stops.every(stop => stop.id !== '1')).toBe(true);
  expect(courses[0].budgetEstimate.max).toBe(3000);
});

test('거리 우선은 이전 장소와 가까운 후보를 먼저 선택', async () => {
  searchPlacesByKeyword.mockResolvedValue([place(1), place(2, '카페', { lat: 37.02 }), place(3), place(4)]);
  const { courses } = await run({ priority: 'travel' });
  expect(courses[0].stops.map(stop => stop.id)).toEqual(['1', '3', '4']);
});
