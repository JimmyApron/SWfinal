import { buildManualCourse } from './manualCourseUtils';
import { buildCourseVoteDbRows } from './courseVoteUtils';

const schedule = { starttime: '15:30', endtime: '18:00' };
const stops = [
  { id: '1', name: '카페', lat: 37.55, lng: 126.92, expectedStayMin: 45 },
  { id: '2', name: '식당', lat: 37.5501, lng: 126.9201, expectedStayMin: 45 },
];
const input = { name: '홍대 산책', stops, startTime: '15:30', travelMode: 'walking' };

test('직접 만든 식사는 추천 끼니 제약 없이 시간·체류·이동을 누적하고 DB 필드로 전달', () => {
  const { course, errors } = buildManualCourse(input, schedule);
  expect(errors).toEqual([]);
  expect(course.stops[0].visitStartTime).toBe('15:30');
  expect(course.stops[1].visitStartTime).toBe('16:20');
  expect(course.totalDurationMin).toBe(95);
  const rows = buildCourseVoteDbRows(course);
  expect(rows.estimated_cost_per_person).toBeNull();
  expect(rows.stops[1]).toMatchObject({ place_id: '2', place_source: 'kakao', expected_stay_min: 45,
    visit_start_time: '16:20', visit_end_time: '17:05', estimated_cost: null });
});

test('일정 초과분을 정확히 안내하고 불가능한 코스의 후보 추가를 막을 수 있음', () => {
  const result = buildManualCourse({ ...input, stops: stops.map(s => ({ ...s, expectedStayMin: 90 })) }, schedule);
  expect(result.overMinutes).toBe(35);
  expect(result.errors.join()).toContain('35분 초과');
});

test.each([
  { name: '' }, { stops: [] }, { startTime: '14:00' },
  { stops: [stops[0], stops[0]] },
  { stops: [{ ...stops[0], lat: '' }] },
  { stops: [{ ...stops[0], expectedStayMin: 0 }] },
  { stops: [{ ...stops[0], expectedStayMin: 1.5 }] },
])('잘못된 직접 코스 입력 거부 %j', changes => {
  expect(buildManualCourse({ ...input, ...changes }, schedule).errors.length).toBeGreaterThan(0);
});

test('순서 변경은 방문 순서와 시간표를 함께 재계산', () => {
  const { course } = buildManualCourse({ ...input, stops: [...stops].reverse() }, schedule);
  expect(course.stops.map(s => s.id)).toEqual(['2', '1']);
  expect(course.stops[0].visitStartTime).toBe('15:30');
});
