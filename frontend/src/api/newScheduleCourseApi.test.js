import { supabase } from '../lib/supabaseClient';
import { mockDatabase } from '../testUtils/mockDatabase';
import { saveNewScheduleWithCourse, validateNewScheduleCourse } from './newScheduleCourseApi';
import { finalizeDirectCourse } from './courseFinalizationApi';
import { getFinalizedRoadmap } from './courseRoadmapApi';
import { buildManualCourse } from '../utils/manualCourseUtils';
import { normalizeCourseVoteSelection } from '../utils/courseVoteUtils';

jest.mock('../lib/supabaseClient', () => ({ supabase: { from: jest.fn(), auth: { getUser: jest.fn() } } }));
jest.mock('./notificationApi', () => ({ createRoomNotifications: jest.fn() }));
jest.mock('./mapApi', () => ({ updateRoomLocationTransportModes: jest.fn() }));
const schedule = { roomid: 1, title: '새 약속', date: '2099-11-01', starttime: '15:30', endtime: '18:00', isallday: false };
const course = buildManualCourse({ name: '카페와 식사', startTime: '15:30', travelMode: 'walking',
  stops: [{ id: '11', name: '카페', lat: 37.55, lng: 126.92, expectedStayMin: 40 },
    { id: '12', name: '식당', lat: 37.5501, lng: 126.9201, expectedStayMin: 50 }] }, schedule).course;
const courses = normalizeCourseVoteSelection([{ ...course, id: 'draft-course' }]);
let db, adapter;
beforeEach(() => {
  localStorage.clear();
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'member-a' } }, error: null });
  db = Object.fromEntries(['confirmed_schedules', 'schedule_creation_records', 'courses', 'course_stops', 'votes', 'voteoptions',
    'vote_course_links', 'voteresponses', 'schedule_finalizations', 'course_member_confirmations', 'profiles'].map(table => [table, []]));
  db.rooms = [{ id: 1, roomname: '테스트 모임' }];
  db.room_members = [{ roomid: 1, userid: 'member-a' }, { roomid: 1, userid: 'member-b' }];
  db.room_guests = [{ id: 'guest-a', roomid: 1 }];
  adapter = mockDatabase(supabase, db);
});

test('코스 없는 새 일정은 기존 생성자 기록과 일정만 생성', async () => {
  const saved = await saveNewScheduleWithCourse({ schedule, mode: 'none' });
  expect(saved.schedule.title).toBe('새 약속');
  expect(db.confirmed_schedules).toHaveLength(1);
  expect(db.schedule_creation_records).toHaveLength(1);
  expect(db.courses).toHaveLength(0);
  expect(db.votes).toHaveLength(0);
});

test('새 일정과 직접 코스는 투표를 만들지 않고 최종 로드맵에 연결', async () => {
  const saved = await saveNewScheduleWithCourse({ schedule, mode: 'direct', courses, selectedCourseId: 'draft-course' });
  expect(db.votes).toHaveLength(0);
  expect(db.schedule_finalizations).toHaveLength(1);
  const roadmap = await getFinalizedRoadmap(1, saved.schedule.id);
  expect(roadmap.course.stops.map(stop => stop.place_name)).toEqual(['카페', '식당']);
  expect(roadmap.course.estimated_cost_per_person).toBeNull();
});

test('새 일정에 여러 코스 후보를 저장하고 열린 투표 생성, 최종 확정은 보류', async () => {
  const others = normalizeCourseVoteSelection([{ ...course, id: 'other', name: '다른 코스' }]);
  const saved = await saveNewScheduleWithCourse({ schedule, mode: 'vote', courses: [...courses, ...others], voteTitle: '어디 갈까요?' });
  expect(saved.vote.title).toBe('어디 갈까요?');
  expect(db.courses).toHaveLength(2);
  expect(db.vote_course_links).toHaveLength(2);
  expect(db.votes[0].scheduleid).toBe(saved.schedule.id);
  expect(db.schedule_finalizations).toHaveLength(0);
});

test('코스 저장 실패 후 같은 화면에서 재시도하면 기존 일정 이어쓰기', async () => {
  let progress = {};
  const request = { schedule, mode: 'direct', courses, selectedCourseId: 'draft-course', onProgress: next => { progress = next; } };
  adapter.fail = 'courses:insert';
  await expect(saveNewScheduleWithCourse(request)).rejects.toThrow();
  expect(progress.schedule.id).toBeTruthy();
  adapter.fail = null;
  await saveNewScheduleWithCourse({ ...request, progress });
  expect(db.confirmed_schedules).toHaveLength(1);
  expect(db.schedule_creation_records).toHaveLength(1);
  expect(db.courses).toHaveLength(1);
  expect(db.schedule_finalizations).toHaveLength(1);
});

test('최종 확정 실패 후 저장된 코스를 재사용해서 재시도', async () => {
  let progress = {};
  const request = { schedule, mode: 'direct', courses, selectedCourseId: 'draft-course', onProgress: next => { progress = next; } };
  adapter.fail = 'schedule_finalizations:insert';
  await expect(saveNewScheduleWithCourse(request)).rejects.toBeTruthy();
  expect(progress.courses).toHaveLength(1);
  adapter.fail = null;
  await saveNewScheduleWithCourse({ ...request, progress });
  expect(db.confirmed_schedules).toHaveLength(1);
  expect(db.courses).toHaveLength(1);
  expect(db.schedule_finalizations).toHaveLength(1);
});

test('생성자가 아닌 다른 참여자는 투표 없이 직접 지정 불가', async () => {
  const saved = await saveNewScheduleWithCourse({ schedule, mode: 'direct', courses, selectedCourseId: 'draft-course' });
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'member-b' } }, error: null });
  await expect(finalizeDirectCourse({ roomId: 1, scheduleId: saved.schedule.id, courseId: saved.courses[0].id })).rejects.toThrow('만든 참여자만');
});

test('게스트 생성자도 새 일정과 직접 코스 저장 가능', async () => {
  supabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
  localStorage.setItem('guest_id', 'guest-a');
  const saved = await saveNewScheduleWithCourse({ schedule, mode: 'direct', courses, selectedCourseId: 'draft-course' });
  expect(saved.finalization.finalized_by_type).toBe('guest');
  expect(saved.finalization.finalized_by_guest_id).toBe('guest-a');
});

test('일정 시간을 줄인 뒤에는 오래된 코스 시간표를 저장하지 않음', () => {
  expect(validateNewScheduleCourse({ schedule: { ...schedule, endtime: '16:00' }, mode: 'vote', courses })).toContain('시간표');
});

test('중복 이름·직접 코스 미선택·종일 일정의 코스 저장을 생성 전에 거부', async () => {
  for (const change of [{ mode: 'vote', courses: [...courses, ...courses] },
    { selectedCourseId: 'missing' }, { schedule: { ...schedule, isallday: true } }]) {
    await expect(saveNewScheduleWithCourse({ schedule, mode: 'direct', courses, selectedCourseId: 'draft-course', ...change })).rejects.toThrow();
  }
  expect(db.confirmed_schedules).toHaveLength(0);
});

test('동일 직접 확정 재시도는 기존 결과를 반환하고 다른 코스 덮어쓰기는 차단', async () => {
  const saved = await saveNewScheduleWithCourse({ schedule, mode: 'direct', courses, selectedCourseId: 'draft-course' });
  const request = { roomId: 1, scheduleId: saved.schedule.id, courseId: saved.courses[0].id };
  await finalizeDirectCourse(request);
  expect(db.schedule_finalizations).toHaveLength(1);
  db.courses.push({ id: 999, room_id: 1, schedule_id: saved.schedule.id });
  await expect(finalizeDirectCourse({ ...request, courseId: 999 })).rejects.toThrow('이미 다른 코스');
  expect(db.schedule_finalizations[0].course_id).toBe(request.courseId);
});

test('다른 일정의 코스나 모임 비참여자는 직접 확정 불가', async () => {
  const saved = await saveNewScheduleWithCourse({ schedule, mode: 'direct', courses, selectedCourseId: 'draft-course' });
  db.courses.push({ id: 999, room_id: 1, schedule_id: 999 });
  await expect(finalizeDirectCourse({ roomId: 1, scheduleId: saved.schedule.id, courseId: 999 })).rejects.toBeTruthy();
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'outsider' } }, error: null });
  await expect(finalizeDirectCourse({ roomId: 1, scheduleId: saved.schedule.id, courseId: saved.courses[0].id })).rejects.toThrow('참여자');
});
