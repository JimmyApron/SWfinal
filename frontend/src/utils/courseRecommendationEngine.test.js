import { generateCourseRecommendations, courseCombinationKey, courseOverlapCount } from './courseRecommendationEngine';
import { attachGoogleRatings } from '../api/googlePlacesApi';
jest.mock('../api/googlePlacesApi', () => ({ attachGoogleRatings: jest.fn(async places => places) }));
import { searchPlacesByKeyword } from '../api/kakaoPlacesApi';
import { buildCourseVoteDbRows, normalizeCourseVoteSelection } from './courseVoteUtils';
import { deduplicateRecommendationResult, loadRecommendationResultFromStorage, getCourseRecommendationStorageKey } from '../api/courseRecommendationApi';
import { generateRecommendationResult, saveRecommendationResultToStorage } from '../api/courseRecommendationApi';

jest.mock('../api/kakaoPlacesApi', () => ({ searchPlacesByKeyword: jest.fn() }));
const schedule = { locationlat: 37, locationlng: 127, starttime: '09:00', endtime: '21:00' };
const condition = { activities: ['cafe'], travelMode: 'walking', maxTravelMinutes: 45, minRating: 0, budget: null };
const place = (id, category = '카페', extra = {}) => ({ id: String(id), name: `${category} ${id}`, category, address: '서울', lat: 37 + id / 10000, lng: 127, rating: 4.5, price: 1000, priceSource: "test_verified_fixture", ...extra });
const run = (changes = {}, time = {}) => generateCourseRecommendations({ condition: { ...condition, ...changes }, schedule: { ...schedule, ...time } });
beforeEach(() => {
  attachGoogleRatings.mockReset().mockImplementation(async places => places);
  searchPlacesByKeyword.mockReset().mockResolvedValue(Array.from({ length: 8 }, (_, i) => place(i + 1)));
});

test('충분한 실제 후보에서 5개 서로 다른 장소 조합', async () => {
  const { courses } = await run();
  expect(courses).toHaveLength(5);
  expect(new Set(courses.map((c) => courseCombinationKey(c.stops))).size).toBe(5);
  expect(courses.every((c) => c.stops.every((s) => Number(s.id) >= 1 && Number(s.id) <= 8))).toBe(true);
  expect(new Set(courses.map(course => course.stops[0].id)).size).toBe(5);
});

test('평점이 다른 후보도 첫 장소를 고정하지 않고 중복 장소를 분산한다', async () => {
  searchPlacesByKeyword.mockResolvedValue(Array.from({ length: 12 }, (_, index) => place(index + 1, '카페', { rating: 5 - index * 0.05 })));
  const { courses } = await run({ priority: 'rating', minRating: 4 });
  expect(courses).toHaveLength(5);
  expect(new Set(courses.map(course => course.stops[0].id)).size).toBe(5);
  for (let index = 0; index < courses.length; index++) {
    for (let other = 0; other < index; other++) expect(courseOverlapCount(courses[index].stops, courses[other].stops)).toBeLessThanOrEqual(1);
  }
  const usage = new Map();
  courses.flatMap(course => course.stops).forEach(stop => usage.set(stop.id, (usage.get(stop.id) || 0) + 1));
  expect(Math.max(...usage.values())).toBeLessThanOrEqual(2);
  expect(courses[0].stops[0].id).toBe('1');
});

test('필수 첫 장소 후보가 하나뿐이면 나머지 장소를 다르게 구성한다', async () => {
  searchPlacesByKeyword.mockResolvedValue([place(1, '한식'), ...Array.from({ length: 10 }, (_, index) => place(index + 2))]);
  const { courses } = await run({ mealPreferences: { breakfast: 'korean' } }, { starttime: '09:00', endtime: '12:00' });
  expect(courses).toHaveLength(5);
  expect(courses.every(course => course.stops[0].id === '1')).toBe(true);
  expect(new Set(courses.flatMap(course => course.stops.slice(1)).map(stop => stop.id)).size).toBe(10);
});

test('4곳 이상 방문하는 추천도 다른 코스와 장소가 최대 1곳만 겹친다', async () => {
  searchPlacesByKeyword.mockResolvedValue([
    ...Array.from({ length: 4 }, (_, i) => place(i + 1, '한식')),
    ...Array.from({ length: 4 }, (_, i) => place(i + 5, '카페')),
    ...Array.from({ length: 4 }, (_, i) => place(i + 9, '공원')),
    ...Array.from({ length: 4 }, (_, i) => place(i + 13, '박물관')),
  ]);
  const { courses } = await run({ activities: ['cafe', 'walk', 'culture'], mealPreferences: { lunch: 'any' } });
  expect(courses.length).toBeGreaterThan(1);
  for (let i = 0; i < courses.length; i++) {
    expect(courses[i].stops).toHaveLength(4);
    expect(courses[i].name).toContain('맛집');
    expect(courses[i].name).toContain('카페');
    expect(courses[i].name).toContain('산책');
    expect(courses[i].name).toContain('문화·전시');
    for (let j = 0; j < i; j++) expect(courseOverlapCount(courses[i].stops, courses[j].stops)).toBeLessThanOrEqual(1);
  }
});

test('후보 부족 시 2곳 이상 중복 코스를 채우지 않으며 저장된 결과에도 같은 기준 적용', async () => {
  searchPlacesByKeyword.mockResolvedValue([place(1, '한식'), place(2), place(3, '공원'), place(4, '박물관')]);
  const { courses } = await run({ activities: ['cafe', 'walk', 'culture'], mealPreferences: { lunch: 'any' } });
  expect(courses).toHaveLength(1);
  const stops = [1, 2, 3, 4].map(id => place(id));
  const result = deduplicateRecommendationResult({ courses: [
    { id: 'a', stops },
    { id: 'b', stops: [stops[0], stops[1], stops[2], place(5)] },
    { id: 'c', stops: [stops[0], place(6), place(7), place(8)] },
    { id: 'd', stops: [stops[0], stops[1], place(9), place(10)] },
  ] });
  expect(result.courses.map(c => c.id)).toEqual(['a', 'c']);
});

test('카페만 포함한 추천 이름에는 산책·맛집 같은 활동을 붙이지 않는다', async () => {
  const { courses } = await run();
  courses.forEach(course => {
    expect(course.name).toContain('카페 코스');
    expect(course.name).not.toMatch(/산책|맛집|체험|문화/);
    expect(course.name).toContain(course.stops[0].placeName);
  });
});

test('구글 평점을 연결해 최소 평점 미달·미확인 장소를 제외하고 높은 평점부터 추천', async () => {
  searchPlacesByKeyword.mockResolvedValue([place(1), place(2), place(3), place(4), place(5)]);
  attachGoogleRatings.mockImplementationOnce(async places => places.map(p => ({ ...p, rating: ({ 1: 3.5, 2: null, 3: 4.1, 4: 4.9, 5: 4.6 })[p.id] })));
  const result = await generateRecommendationResult({ condition: { ...condition, minRating: 4, priority: 'rating' }, schedule });
  expect(attachGoogleRatings).toHaveBeenCalled();
  expect(result.condition).toMatchObject({ minRating: 4, priority: 'rating' });
  // Keep the high-rated places, but visit the closer one before backtracking.
  expect(result.courses[0].stops.map(stop => stop.id)).toEqual(['4', '3', '5']);
  expect(result.courses.every(course => course.stops.every(stop => stop.rating >= 4))).toBe(true);
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

test('저녁만 선택한 짧은 일정은 식당 3곳을 강제하지 않음', async () => {
  searchPlacesByKeyword.mockResolvedValue(Array.from({ length: 6 }, (_, i) => place(i + 1, '한식')));
  const { courses } = await run({ activities: [], mealPreferences: { dinner: 'any' } },
    { starttime: '15:30', endtime: '18:30' });
  expect(courses.length).toBeGreaterThan(0);
  expect(courses.every(c => c.stops.length === 1 && c.stops[0].mealKey === 'dinner')).toBe(true);
});

test('카페와 저녁은 추가 방문 없이도 추천하고 필수 두 방문은 유지', async () => {
  searchPlacesByKeyword.mockResolvedValue([place(1), place(2), place(3, '한식'), place(4, '한식')]);
  const { courses } = await run({ mealPreferences: { dinner: 'any' } },
    { starttime: '15:30', endtime: '18:30' });
  expect(courses.length).toBeGreaterThan(0);
  for (const course of courses) {
    expect(course.stops).toHaveLength(2);
    expect(course.stops.some(s => s.category === '카페')).toBe(true);
    expect(course.stops.some(s => s.mealKey === 'dinner')).toBe(true);
    expect(course.stops[1].visitEndTime <= '18:30').toBe(true);
  }
});

test('저녁 식사 1시간이 안 되는 일정은 필수 조건을 없애서 우회하지 않음', async () => {
  const response = await run({ mealPreferences: { dinner: 'any' } },
    { starttime: '15:30', endtime: '17:45' });
  expect(response.courses).toHaveLength(0);
  expect(response.warning).toContain('저녁');
  expect(searchPlacesByKeyword).not.toHaveBeenCalled();
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
  for (const term of ['방탈출', '볼링장', '보드게임', '공방', '카페', '박물관', '공원', '술집', '음식점']) expect(keywords).toContain(`테스트지역 ${term}`);
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

test('세 끼는 식사 사이 최소 3시간을 두고 놀거리를 각 식사 사이에 배치', async () => {
  searchPlacesByKeyword.mockResolvedValue([
    place(1, '한식'), place(2, '일식'), place(3, '양식'), place(4, '볼링장'), place(5, '볼링장'),
  ]);
  const { courses } = await run({ activities: ['bowling'], mealPreferences: { breakfast: 'korean', lunch: 'japanese', dinner: 'western' } });
  expect(courses.length).toBeGreaterThan(0);
  const minutes = value => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
  for (const course of courses) {
    expect(course.stops.map(stop => stop.mealKey || 'play')).toEqual(['breakfast', 'play', 'lunch', 'play', 'dinner']);
    const meals = course.stops.filter(stop => stop.mealKey);
    meals.forEach((meal, index) => {
      expect(meal.expectedStayMin).toBeLessThanOrEqual(60);
      if (index) expect(minutes(meal.visitStartTime) - minutes(meals[index - 1].visitEndTime)).toBeGreaterThanOrEqual(180);
    });
    expect(meals[1].visitStartTime >= '12:30').toBe(true);
    expect(meals[2].visitStartTime >= '18:00').toBe(true);
    expect(course.totalDurationMin).toBe(course.stops.reduce((total, stop) => total + stop.expectedStayMin + stop.travelTimeFromPrevMin + stop.waitingTimeMin, 0));
  }
});

test('세 끼를 간격 없이 몰아야 하는 짧은 일정에는 코스를 만들지 않음', async () => {
  searchPlacesByKeyword.mockResolvedValue([place(1, '한식'), place(2, '일식'), place(3, '양식'), place(4, '공원'), place(5, '공원')]);
  const { courses, warning } = await run({ activities: ['walk'], mealPreferences: { breakfast: 'korean', lunch: 'japanese', dinner: 'western' } }, { starttime: '10:00', endtime: '18:00' });
  expect(courses).toHaveLength(0);
  expect(warning).toContain('식사 사이에 최소 3시간');
});

test('식사만 선택하면 추가 식당 방문을 강제하지 않고 끼니 사이 간격은 유지', async () => {
  searchPlacesByKeyword.mockResolvedValue([place(1, '한식'), place(2, '일식'), place(3, '양식')]);
  const { courses } = await run({ activities: [], mealPreferences: { breakfast: 'korean', lunch: 'japanese', dinner: 'western' } });
  expect(courses).toHaveLength(1);
  expect(courses[0].stops).toHaveLength(3);
  expect(courses[0].stops.every(stop => stop.mealKey && stop.expectedStayMin <= 60)).toBe(true);
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

test('구체적인 놀거리별 검색과 분류, 활동 설명을 제공하고 식당으로 대체하지 않음', async () => {
  searchPlacesByKeyword.mockResolvedValue([
    place(1, '서비스 > 실내놀이터', { name: '함께 방탈출' }),
    place(2, '스포츠 > 볼링장'),
    place(3, '음식점 > 한식', { name: '볼링장 앞 맛집' }),
    place(4, '카페'), place(5, '관광명소'),
  ]);
  const result = await run({ activities: ['escape', 'bowling'] });
  expect(result.courses.length).toBeGreaterThan(0);
  for (const course of result.courses) {
    expect(course.stops.map(stop => stop.id).sort()).toEqual(['1', '2']);
    expect(course.stops.find(stop => stop.id === '1').activityDescription).toBe('단서를 풀며 함께 탈출하기');
    expect(course.stops.find(stop => stop.id === '2').activityDescription).toBe('볼링장에서 함께 게임하기');
  }
  const queries = searchPlacesByKeyword.mock.calls.map(([query]) => query.keyword);
  expect(queries).toContain('방탈출');
  expect(queries).toContain('볼링장');
  expect(queries).not.toContain('맛집');
  expect(queries).not.toContain('카페');
});

test('식사와 놀거리를 함께 선택해도 추가 방문은 식당 대신 놀거리로 채움', async () => {
  searchPlacesByKeyword.mockResolvedValue([
    place(1, '한식'), place(2, '한식'), place(3, '한식'),
    place(4, '볼링장'), place(5, '볼링장'),
  ]);
  const { courses } = await run({ activities: ['bowling'], mealPreferences: { lunch: 'any' } });
  expect(courses.length).toBeGreaterThan(0);
  courses.forEach(course => {
    expect(course.stops.filter(stop => stop.category === '한식')).toHaveLength(1);
    expect(course.stops.filter(stop => stop.category === '볼링장')).toHaveLength(2);
  });
});

test('기본 추천에서도 식당과 카페를 자동으로 끼워 넣지 않음', async () => {
  searchPlacesByKeyword.mockResolvedValue([place(1, '한식'), place(2, '카페'), place(3, '볼링장'), place(4, '공원')]);
  const { courses } = await run({ activities: [] });
  expect(courses.length).toBeGreaterThan(0);
  courses.forEach(course => expect(course.stops.every(stop => ['3', '4'].includes(stop.id))).toBe(true));
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
  expect(courses[0].stops.map((s) => s.id)).toEqual(['3', '2']);
  expect(courses[0].stops.find(stop => stop.id === '2').rating).toBeNull();
  expect(courses[0].estimatedCostPerPerson).toBeNull();
});
test('누락 평점/비용은 유지하되 조건 충족으로 단정하지 않고 안내', async () => {
  searchPlacesByKeyword.mockResolvedValue([place(1, '카페', { rating: null, price: null })]);
  expect((await run({ minRating: 4 })).warning).toContain('평점 기준');
  const result = await run({ budget: 10000 });
  expect(result.courses).toHaveLength(1);
  expect(result.courses[0].estimatedCostPerPerson).toBeNull();
  expect(result.warning).toContain('충족 여부를 확인할 수 없습니다');
});
test('중복 제거된 코스 ID와 장소가 선택지/저장 데이터로 그대로 전달', async () => {
  const { courses } = await run();
  courses.forEach((course, index) => expect(course.name).toMatch(new RegExp(`^${index + 1}\\. `)));
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

test('평점 제한 없이 가격·평점 누락 장소도 추천, 추정 예산은 실제 가격과 분리·복구', async () => {
  searchPlacesByKeyword.mockResolvedValue([place(1, '카페', { rating: null, price: null }), place(2, '카페', { rating: null, price: null }), place(3, '카페', { rating: null, price: null })]);
  const result = await generateRecommendationResult({ condition: { ...condition, minRating: 0, priority: 'travel', budget: 30000 }, schedule });
  expect(result.courses).toHaveLength(1);
  expect(result.condition).toMatchObject({ minRating: 0, priority: 'travel' });
  const course = result.courses[0];
  expect(course.budgetEstimate).toMatchObject({ min: 15000, max: 30000, status: 'within' });
  expect(course.estimatedCostPerPerson).toBeNull();
  expect(course.stops.every(stop => stop.rating === null && stop.estimatedCost === null)).toBe(true);
  saveRecommendationResultToStorage(40, 177, result);
  expect(loadRecommendationResultFromStorage(40, 177).courses[0].budgetEstimate).toEqual(course.budgetEstimate);
  const rows = buildCourseVoteDbRows(course);
  expect(rows.estimated_cost_per_person).toBeNull();
  expect(rows.stops[0].estimated_cost).toBeNull();
  expect(rows.recommendation_condition).toContain('걸어서 이동');
  expect(normalizeCourseVoteSelection([course])[0].estimated_cost).toBeNull();
});

test('추정 예산 최대 금액이 한도를 넘으면 추천에서 제외', async () => {
  searchPlacesByKeyword.mockResolvedValue([place(1, '카페', { price: null })]);
  const { courses, warning } = await run({ budget: 1000 });
  expect(courses).toHaveLength(0);
  expect(warning).toContain('예산');
});

test('0원은 유료·가격 미확인 장소를 제외하고 확인된 무료 장소만 추천', async () => {
  searchPlacesByKeyword.mockResolvedValue([
    place(1, '카페', { price: null }),
    place(2, '공원', { price: null }),
    place(3, '공원', { price: 0 }),
    place(4, '공원', { price: 1000 }),
  ]);
  const result = await run({ activities: ['walk'], budget: 0 });
  expect(result.courses).toHaveLength(1);
  expect(result.courses[0].stops.map(stop => stop.id)).toEqual(['3']);
  expect(result.courses[0].budgetEstimate).toMatchObject({ min: 0, max: 0, status: 'within' });
  const foodResult = await run({ activities: ['cafe'], budget: 0 });
  expect(foodResult.courses).toHaveLength(0);
  expect(foodResult.warning).toContain('예산');
});

test('0원 식사 코스 요청은 장소 검색 전에 안내하고 중단', async () => {
  const result = await run({ budget: 0, mealPreferences: { lunch: 'any' } });
  expect(result.courses).toHaveLength(0);
  expect(result.warning).toContain('1인당 예산이 0원이라 식사가 포함된 코스를 추천할 수 없어요.');
  expect(searchPlacesByKeyword).not.toHaveBeenCalled();
});

test('저녁 식사 겸 한잔은 저녁 식당 대신 주점 한 곳만 넣고 주점 비용 적용', async () => {
  searchPlacesByKeyword.mockResolvedValue([place(1, '한식'), place(2, '음식점 > 술집', { price: null })]);
  const { courses } = await run({ activities: ['bar'], barMode: 'dinner', mealPreferences: { dinner: 'korean' }, budget: 40000 });
  expect(courses).toHaveLength(1);
  expect(courses[0].barMode).toBe('dinner');
  expect(courses[0].stops).toHaveLength(1);
  expect(courses[0].stops[0]).toMatchObject({ id: '2', mealKey: 'dinner', activityKey: 'bar', activityDescription: '저녁 식사 겸 한잔', expectedStayMin: 60 });
  expect(courses[0].stops[0].visitStartTime >= '17:00').toBe(true);
  expect(courses[0].budgetEstimate).toMatchObject({ min: 15000, max: 40000 });
  expect((await run({ activities: ['bar'], barMode: 'dinner', budget: 30000 })).courses).toHaveLength(0);
});

test('저녁 먹고 2차는 저녁 식당과 주점을 순서대로 한 번씩 넣고 비용 합산', async () => {
  searchPlacesByKeyword.mockResolvedValue([place(1, '한식', { price: 12000 }), place(2, '술집', { price: 20000 })]);
  const changes = { activities: ['bar'], barMode: 'afterDinner', mealPreferences: { dinner: 'korean' }, budget: 32000 };
  const { courses } = await run(changes, { starttime: '16:00', endtime: '19:30' });
  expect(courses).toHaveLength(1);
  expect(courses[0].stops.map(stop => stop.id)).toEqual(['1', '2']);
  expect(courses[0].stops[0].mealKey).toBe('dinner');
  expect(courses[0].stops[1].activityDescription).toBe('저녁 먹고 2차');
  expect(courses[0].stops[1].visitStartTime > courses[0].stops[0].visitEndTime).toBe(true);
  expect(courses[0].stops[1].visitEndTime <= '19:30').toBe(true);
  expect(courses[0].budgetEstimate).toMatchObject({ min: 32000, max: 32000, status: 'within' });
  expect((await run({ ...changes, budget: 31000 })).courses).toHaveLength(0);
});

test('2차 선택 시 저녁이 미선택이어도 식사를 포함하고 낮 일정·0원·시간 부족은 거부', async () => {
  searchPlacesByKeyword.mockResolvedValue([place(1, '한식'), place(2, '술집')]);
  const changes = { activities: ['bar'], barMode: 'afterDinner', mealPreferences: {} };
  expect((await run(changes)).courses[0].stops.map(stop => stop.id)).toEqual(['1', '2']);
  searchPlacesByKeyword.mockClear();
  expect((await run(changes, { starttime: '10:00', endtime: '16:00' })).warning).toContain('시간');
  expect((await run(changes, { starttime: '18:00', endtime: '20:00' })).courses).toHaveLength(0);
  expect((await run({ ...changes, budget: 0 })).warning).toContain('예산이 0원');
  expect(searchPlacesByKeyword).not.toHaveBeenCalled();
});

test('추정 최대 비용의 합으로 예산을 검사하고 선택한 식사·활동은 유지', async () => {
  searchPlacesByKeyword.mockResolvedValue([place(1, '한식', { price: null }), place(2, '카페', { price: null }), place(3, '카페', { price: null })]);
  const result = await run({ mealPreferences: { lunch: 'any' }, budget: 28000 });
  expect(result.courses.length).toBeGreaterThan(0);
  result.courses.forEach(course => {
    expect(course.budgetEstimate.max).toBeLessThanOrEqual(28000);
    expect(course.stops).toHaveLength(2);
    expect(course.stops.some(stop => stop.mealKey === 'lunch')).toBe(true);
    expect(course.stops.some(stop => stop.category === '카페')).toBe(true);
  });
  expect((await run({ mealPreferences: { lunch: 'any' }, budget: 27000 })).courses).toHaveLength(0);
});

test('가격을 추정할 수 없는 활동은 예산 제한 시 제외하고 제한 없을 때 허용', async () => {
  searchPlacesByKeyword.mockResolvedValue([place(1, '공원', { price: null })]);
  expect((await run({ activities: ['walk'], budget: 10000 })).courses).toHaveLength(0);
  expect((await run({ activities: ['walk'], budget: null })).courses).toHaveLength(1);
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

test('평점 우선이어도 같은 장소들을 가까운 순서로 방문해 왕복 이동을 줄인다', async () => {
  searchPlacesByKeyword.mockResolvedValue([
    place(1, '카페', { lat: 37, rating: 5 }),
    place(2, '카페', { lat: 37.008, rating: 4.9 }),
    place(3, '카페', { lat: 37.001, rating: 4.8 }),
  ]);
  const { courses } = await run({ priority: 'rating' });
  expect(courses[0].stops.map(stop => stop.id)).toEqual(['1', '3', '2']);
  const distance = courses[0].stops.reduce((total, stop) => total + stop.distanceFromPrevM, 0);
  expect(distance).toBeLessThan(1000); // A→far→near would exceed 1.6 km.
});

test('선택 활동 입력 순서보다 가까운 활동을 먼저 배치하고 필수 활동은 유지한다', async () => {
  searchPlacesByKeyword.mockResolvedValue([
    place(1, '카페', { lat: 37, rating: 5 }),
    place(2, '박물관', { lat: 37.008, rating: 4.9 }),
    place(3, '공원', { lat: 37.001, rating: 4.8 }),
  ]);
  const { courses } = await run({ activities: ['cafe', 'culture', 'walk'], priority: 'rating' });
  expect(courses[0].stops.map(stop => stop.id)).toEqual(['1', '3', '2']);
  expect(courses[0].stops.map(stop => stop.category).sort()).toEqual(['공원', '박물관', '카페'].sort());
});
